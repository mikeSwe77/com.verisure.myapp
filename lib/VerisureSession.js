'use strict';

const http = require('./http');
const operations = require('./operations');
const {
  VerisureError,
  RequestError,
  LoginError,
  AuthenticationError,
  CookieReadError,
  MfaRequiredError,
  RateLimitError,
  ResponseError,
  signalsRateLimit,
  httpErrorFromResponse,
} = require('./errors');

// Port of python-verisure 2.10.1 `verisure/session.py` (the library Home Assistant's
// Verisure integration uses). Ground truth: reference/python-verisure/verisure/session.py.
//
// The session is nothing but cookies:
//   vid, vs-access, vs-refresh   issued by /auth/login (or /auth/mfa/validate)
//   vs-trust-<id>                issued by /auth/trust after a successful MFA; lets
//                                /auth/login skip MFA next time
// Instead of pickling them to a file, every change is handed to `onSessionChanged` so the
// app can persist them in Homey settings.

const BASE_URLS = ['https://automation01.verisure.com', 'https://automation02.verisure.com'];
const APPLICATION_ID = 'PS_PYTHON';
// Required: /auth/trust answers 500 XBN_00001 to a request without a User-Agent (verified
// 2026-10-06; any value works). python-requests always sends one, Node's https does not.
const USER_AGENT = 'com.verisure.myapp (Homey)';

function parseSetCookie(header) {
  const [pair, ...attributes] = String(header).split(';');
  const eq = pair.indexOf('=');
  if (eq < 1) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  let expired = false;
  for (const attribute of attributes) {
    const [key, ...rest] = attribute.trim().split('=');
    const attrValue = rest.join('=');
    if (/^max-age$/i.test(key) && Number(attrValue) <= 0) expired = true;
    if (/^expires$/i.test(key)) {
      const when = Date.parse(attrValue);
      if (!Number.isNaN(when) && when <= Date.now()) expired = true;
    }
  }
  return { name, value, expired };
}

function cookiesFromResponse(response) {
  const jar = {};
  for (const header of response.setCookies || []) {
    const cookie = parseSetCookie(header);
    if (cookie && !cookie.expired) jar[cookie.name] = cookie.value;
  }
  return jar;
}

// requests' CookieJar.update(): later cookies win, and a cookie the server expired is
// dropped from the jar.
function mergeCookies(jar, response) {
  const merged = { ...jar };
  for (const header of response.setCookies || []) {
    const cookie = parseSetCookie(header);
    if (!cookie) continue;
    if (cookie.expired) delete merged[cookie.name];
    else merged[cookie.name] = cookie.value;
  }
  return merged;
}

function pickCookies(jar, predicate) {
  return Object.fromEntries(Object.entries(jar || {}).filter(([name]) => predicate(name)));
}

function cookieHeader(jar) {
  return Object.entries(jar || {}).map(([name, value]) => `${name}=${value}`).join('; ');
}

function graphqlErrorText(result) {
  const errors = result && result.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  return errors.map((e) => e.message || JSON.stringify(e)).join('; ');
}

class VerisureSession {

  /**
   * @param {object}   options
   * @param {string}   options.username        Verisure account e-mail
   * @param {string}   options.password
   * @param {object}   [options.cookies]       persisted cookie jar ({ name: value })
   * @param {object}   [options.trustToken]    persisted /auth/trust response
   * @param {Function} [options.onSessionChanged] called with { cookies, trustToken } on change
   * @param {Function} [options.transport]     http.request-compatible function (tests)
   * @param {Function} [options.sleep]         async (ms) => void (tests)
   * @param {number}   [options.timeout]       per-request timeout in ms
   * @param {Function} [options.log]
   */
  constructor({
    username, password, cookies = null, trustToken = null, onSessionChanged = () => {},
    // Only used for the 1 s retry delay in updateCookie(); nothing outlives the call.
    transport = http.request, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), // eslint-disable-line homey-app/global-timers
    timeout = 30000, log = () => {},
  }) {
    this.username = username;
    this.password = password;
    this._cookies = cookies && Object.keys(cookies).length ? { ...cookies } : null;
    this._trustToken = trustToken;
    this._mfaLoginPending = false;
    this._baseUrls = [...BASE_URLS];
    this._onSessionChanged = onSessionChanged;
    this._transport = transport;
    this._sleep = sleep;
    this._timeout = timeout;
    this._log = log;
  }

  get cookies() {
    return this._cookies ? { ...this._cookies } : null;
  }

  get hasTrustCookie() {
    return Object.keys(this._cookies || {}).some((name) => name.includes('vs-trust'));
  }

  setCredentials(username, password) {
    this.username = username;
    this.password = password;
  }

  _persist() {
    this._onSessionChanged({ cookies: this.cookies, trustToken: this._trustToken });
  }

  // Diagnostic log line per HTTP call. Never logs cookie values, credentials or request
  // bodies: only cookie names (+ Set-Cookie attributes such as Path) and error bodies.
  _trace(method, baseUrl, path, sentCookies, response) {
    const host = baseUrl.replace('https://', '');
    const sent = Object.keys(sentCookies || {}).join(',') || '-';
    const received = (response.setCookies || []).map((header) => {
      const [pair, ...attributes] = String(header).split(';');
      const name = pair.split('=')[0].trim();
      const attrs = attributes.map((a) => a.trim()).filter((a) => !/^expires=/i.test(a)).join(';');
      return attrs ? `${name}[${attrs}]` : name;
    }).join(' ') || '-';
    let line = `${method} ${host}${path} → ${response.status} | sent cookies: ${sent} | set: ${received}`;
    if (response.status >= 400 || /"errors"/.test(response.text)) {
      line += ` | body: ${String(response.text).slice(0, 400)}`;
    }
    this._log(line);
  }

  // _wrap_request(): try both hosts, remember the last one that worked.
  async _send(method, path, {
    headers = {}, body = null, cookies = null, auth = false,
  } = {}) {
    const allHeaders = { APPLICATION_ID, 'User-Agent': USER_AGENT, ...headers };
    if (auth) {
      allHeaders.Authorization = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
    }
    const cookie = cookieHeader(cookies);
    if (cookie) allHeaders.Cookie = cookie;

    let lastError = new VerisureError('Unknown error');
    for (const baseUrl of [...this._baseUrls]) {
      let response;
      try {
        response = await this._transport({
          method, url: baseUrl + path, headers: allHeaders, body, timeout: this._timeout,
        });
      } catch (err) {
        this._log(`${method} ${baseUrl}${path} failed: ${err.message}`);
        lastError = new RequestError(err.message);
        this._baseUrls.reverse();
        continue;
      }
      this._trace(method, baseUrl, path, cookies, response);

      if (response.status >= 500) {
        lastError = new ResponseError(response.status, response.text);
        this._baseUrls.reverse();
        continue;
      }
      if (response.status >= 400) {
        throw httpErrorFromResponse(response.status, response.text);
      }
      // Upstream only accepts exactly 200 and treats other 2xx/3xx as a failure of that
      // host; any 2xx is accepted here (e.g. 204 from DELETE /auth/logout).
      if (response.status >= 200 && response.status < 300) {
        if (signalsRateLimit(response.text)) throw new RateLimitError(response.text);
        if (response.text.includes('SYS_00004')) {
          lastError = new ResponseError(response.status, response.text);
          this._baseUrls.reverse();
          continue;
        }
        return response;
      }
      lastError = new ResponseError(response.status, response.text);
      this._baseUrls.reverse();
    }
    throw lastError;
  }

  /**
   * Password login. Resolves the account's installations, or throws MfaRequiredError
   * when the account needs a one-time code (call requestMfa() + validateMfa() next).
   */
  async login() {
    const response = await this._send('POST', '/auth/login', { auth: true });
    if (response.text.includes('stepUpToken')) {
      this._cookies = cookiesFromResponse(response);
      this._mfaLoginPending = true;
      throw new MfaRequiredError('Multifactor authentication required');
    }
    this._mfaLoginPending = false;
    this._cookies = cookiesFromResponse(response);
    this._persist();
    return this.getInstallations();
  }

  /**
   * Asks Verisure to send a one-time code (SMS first, then e-mail). Reuses the step-up
   * cookies from a pending login() — a second /auth/login here is what triggers
   * ACC_00002 "too many step up tokens" (fixed upstream in 2.7.1).
   */
  async requestMfa() {
    if (!this._mfaLoginPending) {
      const response = await this._send('POST', '/auth/login', { auth: true });
      if (!response.text.includes('stepUpToken')) {
        throw new LoginError('Multifactor authentication disabled, use regular login instead');
      }
      this._cookies = cookiesFromResponse(response);
    }
    this._mfaLoginPending = false;

    let lastError = null;
    for (const type of ['phone', 'email']) {
      try {
        await this._send('POST', `/auth/mfa?type=${type}`, { cookies: this._cookies });
        return type;
      } catch (err) {
        // Upstream gives up after the first failure. Falling back to e-mail is safe for
        // anything except a rate limit, where another request only makes it worse.
        if (err instanceof RateLimitError) throw err;
        lastError = err;
      }
    }
    throw new LoginError(`Failed to request MFA code: ${lastError && lastError.message}`);
  }

  /**
   * Validates the one-time code, then trusts this client so later logins skip MFA.
   * Resolves the account's installations.
   */
  async validateMfa(code) {
    const response = await this._send('POST', '/auth/mfa/validate', {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      cookies: this._cookies,
      body: JSON.stringify({ token: String(code).trim() }),
    });
    this._cookies = cookiesFromResponse(response);

    const trust = await this._send('POST', '/auth/trust', {
      headers: { Accept: 'application/json' },
      cookies: this._cookies,
    });
    this._cookies = mergeCookies(this._cookies, trust);
    try {
      this._trustToken = JSON.parse(trust.text);
    } catch (err) {
      this._trustToken = null;
    }
    this._persist();
    return this.getInstallations();
  }

  /**
   * Re-login with password plus the stored trust cookie, which skips MFA. This is how a
   * trusted client recovers an expired session without user interaction.
   */
  async loginCookie() {
    if (!this._cookies) throw new CookieReadError('No stored session');
    const response = await this._send('POST', '/auth/login', {
      auth: true,
      cookies: pickCookies(this._cookies, (name) => name.includes('vs-trust')),
    });
    // Not handled upstream: if the trust cookie is no longer honoured, Verisure asks for
    // MFA again. Surface that instead of failing later on an unauthenticated query.
    if (response.text.includes('stepUpToken')) {
      this._cookies = { ...this._cookies, ...cookiesFromResponse(response) };
      this._mfaLoginPending = true;
      throw new MfaRequiredError('Multifactor authentication required');
    }
    this._cookies = mergeCookies(this._cookies, response);
    this._persist();
    return this.getInstallations();
  }

  /**
   * Refreshes the short-lived vs-access cookie (~15 min) via /auth/token. Retries generic
   * login errors; authentication and missing-session errors are raised immediately.
   */
  async updateCookie({ attempts = 3, delay = 1000 } = {}) {
    for (let attempt = 1; ; attempt++) {
      try {
        if (!this._cookies) throw new CookieReadError('No stored session');
        const response = await this._send('GET', '/auth/token', {
          cookies: pickCookies(this._cookies, (name) => name === 'vid' || name === 'vs-refresh'),
        });
        this._cookies = mergeCookies(this._cookies, response);
        this._persist();
        return;
      } catch (err) {
        const retryable = err instanceof LoginError
          && !(err instanceof AuthenticationError)
          && !(err instanceof CookieReadError);
        if (!retryable || attempt >= attempts) throw err;
        await this._sleep(delay);
      }
    }
  }

  async logout() {
    try {
      const token = this._trustToken && this._trustToken.trustTokenValue;
      if (token) {
        await this._send('DELETE', `/auth/trust/${token}`, {
          headers: { Accept: 'application/json' },
          cookies: this._cookies,
        });
      }
      await this._send('DELETE', '/auth/logout', { cookies: this._cookies });
    } finally {
      this._cookies = null;
      this._trustToken = null;
      this._mfaLoginPending = false;
      this._persist();
    }
  }

  /**
   * Posts one or more GraphQL operations in a single HTTP call. Always resolves an array
   * with one result per operation (the API returns a bare object for a single one).
   */
  async request(...ops) {
    if (ops.length === 0) return [];
    const response = await this._send('POST', '/graphql', {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      cookies: this._cookies,
      body: JSON.stringify(ops),
    });
    let parsed;
    try {
      parsed = JSON.parse(response.text);
    } catch (err) {
      throw new ResponseError(response.status, response.text);
    }
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  async getInstallations() {
    const [result] = await this.request(operations.fetchAllInstallations(this.username));
    const installations = result && result.data && result.data.account && result.data.account.installations;
    if (!Array.isArray(installations)) {
      throw new LoginError(`Failed to log in: ${graphqlErrorText(result) || 'no installations returned'}`);
    }
    return installations;
  }

}

module.exports = VerisureSession;
module.exports.parseSetCookie = parseSetCookie;
module.exports.graphqlErrorText = graphqlErrorText;
module.exports.BASE_URLS = BASE_URLS;
