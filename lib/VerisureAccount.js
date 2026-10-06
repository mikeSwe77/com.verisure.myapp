'use strict';

const { EventEmitter } = require('events');
const VerisureSession = require('./VerisureSession');
const {
  LoginError,
  AuthenticationError,
  CookieReadError,
  MfaRequiredError,
  ReauthRequiredError,
} = require('./errors');

// One Verisure login, shared by every installation hub and device that uses it.
//
// Session recovery is a port of Home Assistant's VerisureDataUpdateCoordinator
// (reference/ha_verisure/coordinator.py, after core PR #171317):
//
//   start-up        loginCookie() → on CookieReadError: password login()
//   every 10 min    updateCookie() (GET /auth/token)
//     ├ Authentication/LoginError → loginCookie() (password + trust cookie, no MFA)
//     └ CookieReadError           → password login()
//   anything that ends in MFA or rejected credentials → ReauthRequiredError
//   rate-limit / network / 5xx errors propagate to the caller, which retries later.
//
// The old Homey app had none of this, which is why its users had to press "Login" daily.

const COOKIE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Best-effort sign-out of a session: make sure it is valid (the DELETE calls need a live
 * session), then revoke the trust token and log out. Shared by VerisureAccount and the app's
 * sign-out of accounts no device has loaded yet.
 */
async function signOutSession(session, { loggedIn = false, refreshDue = true } = {}) {
  const hadTrustToken = Boolean(session._trustToken && session._trustToken.trustTokenValue);
  try {
    if (!loggedIn) await session.loginCookie().catch(() => {});
    else if (refreshDue) await session.updateCookie().catch(() => {});
    await session.logout();
    return { signedOut: true, trustRevoked: hadTrustToken };
  } catch (err) {
    return { signedOut: false, trustRevoked: false, error: err.message };
  }
}

class VerisureAccount extends EventEmitter {

  /**
   * @param {object}   options
   * @param {string}   options.email
   * @param {string}   options.password
   * @param {object}   [options.cookies]
   * @param {object}   [options.trustToken]
   * @param {Function} [options.onSessionChanged] persists { cookies, trustToken }
   * @param {VerisureSession} [options.session]   pre-authenticated session (from pairing)
   * @param {object}   [options.sessionOptions]   extra VerisureSession options (tests)
   * @param {Function} [options.now]
   * @param {Function} [options.log]
   */
  constructor({
    email, password, cookies = null, trustToken = null, onSessionChanged = () => {},
    session = null, sessionOptions = {}, now = Date.now, log = () => {},
  }) {
    super();
    this.email = email;
    this._now = now;
    this._log = log;
    this._onSessionChanged = onSessionChanged;
    this.session = session || new VerisureSession({
      username: email, password, cookies, trustToken, log, ...sessionOptions,
    });
    this.session._onSessionChanged = (state) => this._onSessionChanged(state);
    // A session handed over from pairing has just logged in.
    this._loggedIn = Boolean(session);
    this._lastRefresh = session ? now() : 0;
    this._reauthReason = null;
    this._lock = Promise.resolve();
  }

  get reauthRequired() {
    return this._reauthReason !== null;
  }

  get reauthReason() {
    return this._reauthReason;
  }

  /**
   * Replaces the session with one that just completed login (+ MFA) in a Repair flow.
   */
  adoptSession(session, onSessionChanged = null) {
    if (onSessionChanged) this._onSessionChanged = onSessionChanged;
    this.session = session;
    this.session._onSessionChanged = (state) => this._onSessionChanged(state);
    this._loggedIn = true;
    this._lastRefresh = this._now();
    this._reauthReason = null;
    this.emit('reauthenticated');
  }

  _exclusive(fn) {
    const run = this._lock.then(fn);
    this._lock = run.catch(() => {});
    return run;
  }

  ensureSession() {
    return this._exclusive(async () => {
      if (this._reauthReason) throw new ReauthRequiredError(this._reauthReason);

      if (!this._loggedIn) {
        await this._startupLogin();
        this._loggedIn = true;
        this._lastRefresh = this._now();
        return;
      }

      if (this._now() - this._lastRefresh < COOKIE_REFRESH_INTERVAL_MS) return;

      try {
        await this.session.updateCookie();
      } catch (err) {
        if (err instanceof CookieReadError) {
          this._log('Session unreadable, logging in with password');
          await this._passwordLogin();
        } else if (err instanceof LoginError) {
          this._log(`Session expired (${err.message}), logging in with trust cookie`);
          await this._recoverAfterAuthFailure();
        } else {
          throw err;
        }
      }
      this._lastRefresh = this._now();
    });
  }

  /**
   * Runs GraphQL operations, refreshing the session first when it is due. A 401/403 on
   * the query itself forces one refresh-and-retry.
   */
  async request(...ops) {
    await this.ensureSession();
    try {
      return await this.session.request(...ops);
    } catch (err) {
      if (!(err instanceof AuthenticationError)) throw err;
      this._log('Query rejected as unauthenticated; refreshing session and retrying once');
      this._lastRefresh = 0;
      await this.ensureSession();
      return this.session.request(...ops);
    }
  }

  async _startupLogin() {
    try {
      await this.session.loginCookie();
    } catch (err) {
      if (err instanceof CookieReadError) {
        await this._passwordLogin();
        return;
      }
      this._failIfAuth(err);
    }
  }

  async _recoverAfterAuthFailure() {
    try {
      await this.session.loginCookie();
    } catch (err) {
      if (err instanceof CookieReadError) {
        await this._passwordLogin();
        return;
      }
      this._failIfAuth(err);
    }
  }

  async _passwordLogin() {
    try {
      await this.session.login();
    } catch (err) {
      this._failIfAuth(err);
    }
  }

  // MFA, rejected credentials and other login errors need the user; anything else
  // (rate limit, network, 5xx) is transient and rethrown unchanged.
  _failIfAuth(err) {
    if (err instanceof MfaRequiredError) {
      this._requireReauth('Verisure asks for a verification code. Open the device and choose Repair to sign in again.');
    }
    if (err instanceof LoginError) {
      this._requireReauth(`Verisure rejected the stored login (${err.message}). Open the device and choose Repair to sign in again.`);
    }
    throw err;
  }

  /**
   * Signs out at Verisure: revokes this client's trust token (so the vs-trust cookie can no
   * longer skip MFA) and ends the session. Afterwards the account behaves as "needs
   * re-authentication" until a Repair adopts a new session. Never throws for remote
   * failures — the caller wipes local data regardless — but reports them.
   * @returns {Promise<{ signedOut: boolean, trustRevoked: boolean, error?: string }>}
   */
  signOut(reason) {
    return this._exclusive(async () => {
      // Stop persisting: logout() clears cookies and must not re-create the stored record.
      this._onSessionChanged = () => {};
      this.session._onSessionChanged = () => {};
      const outcome = await signOutSession(this.session, {
        loggedIn: this._loggedIn && !this._reauthReason,
        refreshDue: this._now() - this._lastRefresh >= COOKIE_REFRESH_INTERVAL_MS,
      });
      this.markSignedOut(reason);
      return outcome;
    });
  }

  /** Puts the account in the "needs re-authentication" state without calling Verisure. */
  markSignedOut(reason) {
    this._reauthReason = reason;
    this._loggedIn = false;
    this.emit('reauthRequired', reason);
  }

  _requireReauth(reason) {
    this._reauthReason = reason;
    this._loggedIn = false;
    this.emit('reauthRequired', reason);
    throw new ReauthRequiredError(reason);
  }

}

module.exports = VerisureAccount;
module.exports.COOKIE_REFRESH_INTERVAL_MS = COOKIE_REFRESH_INTERVAL_MS;
module.exports.signOutSession = signOutSession;
