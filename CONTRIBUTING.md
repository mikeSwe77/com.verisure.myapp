# Contributing to Verisure for Homey

Thanks for helping! Bug reports, test reports from Verisure hardware the app hasn't been tested
with (smart locks and cameras especially), translations and pull requests are all welcome.

- **Bugs and ideas:** [open an issue](https://github.com/mikeSwe77/com.verisure.myapp/issues).
  Include the device type, what you expected, what happened, and — if you can — the app's log
  (Homey Developer Tools → *Apps* → Verisure, or the output of `homey app run`).
- **Never post** passwords, alarm codes, session cookies or your installation ID in issues.
- Like the project? [☕ Buy me a coffee](https://buymeacoffee.com/mikeswe).

## Running the app on your Homey

Requirements: a Homey Pro, Node.js 18 or later, and the Homey CLI.

```bash
npm install -g homey
git clone https://github.com/mikeSwe77/com.verisure.myapp.git
cd com.verisure.myapp
npm install
homey login              # once
homey app run            # development mode: live logs in your terminal, stops when you quit
homey app install        # or install it permanently
```

`homey app run` builds the app into `.homeybuild/` and runs it on your Homey with logs streaming to
your terminal. While it runs, `homey app validate` in the same folder can fail with a permission
error on `.homeybuild` — that's expected; stop `app run` first.

## Checks before a pull request

```bash
npm test                              # unit tests — no network, a fake Verisure server
npm run lint                          # ESLint (Athom's config)
homey app validate --level publish    # manifest, images, flow cards
```

All three must pass. If you changed device capabilities, settings or Flow cards, also run
`npm run docs` to regenerate the tables in the README.

## Testing against your own Verisure account

`scripts/live-test.js` signs in with the same code the app uses and prints what Verisure reports —
read-only, it never arms or switches anything. You type your e-mail, password and the SMS code
yourself; the session is saved to `.verisure-session.json` (git- and Homey-ignored).

```bash
node scripts/live-test.js --verbose   # sign in (MFA if needed), list installations and devices
node scripts/live-test.js --again     # reuse the saved session — must not ask for a code
node scripts/live-test.js --logout    # revoke the trusted device and delete the session file
```

`--verbose` prints every request with its status and cookie *names* (never values, passwords or codes).

> ⚠️ Don't trigger smoke, water or motion detectors for real to test the app without contacting
> Verisure first — it may start a real alarm response. Repeated wrong alarm codes lock the account.

## Project layout

```
app.js                    accounts and installation hubs; sign-out
api.js                    Web API for the settings page
settings/index.html       app settings page (accounts, sign out)
lib/
  VerisureSession.js      API client: sign-in, MFA, trust, cookies, host failover (port of python-verisure)
  VerisureAccount.js      session recovery: refresh, trust-cookie re-sign-in, reauth (port of HA's coordinator)
  InstallationHub.js      polling, back-off, availability, commands, arm dry run
  events.js               event log → smoke / water / motion / tamper / battery / door events
  operations.js           GraphQL operation builders and verified overrides
  queries.js              GENERATED verbatim queries from python-verisure — don't edit
  VerisureDriver.js       shared pairing and repair (custom sign-in view)
  VerisureDevice.js       base device: subscribes to its hub, availability, alarms with reset
  pair/login.html         SOURCE of the sign-in view (npm run sync-pair copies it to every driver)
drivers/<device>/         one folder per device type
.homeycompose/            manifest source — app.json is generated
locales/                  English and Swedish
docs/images/              README images (scripts/make-doc-images.sh)
test/                     unit tests
```

## Useful scripts

| Command | What it does |
|---|---|
| `npm test` | Unit tests (`node --test`) |
| `npm run lint` | ESLint |
| `npm run docs` | Regenerate the README's device and Flow card tables from `app.json` |
| `npm run sync-pair` | Copy `lib/pair/login.html` into every driver's `pair/` folder |
| `npm run queries` | Regenerate `lib/queries.js` from `reference/python-verisure` |
| `bash scripts/make-doc-images.sh` | Regenerate the README banner and device gallery (macOS) |

## Upstream references

The app follows two projects closely. Clone them into `reference/` (git-ignored) when working on the
API:

```bash
git clone -b version-2 https://github.com/persandstrom/python-verisure reference/python-verisure
```

- `python-verisure/verisure/session.py` — endpoints, cookies and every GraphQL query.
- Home Assistant's [Verisure integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/verisure)
  — polling, session recovery, rate-limit back-off and command semantics.

[`AGENTS.md`](AGENTS.md) records the design decisions and every API detail verified against a live
installation (for example the User-Agent requirement on `/auth/trust` and the event-log codes).

## Guidelines

- **Don't add API traffic lightly.** Verisure blocks accounts that poll too much. New data goes into the
  existing batched poll, and only for device types that need it.
- **Never log secrets** — passwords, codes, cookie values.
- **Translations:** add or update `locales/<lang>.json` and the `"en"`/`"sv"` strings in the
  `.homeycompose` and `driver.compose.json` files.
- Match the surrounding code style; plain JavaScript (SDK 3), no TypeScript.

By contributing you agree that your contributions are licensed under the GPL-3.0, like the rest of the
project.
