'use strict';

// Read-only smoke test against the real Verisure API, outside Homey.
//
//   node scripts/live-test.js            sign in (MFA if needed), print installations + overview
//   node scripts/live-test.js --again    reuse the saved session: proves the trust cookie skips MFA
//   node scripts/live-test.js --logout   revoke the trust cookie and delete the saved session
//
// The session (cookies, incl. the vs-trust cookie) is saved to .verisure-session.json,
// which is gitignored. Nothing here arms, disarms or switches anything.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const VerisureAccount = require('../lib/VerisureAccount');
const VerisureSession = require('../lib/VerisureSession');
const InstallationHub = require('../lib/InstallationHub');
const operations = require('../lib/operations');
const { MfaRequiredError } = require('../lib/errors');

const SESSION_FILE = path.join(__dirname, '..', '.verisure-session.json');

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (text) => {
        if (text.includes(question)) rl.output.write(text);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  } catch (err) {
    return null;
  }
}

function save(state) {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function summarize(snapshot) {
  const count = (section) => (section ? Object.keys(section).length : 0);
  console.log('\nAlarm:', snapshot.alarm && `${snapshot.alarm.statusType} (by ${snapshot.alarm.name || '?'} via ${snapshot.alarm.changedVia || '?'}, ${snapshot.alarm.date})`);
  console.log('Broadband connected:', snapshot.broadband && snapshot.broadband.isBroadbandConnected);
  console.log(`Door/window sensors (${count(snapshot.doorWindows)}):`);
  for (const s of Object.values(snapshot.doorWindows || {})) console.log(`  ${s.device.deviceLabel}  ${s.device.area || s.area}: ${s.state}`);
  console.log(`Climate sensors (${count(snapshot.climates)}):`);
  for (const s of Object.values(snapshot.climates || {})) {
    console.log(`  ${s.device.deviceLabel}  ${s.device.area} [${s.device.gui && s.device.gui.label}]: ${s.temperatureValue} °C${s.humidityEnabled ? `, ${s.humidityValue} %` : ''}`);
  }
  console.log(`Smart plugs (${count(snapshot.smartPlugs)}):`);
  for (const s of Object.values(snapshot.smartPlugs || {})) console.log(`  ${s.device.deviceLabel}  ${s.device.area}: ${s.currentState}`);
  console.log(`Smart locks (${count(snapshot.smartLocks)}):`);
  for (const s of Object.values(snapshot.smartLocks || {})) console.log(`  ${s.device.deviceLabel}  ${s.device.area}: ${s.lockStatus}`);
  console.log(`Cameras (${count(snapshot.cameras)}):`);
  for (const s of Object.values(snapshot.cameras || {})) console.log(`  ${s.device.deviceLabel}  ${s.device.area} (capture allowed: ${s.imageCaptureAllowed})`);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const log = args.has('--verbose') ? (...a) => console.log('  ·', ...a) : () => {};
  let stored = load();

  if (args.has('--logout')) {
    if (!stored) return console.log('No saved session.');
    const session = new VerisureSession({ ...stored, username: stored.email, log });
    // Same sign-out as the app's settings page: re-establish the (likely expired) session with
    // the trust cookie first — the DELETE calls are rejected without a live session.
    const outcome = await VerisureAccount.signOutSession(session);
    fs.rmSync(SESSION_FILE, { force: true });
    if (!outcome.signedOut) {
      console.log(`Session file deleted, but Verisure did not confirm the sign-out (${outcome.error}).`);
      console.log('Remove this trusted device manually in My Verisure.');
      process.exitCode = 1;
      return undefined;
    }
    return console.log(outcome.trustRevoked
      ? 'Signed out at Verisure, trusted device revoked, session file deleted.'
      : 'Signed out at Verisure and session file deleted (no trust token was stored to revoke).');
  }

  let account;
  if (args.has('--again')) {
    if (!stored) throw new Error('No saved session — run without --again first.');
    console.log(`Reusing saved session for ${stored.email} (should NOT ask for a code)…`);
    account = new VerisureAccount({
      ...stored, onSessionChanged: (s) => save({ ...stored, ...s }), log,
    });
  } else {
    const email = await ask('Verisure e-mail: ');
    const password = await ask('Password: ', { hidden: true });
    const session = new VerisureSession({ username: email, password, log });
    stored = { email, password };
    session._onSessionChanged = (s) => {
      stored = { ...stored, ...s }; save(stored);
    };
    try {
      await session.login();
      console.log('Signed in without MFA.');
    } catch (err) {
      if (!(err instanceof MfaRequiredError)) throw err;
      const channel = await session.requestMfa();
      console.log(`Verisure sent a code by ${channel === 'phone' ? 'SMS' : 'e-mail'}.`);
      await session.validateMfa(await ask('Code: '));
      console.log(`MFA accepted; trust cookie stored: ${session.hasTrustCookie}`);
    }
    account = new VerisureAccount({
      email, session, onSessionChanged: (s) => save({ ...stored, ...s }), log,
    });
  }

  await account.ensureSession();
  const installations = await account.session.getInstallations();
  console.log('\nInstallations:');
  installations.forEach((i) => console.log(`  ${i.giid}  ${i.alias}  ${(i.address && i.address.street) || ''}`));

  for (const installation of installations) {
    console.log(`\n=== ${installation.alias} (${installation.giid}) ===`);
    const ops = Object.values(InstallationHub.POLL_OPERATIONS).flat().map((name) => operations[name](installation.giid));
    const results = await account.request(...ops);
    const errors = results.filter((r) => r && r.errors);
    if (errors.length) console.log('GraphQL errors:', JSON.stringify(errors.map((e) => e.errors)));
    summarize(InstallationHub.toSnapshot(results));
  }
  return console.log(`\nSession saved to ${path.basename(SESSION_FILE)}. Run again with --again to verify MFA is skipped.`);
}

main().catch((err) => {
  console.error(`\n${err.name}: ${err.message}`);
  process.exitCode = 1;
});
