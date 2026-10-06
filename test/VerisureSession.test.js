'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const VerisureSession = require('../lib/VerisureSession');
const {
  MfaRequiredError, RateLimitError, AuthenticationError, CookieReadError, LoginError, RequestError,
} = require('../lib/errors');
const { fakeVerisure, graphql, INSTALLATIONS } = require('./helpers/fake-verisure');

const noSleep = async () => {};

function makeSession(server, options = {}) {
  const saved = [];
  const session = new VerisureSession({
    username: 'me@example.com',
    password: 'secret',
    transport: server.transport,
    sleep: noSleep,
    onSessionChanged: (state) => saved.push(state),
    ...options,
  });
  return { session, saved };
}

const installationsRoute = graphql({ fetchAllInstallations: INSTALLATIONS });

test('password login without MFA uses Basic auth, stores cookies and returns installations', async () => {
  const server = fakeVerisure({
    'POST /auth/login': { setCookies: ['vid=V1; Path=/; HttpOnly', 'vs-access=A1; Path=/', 'vs-refresh=R1'] },
    'POST /graphql': installationsRoute,
  });
  const { session, saved } = makeSession(server);

  const installations = await session.login();

  assert.equal(installations[0].giid, '111');
  const login = server.calls[0];
  assert.equal(login.headers.APPLICATION_ID, 'PS_PYTHON');
  assert.equal(login.headers.Authorization, `Basic ${Buffer.from('me@example.com:secret').toString('base64')}`);
  assert.deepEqual(session.cookies, { vid: 'V1', 'vs-access': 'A1', 'vs-refresh': 'R1' });
  assert.deepEqual(saved.at(-1).cookies, session.cookies);
  // GraphQL is authenticated by cookie only, never Basic auth.
  const gql = server.calls[1];
  assert.equal(gql.headers.Authorization, undefined);
  assert.equal(gql.cookies.vid, 'V1');
  assert.deepEqual(JSON.parse(gql.body)[0].variables, { email: 'me@example.com' });
});

test('every request sends a User-Agent (/auth/trust answers 500 XBN_00001 without one)', async () => {
  const server = fakeVerisure({
    'POST /auth/login': { text: '{"stepUpToken":"x"}', setCookies: ['vs-stepup=S'] },
    'POST /auth/mfa': { status: 200 },
    'POST /auth/mfa/validate': { setCookies: ['vid=V', 'vs-access=A', 'vs-refresh=R; Path=/auth'] },
    'POST /auth/trust': (call) => (call.headers['User-Agent']
      ? { text: '{"trustTokenValue":"T"}', setCookies: ['vs-trust-1=T'] }
      : { status: 500, text: '{"errorCode": "XBN_00001"}' }),
    'POST /graphql': installationsRoute,
  });
  const { session } = makeSession(server);
  await assert.rejects(session.login(), MfaRequiredError);
  await session.requestMfa();
  await session.validateMfa('123456');
  assert.ok(server.calls.every((c) => c.headers['User-Agent']));
});

test('MFA flow: step-up login, code request reuses cookies, validate + trust stores vs-trust', async () => {
  const server = fakeVerisure({
    'POST /auth/login': { text: '{"stepUpToken":"x"}', setCookies: ['vid=STEP'] },
    'POST /auth/mfa': { status: 200 },
    'POST /auth/mfa/validate': { setCookies: ['vid=V2', 'vs-access=A2', 'vs-refresh=R2'] },
    'POST /auth/trust': { text: '{"trustTokenValue":"T1"}', setCookies: ['vs-trust-abc=TRUST; Max-Age=31536000'] },
    'POST /graphql': installationsRoute,
  });
  const { session } = makeSession(server);

  await assert.rejects(session.login(), MfaRequiredError);
  assert.equal(await session.requestMfa(), 'phone');

  const loginCalls = server.calls.filter((c) => c.path === '/auth/login');
  assert.equal(loginCalls.length, 1, 'requestMfa must not log in again (ACC_00002)');
  const mfa = server.calls.find((c) => c.path === '/auth/mfa?type=phone');
  assert.equal(mfa.cookies.vid, 'STEP');

  const installations = await session.validateMfa(' 123456 ');
  assert.equal(installations.length, 1);

  const validate = server.calls.find((c) => c.path === '/auth/mfa/validate');
  assert.deepEqual(JSON.parse(validate.body), { token: '123456' });
  assert.equal(validate.headers['Content-Type'], 'application/json');
  const trust = server.calls.find((c) => c.path === '/auth/trust');
  assert.equal(trust.cookies.vid, 'V2');
  assert.equal(session.cookies['vs-trust-abc'], 'TRUST');
  assert.equal(session.cookies['vs-access'], 'A2');
  assert.equal(session.hasTrustCookie, true);
  assert.deepEqual(session._trustToken, { trustTokenValue: 'T1' });
});

test('requestMfa falls back to e-mail when SMS fails, but not on a rate limit', async () => {
  const server = fakeVerisure({
    'POST /auth/login': { text: '{"stepUpToken":"x"}' },
    'POST /auth/mfa?type=phone': { status: 400, text: 'no phone' },
    'POST /auth/mfa?type=email': { status: 200 },
  });
  const { session } = makeSession(server);
  assert.equal(await session.requestMfa(), 'email');

  const limited = fakeVerisure({
    'POST /auth/login': { text: '{"stepUpToken":"x"}' },
    'POST /auth/mfa?type=phone': { status: 400, text: 'ACC_00002 too many step up tokens' },
    'POST /auth/mfa?type=email': { status: 200 },
  });
  const { session: limitedSession } = makeSession(limited);
  await assert.rejects(limitedSession.requestMfa(), RateLimitError);
  assert.equal(limited.calls.some((c) => c.path === '/auth/mfa?type=email'), false);
});

test('loginCookie sends only the trust cookie with Basic auth and merges the response', async () => {
  const server = fakeVerisure({
    'POST /auth/login': { setCookies: ['vid=V3', 'vs-access=A3', 'vs-refresh=R3'] },
    'POST /graphql': installationsRoute,
  });
  const { session } = makeSession(server, {
    cookies: {
      vid: 'OLD', 'vs-access': 'OLD', 'vs-refresh': 'OLD', 'vs-trust-abc': 'TRUST',
    },
  });

  await session.loginCookie();

  const login = server.calls[0];
  assert.deepEqual(login.cookies, { 'vs-trust-abc': 'TRUST' });
  assert.ok(login.headers.Authorization.startsWith('Basic '));
  assert.deepEqual(session.cookies, {
    vid: 'V3', 'vs-access': 'A3', 'vs-refresh': 'R3', 'vs-trust-abc': 'TRUST',
  });
});

test('loginCookie reports MFA when Verisure no longer honours the trust cookie', async () => {
  const server = fakeVerisure({ 'POST /auth/login': { text: '{"stepUpToken":"x"}' } });
  const { session } = makeSession(server, { cookies: { 'vs-trust-abc': 'REVOKED' } });
  await assert.rejects(session.loginCookie(), MfaRequiredError);
});

test('loginCookie without a stored session is a CookieReadError', async () => {
  const { session } = makeSession(fakeVerisure({}));
  await assert.rejects(session.loginCookie(), CookieReadError);
});

test('updateCookie sends only vid and vs-refresh and keeps the rest of the jar', async () => {
  const server = fakeVerisure({ 'GET /auth/token': { setCookies: ['vs-access=NEW'] } });
  const { session, saved } = makeSession(server, {
    cookies: {
      vid: 'V', 'vs-access': 'OLD', 'vs-refresh': 'R', 'vs-trust-abc': 'T',
    },
  });

  await session.updateCookie();

  assert.deepEqual(server.calls[0].cookies, { vid: 'V', 'vs-refresh': 'R' });
  assert.equal(session.cookies['vs-access'], 'NEW');
  assert.equal(session.cookies['vs-trust-abc'], 'T');
  assert.equal(saved.length, 1);
});

test('updateCookie retries generic login errors three times but not authentication errors', async () => {
  const flaky = fakeVerisure({ 'GET /auth/token': [{ status: 400 }, { status: 400 }, { setCookies: ['vs-access=OK'] }] });
  const { session } = makeSession(flaky, { cookies: { vid: 'V', 'vs-refresh': 'R' } });
  await session.updateCookie();
  assert.equal(flaky.calls.length, 3);

  const rejected = fakeVerisure({ 'GET /auth/token': { status: 401 } });
  const { session: rejectedSession } = makeSession(rejected, { cookies: { vid: 'V', 'vs-refresh': 'R' } });
  await assert.rejects(rejectedSession.updateCookie(), AuthenticationError);
  assert.equal(rejected.calls.length, 1);
});

test('a 5xx fails over to the second host, which is then tried first', async () => {
  const server = fakeVerisure({
    'POST /graphql': (call) => (call.host === 'automation01.verisure.com'
      ? { status: 503, text: 'down' }
      : { data: { ok: true } }),
  });
  const { session } = makeSession(server, { cookies: { vid: 'V' } });

  await session.request({ operationName: 'x', variables: {}, query: 'query x { ok }' });
  await session.request({ operationName: 'x', variables: {}, query: 'query x { ok }' });

  assert.deepEqual(server.calls.map((c) => c.host), [
    'automation01.verisure.com', 'automation02.verisure.com', 'automation02.verisure.com',
  ]);
});

test('SYS_00004 in a 200 body fails over to the other host', async () => {
  const server = fakeVerisure({
    'POST /graphql': (call) => (call.host === 'automation01.verisure.com'
      ? { status: 200, text: '{"errors":[{"data":{"errorCode":"SYS_00004"}}]}' }
      : { data: { ok: true } }),
  });
  const { session } = makeSession(server, { cookies: { vid: 'V' } });
  const [result] = await session.request({ operationName: 'x', variables: {}, query: 'q' });
  assert.deepEqual(result, { data: { ok: true } });
});

test('rate limits are detected from status 429 and from body markers', async () => {
  const by429 = fakeVerisure({ 'POST /graphql': { status: 429, text: '' } });
  await assert.rejects(makeSession(by429, { cookies: { vid: 'V' } }).session.request({ query: 'q' }), RateLimitError);

  const byBody = fakeVerisure({ 'POST /graphql': { status: 200, text: '{"errors":[{"message":"AUT_00021 request limit"}]}' } });
  await assert.rejects(makeSession(byBody, { cookies: { vid: 'V' } }).session.request({ query: 'q' }), RateLimitError);
});

test('4xx errors are not retried on the other host', async () => {
  const server = fakeVerisure({ 'POST /graphql': { status: 401, text: 'expired' } });
  await assert.rejects(makeSession(server, { cookies: { vid: 'V' } }).session.request({ query: 'q' }), AuthenticationError);
  assert.equal(server.calls.length, 1);

  const bad = fakeVerisure({ 'POST /auth/login': { status: 400, text: 'bad' } });
  await assert.rejects(makeSession(bad).session.login(), LoginError);
});

test('network failures on both hosts surface as RequestError', async () => {
  const server = fakeVerisure({ '*': new Error('ECONNRESET') });
  await assert.rejects(makeSession(server, { cookies: { vid: 'V' } }).session.request({ query: 'q' }), RequestError);
  assert.equal(server.calls.length, 2);
});

test('request() always resolves an array, one result per operation', async () => {
  const server = fakeVerisure({
    'POST /graphql': graphql({ ArmState: { data: { installation: { armState: { statusType: 'DISARMED' } } } } }),
  });
  const { session } = makeSession(server, { cookies: { vid: 'V' } });
  const results = await session.request({ operationName: 'ArmState', variables: {}, query: 'query ArmState { x }' });
  assert.equal(Array.isArray(results), true);
  assert.equal(results[0].data.installation.armState.statusType, 'DISARMED');
});

test('expired Set-Cookie headers remove the cookie from the jar', async () => {
  const server = fakeVerisure({ 'GET /auth/token': { setCookies: ['vs-access=; Max-Age=0', 'vs-refresh=R2'] } });
  const { session } = makeSession(server, { cookies: { vid: 'V', 'vs-access': 'A', 'vs-refresh': 'R' } });
  await session.updateCookie();
  assert.deepEqual(session.cookies, { vid: 'V', 'vs-refresh': 'R2' });
  assert.equal(VerisureSession.parseSetCookie('a=b; Expires=Thu, 01 Jan 1970 00:00:00 GMT').expired, true);
});
