'use strict';

const Homey = require('homey');
const VerisureAccount = require('./lib/VerisureAccount');
const VerisureSession = require('./lib/VerisureSession');
const InstallationHub = require('./lib/InstallationHub');

// App-level registry. One VerisureAccount per e-mail (one login, one cookie jar) and one
// InstallationHub per installation (giid). Devices never talk to Verisure directly: they
// subscribe to their hub, so all devices of an installation share a single poll.
//
// Credentials and session cookies are stored in app settings under `accounts`:
//   { "<email lower-case>": { email, password, cookies, trustToken } }
// The password is kept because recovering an expired session (password + trust cookie)
// must work without the user — the same thing Home Assistant stores.

const ACCOUNTS_KEY = 'accounts';

function accountKey(email) {
  return String(email || '').trim().toLowerCase();
}

class VerisureApp extends Homey.App {

  async onInit() {
    this._accounts = new Map();
    this._hubs = new Map();
    this.log('Verisure app initialized');
  }

  async onUninit() {
    for (const hub of this._hubs.values()) hub.destroy();
    this._hubs.clear();
  }

  _records() {
    return this.homey.settings.get(ACCOUNTS_KEY) || {};
  }

  _saveRecord(email, patch) {
    const records = this._records();
    const key = accountKey(email);
    records[key] = { ...(records[key] || {}), ...patch };
    this.homey.settings.set(ACCOUNTS_KEY, records);
  }

  getAccountRecord(email) {
    return this._records()[accountKey(email)] || null;
  }

  knownAccounts() {
    return Object.values(this._records()).map((record) => record.email);
  }

  getAccount(email) {
    const key = accountKey(email);
    let account = this._accounts.get(key);
    if (account) return account;

    const record = this._records()[key];
    if (!record) {
      // Signed out (or settings lost): devices stay unavailable until a Repair signs in,
      // which hands a new session to this same account object and wakes its hubs.
      account = new VerisureAccount({
        email,
        password: null,
        onSessionChanged: (state) => this._saveRecord(email, state),
        log: (...args) => this.log(`[${email}]`, ...args),
      });
      account.markSignedOut(this.homey.__('settings.signed_out_device'));
      this._accounts.set(key, account);
      return account;
    }

    account = new VerisureAccount({
      email: record.email,
      password: record.password,
      cookies: record.cookies,
      trustToken: record.trustToken,
      onSessionChanged: (state) => this._saveRecord(record.email, state),
      log: (...args) => this.log(`[${record.email}]`, ...args),
    });
    this._accounts.set(key, account);
    return account;
  }

  /**
   * Stores a session that just logged in during pairing or repair, and hands it to the
   * live account (which wakes any hub that was waiting for re-authentication).
   */
  registerLogin(session) {
    const { username: email, password } = session;
    this._saveRecord(email, {
      email, password, cookies: session.cookies, trustToken: session._trustToken,
    });
    const key = accountKey(email);
    const existing = this._accounts.get(key);
    if (existing) {
      // Re-attach persistence: a signed-out account had it switched off.
      existing.adoptSession(session, (state) => this._saveRecord(email, state));
      return existing;
    }
    const account = new VerisureAccount({
      email,
      session,
      onSessionChanged: (state) => this._saveRecord(email, state),
      log: (...args) => this.log(`[${email}]`, ...args),
    });
    this._accounts.set(key, account);
    return account;
  }

  /** For the settings page: accounts, their state and how many devices use them. No secrets. */
  async getAccountsOverview() {
    const devices = Object.values(this.homey.drivers.getDrivers()).flatMap((driver) => driver.getDevices());
    return Object.values(this._records()).map((record) => {
      const key = accountKey(record.email);
      const account = this._accounts.get(key);
      const mine = devices.filter((device) => accountKey(device.getStore().email) === key);
      return {
        email: record.email,
        state: account && account.reauthRequired ? 'reauth' : 'ok',
        reason: account ? account.reauthReason : null,
        trusted: Object.keys(record.cookies || {}).some((name) => name.includes('vs-trust')),
        devices: mine.length,
        installations: [...new Set(mine.map((device) => device.getData().giid))].length,
      };
    });
  }

  /**
   * Signs out of an account: revokes Homey as a trusted device at Verisure, ends the session
   * and deletes the stored password and cookies. Devices of the account become unavailable
   * until they are repaired (or deleted).
   */
  async signOut(email) {
    const key = accountKey(email);
    const record = this._records()[key];
    if (!record) throw new Error(this.homey.__('settings.unknown_account'));
    const reason = this.homey.__('settings.signed_out_device');

    let account = this._accounts.get(key);
    let outcome;
    if (account) {
      outcome = await account.signOut(reason);
    } else {
      // Not loaded (no devices initialised it): sign out with a throw-away session.
      const session = new VerisureSession({
        username: record.email, password: record.password, cookies: record.cookies, trustToken: record.trustToken,
      });
      outcome = await VerisureAccount.signOutSession(session);
      account = new VerisureAccount({ email: record.email, password: null });
      account.markSignedOut(reason);
      this._accounts.set(key, account);
    }

    const records = this._records();
    delete records[key];
    this.homey.settings.set(ACCOUNTS_KEY, records);
    this.log(`Signed out ${record.email}: ${outcome.signedOut
      ? `signed out at Verisure${outcome.trustRevoked ? ', trust revoked' : ''}`
      : `remote sign-out failed (${outcome.error})`}`);
    return { email: record.email, ...outcome };
  }

  getHub(email, giid) {
    let hub = this._hubs.get(giid);
    if (hub) return hub;
    hub = new InstallationHub({
      account: this.getAccount(email),
      giid,
      timers: {
        setTimeout: (fn, ms) => this.homey.setTimeout(fn, ms),
        clearTimeout: (timer) => this.homey.clearTimeout(timer),
      },
      log: (...args) => this.log(`[${giid}]`, ...args),
    });
    this._hubs.set(giid, hub);
    return hub;
  }

}

module.exports = VerisureApp;
