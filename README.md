# Verisure for Homey

Control your **Verisure** alarm from [Homey Pro](https://homey.app) and use its sensors in
your Flows: arm and disarm, see who changed the alarm, react to open doors, smoke, water
leaks, motion, tampering and low batteries, switch smart plugs, lock smart locks and take
camera pictures.

> This is an unofficial app. It is not made, endorsed or supported by Verisure.
> It uses the same (unofficial) Verisure app API as the Home Assistant integration.

- **Works with two-factor sign-in.** Enter the SMS/e-mail code once; Homey then stays signed in.
- **One request per minute** for the whole installation, so Verisure doesn't block your account.
- **Built on proven code**: a port of [`python-verisure`](https://github.com/persandstrom/python-verisure),
  the library behind Home Assistant's Verisure integration.

## Contents

- [Why another Verisure app?](#why-another-verisure-app)
- [Features](#features)
- [Supported devices](#supported-devices)
- [Getting started](#getting-started)
- [Flow cards](#flow-cards)
- [How it works](#how-it-works)
- [Limitations](#limitations)
- [Privacy and security](#privacy-and-security)
- [Development](#development)
- [Credits and licence](#credits-and-licence)

## Why another Verisure app?

The previous Homey Verisure app has not been updated since 2024 and its source is closed.
Its users' most common problems are the design goals of this one:

| Problem with the old app | This app |
|---|---|
| No two-factor (MFA) support — and Verisure now enforces it in several countries | Full MFA sign-in; Homey is registered as a *trusted device* so later sign-ins skip the code |
| Users had to press "Login" every day | Session refreshed automatically every 10 minutes and recovered without the user |
| Accounts blocked for polling too often | One batched request per poll (default 60 s, minimum 30 s) with automatic back-off when Verisure says slow down |
| Smart plug switches "jumped back" | The commanded state is held until Verisure catches up |
| One installation per account | Any number of installations and accounts |
| No smoke, water or motion triggers | Smoke, water, motion, tamper and low-battery detection |

## Features

- **Alarm**: arm away (*armed*), arm home (*partially armed*), disarm, optionally **force arm**
  when a window is open; who changed the alarm and how (app, keypad, tag, schedule…).
- **"Can the alarm be armed?"**: asks Verisure, without arming, whether arming would go through,
  and shows which doors or windows are in the way.
- **Door/window sensors**: open/closed — including short openings that happen between two updates.
- **Smoke detectors**: smoke alarm plus temperature and humidity.
- **Water detectors** and **motion detectors** (camera PIRs): water leak and motion alarms.
- **Tamper and low battery** on every sensor, plus installation-wide triggers that also cover
  devices not added to Homey (such as the keypad).
- **Climate**: temperature and humidity from sirens, VoiceBoxes and climate sensors.
- **Smart plugs**, **smart locks** (lock/unlock, auto-lock) and **cameras** (take a picture,
  latest picture in Homey).
- **Broadband status** of the alarm.
- **Repair** to sign in again, and an **app settings page** to sign out and revoke Homey as a
  trusted device.
- English and Swedish.

## Supported devices

<!-- GENERATED:devices -->
| Device | Shows / controls | Settings |
|---|---|---|
| **Alarm** | Home alarm state, Changed by, Ready to arm, Blocking arming, Broadband online | Alarm code, Force arm, Check if the alarm can be armed, Update interval |
| **Camera** | Take picture | Check for new pictures every |
| **Climate sensor** | Temperature | – |
| **Door/window sensor** | Contact Alarm, Tamper Alarm, Battery Alarm | – |
| **Motion detector** | Motion Alarm, Tamper Alarm, Battery Alarm | Reset motion after |
| **Smart lock** | Locked, Changed by | Lock code |
| **Smart plug** | Turned on | – |
| **Smoke detector** | Smoke Alarm, Temperature, Tamper Alarm, Battery Alarm | Reset smoke alarm after |
| **Water detector** | Water Alarm, Tamper Alarm, Battery Alarm | Reset water alarm after |
<!-- /GENERATED:devices -->

How Verisure hardware maps to these devices:

| Verisure hardware (type in the API) | Homey device | Icon |
|---|---|---|
| Alarm system / installation | Alarm | alarm panel |
| Magnetic contact (`MAGNETIC`, `MAGNETIC_2`) | Door/window sensor | door/window sensor |
| Smoke detector (`SMOKE`, `SMOKE2`, `SMOKE3`) | Smoke detector | smoke detector |
| Camera motion detector (`CAMERAPIR`), motion detector (`PIR`) | Motion detector | motion sensor |
| Water detector (`WATER…`) | Water detector | water leak sensor |
| Siren (`SIREN`), climate sensor (`HUMIDITY`) | Climate sensor | temperature sensor |
| VoiceBox (`VOICEBOX`, `HOMEPAD`) | Climate sensor | intercom |
| Smart plug | Smart plug | plug |
| Smart lock (Yale Doorman, Lockguard, Danalock) | Smart lock | lock |
| SmartCam | Camera | camera |

Tested on a real installation: alarm, door/window, smoke detectors, climate sensor, siren,
VoiceBox, motion and water detectors (pairing), smart plug. Smart locks and cameras are ported
from Home Assistant but not tested on real hardware yet — reports welcome.

## Getting started

1. **Install the app** on your Homey Pro. Until it is in the Homey App Store, install it from
   source — see [Development](#development).
2. **Add the alarm**: *Devices → + → Verisure → Alarm*. Sign in with the e-mail and password of
   your Verisure account (the same as the *My Verisure* app). If your account uses two-factor
   sign-in, enter the code Verisure sends you. With several installations, pick one.
3. **Set your alarm code** in the alarm device's settings to arm and disarm from Homey.
   Verisure logs every change under the user the code belongs to.
4. **Add the other devices** the same way (door/window sensors, smoke detectors, …). You are
   not asked to sign in again.

> **Tip:** create a separate Verisure user for Homey (in *My Verisure → Users*). Changes made by
> Homey are then easy to recognise in the log, and you can revoke Homey's access without
> touching your own login.

**Signing in again.** If Verisure ever needs a new verification code, devices show
*"…choose Repair to sign in again"*. Open any Verisure device → *Settings → Repair*.

**Signing out.** *Apps → Verisure → Configure app* lists your accounts. *Sign out* removes
Homey as a trusted device at Verisure and deletes the stored password.

## Flow cards

<!-- GENERATED:flow -->
**When…**

| Device | Card | Tokens | Notes |
|---|---|---|---|
| Alarm | A device reports low battery | Room, Device serial | Any device in the installation, including ones not added to Homey such as the keypad. |
| Alarm | Alarm state was changed | State, Changed by, Changed via | Includes who changed it and how (app, keypad, tag, Homey…). |
| Alarm | Arming or disarming failed | Reason, Requested state | Runs when Homey could not change the alarm state, e.g. a wrong code or an open window. |
| Alarm | Broadband came online | – |  |
| Alarm | Broadband went offline | – |  |
| Alarm | Fire alarm | Room, Device serial | A smoke detector (or the siren) reported fire anywhere in the installation. |
| Alarm | Intrusion alarm | Room, Device serial | A sensor reported an intrusion while the alarm was armed. |
| Alarm | Tamper alarm | Room, Device serial | A device reported tampering (cover opened or removed) anywhere in the installation. |
| Alarm | Water leak | Room, Device serial | A water detector reported a leak anywhere in the installation. |
| Camera | New picture | Picture |  |

**And…**

| Device | Card | Tokens | Notes |
|---|---|---|---|
| Alarm | Alarm can / cannot be armed without force | – | Asks Verisure whether arming would go through, without arming. False when a door or window is open or a device reports a fault. |
| Alarm | Broadband is / is not online | – |  |

**Then…**

| Device | Card | Tokens | Notes |
|---|---|---|---|
| Alarm | Arm ‹mode›, force arm: ‹force› | – | Force arming arms even when a door or window is open or a sensor reports a fault. |
| Alarm | Check if the alarm can be armed | Can be armed, Blocking devices | Asks Verisure whether arming would go through, without arming. Returns which devices are in the way. |
| Alarm | Update now | – | Fetches the latest state of every device in this installation. Each update counts towards Verisure's request limit. |
| Camera | Take a picture | – | Asks the camera for a new picture. It takes a few seconds; the 'New picture' trigger runs when it arrives. |
| Smart lock | Turn auto-lock ‹enabled› | – |  |
<!-- /GENERATED:flow -->

Homey also provides its standard cards for these devices, for example *The alarm turned
on/off*, *Set alarm state*, *The door/window opened*, *Smoke detected*, *Water detected*,
*Motion detected*, *Tamper alarm turned on*, *Battery alarm turned on*, *Turn on/off* (smart
plug), *Lock/Unlock* (smart lock) and *The temperature changed*.

## How it works

- **Polling.** All devices of an installation share one poll: a single batched GraphQL request
  per interval (default 60 s, set on the alarm device, minimum 30 s). Device types you have not
  added are not requested.
- **Sign-in.** Verisure's session lives in cookies. After the verification code, Homey asks
  Verisure to *trust* it; that trust cookie lets the app sign in again without a code. The
  short-lived session cookie is refreshed every 10 minutes.
- **Rate limits.** If Verisure reports too many requests, the app waits 5, 15, 30 and then
  60 minutes before trying again, and shows a warning on the devices.
- **Smoke, water, motion, tamper and battery** are not available as live states in Verisure's
  API. Like the openHAB binding, the app reads them from Verisure's **event log**, which is part
  of the same poll. Alarms appear within one poll interval; smoke, water and motion alarms reset
  after a time you choose (or when Verisure reports them restored).
- **"Can the alarm be armed?"** uses Verisure's *arm dry run* — the check behind the
  "Arm anyway" prompt in My Verisure. It never arms. It runs after door/window activity and
  every 30 minutes while disarmed (about 3 requests per check); turn it off in the alarm's
  settings if you don't need it.

## Limitations

- **Motion only while armed.** Verisure motion detectors are battery devices that only detect
  when the alarm is armed — they report motion as an intrusion, not everyday movement.
- **Event-based alarms have a delay** of up to one poll interval and depend on Verisure's event
  codes. Door/window events are verified; the fire, water, intrusion, tamper and battery codes
  come from other integrations and fall back safely (any fire/water/intrusion event is treated
  as an alarm). Do not test smoke or water detectors for real without contacting Verisure — it
  may trigger a real alarm response.
- **No battery percentage.** Verisure's battery-level query is not available to normal accounts,
  so only *low battery* events are shown.
- **Not available in the API:** playing sounds on sirens or VoiceBoxes, smoke-detector state
  outside events, Arlo/Guardian camera streams.
- **Unofficial API.** Verisure can change it at any time. The app follows the
  `python-verisure` library, which tracks such changes.

## Privacy and security

- Your Verisure e-mail, password and session cookies are stored **only on your Homey**, in the
  app's settings. They are sent only to Verisure (`automation01/02.verisure.com`).
- The password is kept so the app can sign in again without you, the same as Home Assistant
  does. *Sign out* in the app settings deletes it and revokes Homey's trusted-device status.
- The alarm and lock codes are stored in the device settings and sent only with arm/disarm and
  lock/unlock commands. They are never logged.
- Repeated wrong codes temporarily lock your Verisure account.

## Development

Requirements: Node.js 18+, the [Homey CLI](https://apps.developer.homey.app/the-basics/getting-started/homey-cli)
(`npm install -g homey`), a Homey Pro and Python 3 (only for regenerating queries).

```bash
git clone https://github.com/mikeSwe77/com.verisure.myapp.git
cd com.verisure.myapp
npm install
npm test                 # unit tests against a fake Verisure server
npm run lint
homey app run            # run on your Homey (development mode)
homey app install        # or install it permanently
```

Useful scripts:

| Command | What it does |
|---|---|
| `npm test` | Unit tests (`node --test`), no network |
| `npm run lint` | ESLint (Athom config) |
| `node scripts/live-test.js` | Read-only check against the real API: sign in (with MFA), list installations and devices. `--again` reuses the session, `--logout` revokes it |
| `npm run queries` | Regenerate `lib/queries.js` from `python-verisure` (clone it into `reference/` first) |
| `npm run sync-pair` | Copy the shared pairing view `lib/pair/login.html` to every driver |
| `npm run docs` | Regenerate the device and Flow card tables in this README from `app.json` |

Project layout:

```
app.js                 accounts and installation hubs (one poll per installation)
api.js, settings/      app settings page: accounts, sign out
lib/
  VerisureSession.js   Verisure API client: sign-in, MFA, cookies, host failover (port of python-verisure)
  VerisureAccount.js   session recovery (port of Home Assistant's coordinator)
  InstallationHub.js   polling, back-off, commands, arm dry run
  events.js            event log → smoke / water / motion / tamper / battery / door events
  operations.js        GraphQL operations; queries.js holds the verbatim upstream queries
drivers/<device>/      one folder per device type
.homeycompose/         manifest source (app.json is generated)
test/                  unit tests
```

`AGENTS.md` documents the design decisions and the API details verified against a live
installation. Contributions are welcome — please run `npm test`, `npm run lint` and
`homey app validate --level publish` before opening a pull request.

## Credits and licence

- API client ported from [`python-verisure`](https://github.com/persandstrom/python-verisure)
  by [@persandstrom](https://github.com/persandstrom) and contributors; session handling follows Home Assistant's
  [Verisure integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/verisure).
- Event-log detection approach from the [openHAB Verisure binding](https://github.com/openhab/openhab-addons/tree/main/bundles/org.openhab.binding.verisure).
- Device icons: Homey's built-in icons and, for the alarm, Athom's
  [homey-vectors-public](https://github.com/athombv/homey-vectors-public) (GPL-3.0).

Licensed under the [GNU General Public License v3.0](LICENSE).

*Verisure is a trademark of Verisure Group. This project is not affiliated with Verisure.*
