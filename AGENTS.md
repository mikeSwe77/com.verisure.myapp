# AGENTS.md — Homey App: Verisure

Rules and context for AI coding assistants. Read fully before changing code.

## Project overview

Homey Pro app (`com.verisure.myapp`, SDK 3, plain JavaScript — not TypeScript) for Verisure
alarm systems: alarm panel, door/window sensors, climate readings (smoke detectors, sirens,
climate sensors), smart plugs, smart locks and cameras. It talks to Verisure's unofficial
app API (`automation01/02.verisure.com`, REST auth + GraphQL), the same API Home Assistant uses.

It replaces `se.adamnoren.verisure` (closed source, unmaintained since May 2024). That app's
recurring failures are this app's design constraints:

| Old app problem | How this app avoids it | Where |
|---|---|---|
| No MFA/2FA support | MFA code → `/auth/trust` → `vs-trust-*` cookie; later logins skip MFA | `VerisureSession`, pairing view |
| Daily manual re-login | `/auth/token` refresh every 10 min; trust-cookie login on expiry | `VerisureAccount` |
| Accounts blocked for polling (5 s ≈ 17k calls/day) | One batched GraphQL call per installation per poll, ≥30 s (default 60 s); 5/15/30/60 min back-off on rate limit | `InstallationHub` |
| Smart plug toggles jump back | Commanded state held 10 s (as HA) | `drivers/smart_plug/device.js` |
| One installation per account | Installation picker; one hub per giid | pairing, `app.js` |

## Architecture

```
app.js                    Registry: VerisureAccount per e-mail, InstallationHub per giid.
                          Credentials + cookies persisted in app settings `accounts`.
lib/
  VerisureSession.js      Port of python-verisure session.py: auth, MFA, cookies, host failover.
  VerisureAccount.js      Port of HA coordinator session recovery (when to refresh/relogin/reauth).
  InstallationHub.js      Polling, back-off, availability, commands (arm, plug, lock, camera).
  operations.js           GraphQL operation builders (variables as upstream).
  queries.js              GENERATED verbatim queries — run `npm run queries`, never hand-edit.
  errors.js               Error hierarchy mirroring python-verisure.
  http.js                 https-based transport (Set-Cookie safe) + image download.
  VerisureDriver.js       Shared pairing + repair (custom `login` view).
  VerisureDevice.js       Base device: subscribes to its hub, maps availability.
  pair/login.html         SOURCE of the pairing view. `npm run sync-pair` copies it to every driver.
  climateDevices.js       Splits the Climate query: SMOKE* → smoke_detector driver, rest → climate.
  events.js               Event-log classification (fire/water/intrusion/tamper/door) + dedupe.
drivers/<kind>/           alarm, door_window, smoke_detector, motion_detector, water_detector, climate,
                          smart_plug, smart_lock, camera.
.homeycompose/            Manifest source. Root app.json is GENERATED (homey app build/validate).
scripts/
  extract-queries.py      Regenerates lib/queries.js from reference/python-verisure.
  live-test.js            Read-only smoke test against the real API (user types credentials).
test/                     node --test, fake Verisure server in test/helpers/fake-verisure.js.
```

## Research protocol — before changing API behaviour

1. Ground truth is `reference/` (gitignored — recreate it):
   ```bash
   git clone -b version-2 https://github.com/persandstrom/python-verisure reference/python-verisure
   # HA component (sparse): https://github.com/home-assistant/core/tree/dev/homeassistant/components/verisure
   ```
   - `reference/python-verisure/verisure/session.py` — endpoints, cookies, every GraphQL query.
   - `reference/ha_verisure/coordinator.py` — polling, cookie refresh, recovery, back-off.
   - `reference/ha_verisure/{alarm_control_panel,lock,switch,camera}.py` — command semantics.
2. Check upstream for changes (library releases, HA PRs touching `components/verisure`).
3. State which reference file you read before writing API code. Do not guess.
4. Homey SDK questions: use the homey-apps-sdk MCP tools. Capability/class definitions are
   authoritative in the CLI's `homey-lib/assets/{capability,device}` folders.

## Rules

- **Never increase API traffic casually.** Every new poll operation goes into the existing
  batch (`POLL_OPERATIONS`) and only for device kinds that need it. Mutations like
  `GQL_CCCP_SearchMedia` are separate calls — throttle them.
- **Never send the alarm code anywhere but the arm/disarm mutations**, never log it.
- Keep `APPLICATION_ID: PS_PYTHON` unless upstream changes it.
- MFA code requests count towards Verisure's step-up limit (`ACC_00002`): never call
  `/auth/login` twice in one MFA flow; keep the 60 s resend throttle in the pairing view.
- Use `this.homey.setTimeout` (passed in as `timers`) for anything that outlives a call.
- After changing `lib/pair/login.html`: `npm run sync-pair`.
- Before committing: `npm test`, `npm run lint`, `homey app validate --level publish`.

## Detectors (smoke, water, motion, door/window)

Verisure's app API has NO live smoke, water or motion state (python-verisure #180; same in HA,
homebridge). Like openHAB's binding, the app reads them from the event log:

- `detectorEvents` (EventLog, 25 entries, categories in `lib/events.js`) rides in the same
  batched poll — no extra API calls. `EventTracker` dedupes on eventId and treats the first
  batch as a baseline, so restarts don't replay old alarms.
- The hub emits `events` (oldest first) BEFORE `update`; devices apply both through one queue,
  so door open+close between polls fires both triggers and the polled state wins.
- Codes: FA/FR fire, WA/WR water, BA intrusion, TA/TR tamper (openHAB, unverified live);
  DOORWINDOW_STATE_CHANGE_OPENED/_CLOSED (verified 2026-10-06).
- Alarms are pulses with a per-device reset timeout (`setAlarm` in VerisureDevice), cleared
  early by a restore code.
- Tamper (TA/TR) and low battery (XT/XR) are handled for every device in VerisureDevice and
  held until the restore code. Battery sensors declare them in MAINTENANCE_CAPABILITIES
  (+ `energy.batteries: ["OTHER"]`, required by publish validation); other devices get them
  added on the first event. The battery query (`batteryDevices`) returns 403 for normal
  accounts, so the event log is the only battery source.
- Motion detectors (CAMERAPIR/PIR) only detect while the alarm is ARMED — Verisure hardware
  limitation, not ours. Camera PIRs and water detectors appear in no state query; they are
  paired from the `Devices` query (operations.js OVERRIDES).
- The alarm device has installation-wide fire/water/intrusion/tamper/low-battery triggers,
  because events can be attributed to the siren, gateway or keypad instead of a Homey device.

## Camera motion detectors (CAMERAPIR) — no customer pictures

Investigated 2026-10-06, conclusion: not possible, don't build it.
- Capabilities are only SUPPORTS_CAPTURE_OPERATOR_IMAGE (Verisure's alarm centre requests images) and
  CAN_TAKE_IMAGES_ON_LINKED_ALARM_EVENT (automatic images on alarm). No customer-capture capability.
- `cameras(allCameras: true)` returns [] for an installation with three CAMERAPIRs; the media search
  (ContentProviderMediaSearch) returns no series; GraphQL introspection is disabled. Field suggestions
  on Installation only reveal `cameras`, `cameraTypes`, `cameraStream`, `cameraContentProvider`.
- Probing many queries in a short time hit AUT_00021 ("Request limit has been reached") while the app
  was also polling — keep live probing to a minimum and never loop over guesses.
Possible future work: show alarm-event images (if the media search returns any after a real alarm)
on the motion detector device.

## Arm readiness ("can the alarm be armed?")

Verisure's arm dry run (vsure 2.10 `arm_state_dry_run`, captured from My Verisure's "Arm
anyway" prompt): mutation `ArmStateDryRun` → transactionId, then poll `ArmStateDryRunStatus`
until `status.status == "DONE"`; empty `result.deviceViolations` = ready, otherwise entries
like `{ deviceLabel, violation: "DOOR_WINDOW_OPEN" }`. It does NOT arm (verified live
2026-10-06: STARTED → DONE in ~0.5 s, 3 API calls, arm state unchanged).

- `InstallationHub.checkArmReadiness()` + `getDeviceNames()` (Devices query, cached 1 h).
- Alarm device: `verisure_arm_ready` (Yes/No) + `verisure_arm_blockers` ("Entré (open)").
  Automatic checks follow HA PR #177261: 20 s after door/window events (debounced), on
  becoming disarmed, otherwise every 30 min; ≥ 2 min apart; skipped while armed. Device
  setting `arm_check` turns it off (capabilities removed).
- Flow: condition `arm_ready`, action `check_arm_readiness` (tokens, Advanced Flow only).
  Both reuse a check < 60 s old. Failed arming (without force) adds the blockers to the
  `arm_failed` reason token.

## Driver icons

Use Homey's own built-in device icons wherever one fits — they match the icon picker users
see in Homey (Security section etc.) and meet the store's line-art guidelines. They ship with
the Homey CLI in `homey-lib/assets/device/icons/` (ISC licence); copy the SVG to
`drivers/<id>/assets/icon.svg` (a manifest cannot reference them by name). In use:

| Driver / type | Icon | Source |
|---|---|---|
| alarm | BTicino alarm central | homey-vectors-public `com.galcar.netatmo/drivers/bticino_alarm_central_my_home` |
| door_window | `door-window-sensor` | built-in |
| smoke_detector | `smoke-detector` | built-in |
| climate (driver; HUMIDITY, SIREN, …) | `sensor-temperature` | built-in |
| climate: HOMEPAD, VOICEBOX (both VoiceBox) | `intercom` | built-in, per-device |
| climate: PIR, CAMERAPIR | `motion-sensor` | built-in, per-device |
| climate: WATER | `sensor-water-leak` | built-in, per-device |
| motion_detector | `motion-sensor` | built-in |
| water_detector | `sensor-water-leak` | built-in |
| smart_plug | `plug2` | built-in |
| smart_lock | `lock` | built-in |
| camera | `camera` | built-in |

Per-device icons for types that share a driver: TYPE_ICONS in `lib/climateDevices.js`
(pairing `icon`, relative to `drivers/<id>/assets/`).
Fallback: Athom's handmade icons in github.com/athombv/homey-vectors-public (GPL-3.0).
Render previews with `qlmanage -t` — ImageMagick drops the stroke-only paths.
