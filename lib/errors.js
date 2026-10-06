/* eslint-disable max-classes-per-file */

'use strict';

// Error hierarchy mirrors python-verisure 2.10 (verisure/session.py) so the recovery
// rules ported from Home Assistant's coordinator map one-to-one:
//
//   VerisureError
//   ├── RequestError          network / transport failure (timeout, DNS, reset)
//   ├── LoginError            login rejected for a non-auth reason
//   │   ├── AuthenticationError   401/403 — credentials or session rejected
//   │   ├── CookieReadError       no persisted session to resume from
//   │   └── MfaRequiredError      password accepted, a one-time code is needed
//   ├── RateLimitError        429 or a rate-limit marker in the body
//   └── ResponseError         5xx from both hosts

class VerisureError extends Error {

  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }

}

class RequestError extends VerisureError {}

class LoginError extends VerisureError {

  constructor(message, statusCode = null) {
    super(message);
    this.statusCode = statusCode;
  }

}

class AuthenticationError extends LoginError {}

class CookieReadError extends LoginError {}

// Upstream raises a plain LoginError with a fixed message; a dedicated class saves
// every caller from string-matching it.
class MfaRequiredError extends LoginError {}

class RateLimitError extends VerisureError {}

class ResponseError extends VerisureError {

  constructor(statusCode, text) {
    super(`Invalid response, status code: ${statusCode} - Data: ${text}`);
    this.statusCode = statusCode;
    this.text = text;
  }

}

// Raised by VerisureAccount when the stored session cannot be recovered without the user
// (password changed, trust cookie revoked, MFA needed). Equivalent to HA's
// ConfigEntryAuthFailed; in Homey the user fixes it with the device's Repair flow.
class ReauthRequiredError extends VerisureError {}

// Verisure refused or did not confirm a command (arm, lock, plug, capture).
class TransactionError extends VerisureError {}

const RATE_LIMIT_MARKERS = [
  'aut_00021',
  'acc_00002',
  'toomanystepuptokens',
  'too many step up tokens',
  'request limit',
  'rate limit',
  'too many requests',
];

function signalsRateLimit(text) {
  const lower = String(text || '').toLowerCase();
  return RATE_LIMIT_MARKERS.some((marker) => lower.includes(marker));
}

function httpErrorFromResponse(status, text) {
  if (status === 429 || signalsRateLimit(text)) return new RateLimitError(text);
  if (status === 401 || status === 403) return new AuthenticationError(text, status);
  if (status >= 500) return new ResponseError(status, text);
  return new LoginError(text, status);
}

module.exports = {
  VerisureError,
  RequestError,
  LoginError,
  AuthenticationError,
  CookieReadError,
  MfaRequiredError,
  RateLimitError,
  ResponseError,
  ReauthRequiredError,
  TransactionError,
  signalsRateLimit,
  httpErrorFromResponse,
};
