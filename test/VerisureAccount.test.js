'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const VerisureAccount = require('../lib/VerisureAccount');
const { ReauthRequiredError, RateLimitError } = require('../lib/errors');
const { fakeVerisure, graphql, INSTALLATIONS } = require('./helpers/fake-verisure');

const { COOKIE_REFRESH_INTERVAL_MS } = VerisureAccount;

function makeAccount(routes, { cookies = null } = {}) {
  const server = fakeVerisure(routes);
  let clock = 1000000;
  const persisted = [];
  const account = new VerisureAccount({
    email: 'me@example.com',
    password: 'secret',
    cookies,
    onSessionChanged: (state) => persisted.push(state),
    now: () => clock,
    sessionOptions: { transport: server.transport, sleep: async () => {} },
  });
  return {
    account,
    server,
    persisted,
    advance: (ms) => {
      clock += ms;
    },
  };
}

const paths = (server) => server.calls.map((c) => `${c.method} ${c.path}`);
const ok = graphql({ fetchAllInstallations: INSTALLATIONS, ArmState: { data: { installation: { armState: {} } } } });
const ARM = { operationName: 'ArmState', variables: {}, query: 'query ArmState { x }' };

test('start-up resumes a stored session with the trust cookie instead of a fresh login', async () => {
  const { account, server } = makeAccount({
    'POST /auth/login': { setCookies: ['vid=V'] },
    'POST /graphql': ok,
  }, { cookies: { 'vs-trust-1': 'T', vid: 'OLD' } });

  await account.request(ARM);

  assert.deepEqual(server.calls[0].cookies, { 'vs-trust-1': 'T' });
  assert.deepEqual(paths(server), ['POST /auth/login', 'POST /graphql', 'POST /graphql']);
});

test('start-up without a stored session falls back to password login', async () => {
  const { account, server } = makeAccount({
    'POST /auth/login': { setCookies: ['vid=V'] },
    'POST /graphql': ok,
  });
  await account.ensureSession();
  assert.deepEqual(server.calls[0].cookies, {});
  assert.ok(server.calls[0].headers.Authorization);
});

test('the session is refreshed via /auth/token only once 10 minutes have passed', async () => {
  const { account, server, advance } = makeAccount({
    'POST /auth/login': { setCookies: ['vid=V', 'vs-refresh=R'] },
    'GET /auth/token': { setCookies: ['vs-access=NEW'] },
    'POST /graphql': ok,
  }, { cookies: { 'vs-trust-1': 'T' } });

  await account.request(ARM);
  advance(COOKIE_REFRESH_INTERVAL_MS - 1);
  await account.request(ARM);
  assert.equal(paths(server).filter((p) => p === 'GET /auth/token').length, 0);

  advance(1);
  await account.request(ARM);
  assert.equal(paths(server).filter((p) => p === 'GET /auth/token').length, 1);
});

test('an expired refresh token recovers with the trust cookie, without the user', async () => {
  const { account, server, advance } = makeAccount({
    'POST /auth/login': { setCookies: ['vid=V2', 'vs-refresh=R2'] },
    'GET /auth/token': { status: 401, text: 'expired' },
    'POST /graphql': ok,
  }, { cookies: { 'vs-trust-1': 'T' } });

  await account.ensureSession();
  advance(COOKIE_REFRESH_INTERVAL_MS);
  await account.request(ARM);

  assert.deepEqual(paths(server), [
    'POST /auth/login', 'POST /graphql', // start-up
    'GET /auth/token', 'POST /auth/login', 'POST /graphql', // refresh → trust-cookie login
    'POST /graphql', // the actual request
  ]);
  assert.equal(account.reauthRequired, false);
});

test('when Verisure demands MFA again, the account needs reauth and stops calling the API', async () => {
  const { account, server, advance } = makeAccount({
    'POST /auth/login': [{ setCookies: ['vid=V'] }, { text: '{"stepUpToken":"x"}' }],
    'GET /auth/token': { status: 401 },
    'POST /graphql': ok,
  }, { cookies: { 'vs-trust-1': 'T' } });
  const events = [];
  account.on('reauthRequired', (reason) => events.push(reason));

  await account.ensureSession();
  advance(COOKIE_REFRESH_INTERVAL_MS);
  await assert.rejects(account.request(ARM), ReauthRequiredError);
  assert.equal(events.length, 1);

  const before = server.calls.length;
  await assert.rejects(account.request(ARM), ReauthRequiredError);
  assert.equal(server.calls.length, before, 'no further API calls while waiting for repair');
});

test('adoptSession clears the reauth state and announces it', async () => {
  const { account } = makeAccount({ 'POST /auth/login': { status: 401 } }, { cookies: { 'vs-trust-1': 'T' } });
  await assert.rejects(account.ensureSession(), ReauthRequiredError);

  let announced = false;
  account.on('reauthenticated', () => {
    announced = true;
  });
  account.adoptSession(account.session);
  assert.equal(account.reauthRequired, false);
  assert.equal(announced, true);
});

test('rate limiting during refresh is transient, not a reauth', async () => {
  const { account, advance } = makeAccount({
    'POST /auth/login': { setCookies: ['vid=V'] },
    'GET /auth/token': { status: 429 },
    'POST /graphql': ok,
  }, { cookies: { 'vs-trust-1': 'T' } });
  await account.ensureSession();
  advance(COOKIE_REFRESH_INTERVAL_MS);
  await assert.rejects(account.request(ARM), RateLimitError);
  assert.equal(account.reauthRequired, false);
});

test('a 401 on a query forces one refresh and retries the query', async () => {
  let graphqlCalls = 0;
  const { account, server } = makeAccount({
    'POST /auth/login': { setCookies: ['vid=V', 'vs-refresh=R'] },
    'GET /auth/token': { setCookies: ['vs-access=NEW'] },
    'POST /graphql': (call, ops) => {
      graphqlCalls += 1;
      if (ops[0].operationName === 'fetchAllInstallations') return INSTALLATIONS;
      return graphqlCalls === 2 ? { status: 401, text: 'expired' } : { data: { installation: { armState: {} } } };
    },
  }, { cookies: { 'vs-trust-1': 'T' } });

  const [result] = await account.request(ARM);
  assert.ok(result.data);
  assert.ok(paths(server).includes('GET /auth/token'));
});

test('concurrent requests share one start-up login', async () => {
  const { account, server } = makeAccount({
    'POST /auth/login': { setCookies: ['vid=V'] },
    'POST /graphql': ok,
  }, { cookies: { 'vs-trust-1': 'T' } });
  await Promise.all([account.request(ARM), account.request(ARM), account.request(ARM)]);
  assert.equal(paths(server).filter((p) => p === 'POST /auth/login').length, 1);
});

test('signOut revokes the trust token, logs out, stops persisting and needs reauth', async () => {
  const { account, server, persisted } = makeAccount({
    'POST /auth/login': { setCookies: ['vid=V', 'vs-refresh=R'] },
    'POST /graphql': ok,
    'DELETE /auth/trust/T1': { status: 204, text: '' },
    'DELETE /auth/logout': { status: 200, text: '' },
  }, { cookies: { 'vs-trust-1': 'T' } });
  account.session._trustToken = { trustTokenValue: 'T1' };
  await account.ensureSession();
  const savedBefore = persisted.length;
  const events = [];
  account.on('reauthRequired', (reason) => events.push(reason));

  const outcome = await account.signOut('Signed out');

  assert.deepEqual(outcome, { signedOut: true, trustRevoked: true });
  assert.deepEqual(paths(server).slice(-2), ['DELETE /auth/trust/T1', 'DELETE /auth/logout']);
  assert.equal(persisted.length, savedBefore, 'logout must not write the cleared session back');
  assert.deepEqual(events, ['Signed out']);
  await assert.rejects(account.request(ARM), ReauthRequiredError);
});

test('signOut of a session not used yet first re-establishes it with the trust cookie', async () => {
  const { account, server } = makeAccount({
    'POST /auth/login': { setCookies: ['vid=V'] },
    'POST /graphql': ok,
    'DELETE /auth/logout': { status: 200, text: '' },
  }, { cookies: { 'vs-trust-1': 'T' } });
  const outcome = await account.signOut('Signed out');
  assert.deepEqual(outcome, { signedOut: true, trustRevoked: false });
  assert.deepEqual(paths(server), ['POST /auth/login', 'POST /graphql', 'DELETE /auth/logout']);
});

test('signOut reports a remote failure but still leaves the account signed out', async () => {
  const { account } = makeAccount({
    'POST /auth/login': { setCookies: ['vid=V'] },
    'POST /graphql': ok,
    '*': { status: 503, text: 'down' },
  }, { cookies: { 'vs-trust-1': 'T' } });
  const outcome = await account.signOut('Signed out');
  assert.equal(outcome.signedOut, false);
  assert.match(outcome.error, /503/);
  assert.equal(account.reauthRequired, true);
});

test('after sign-out a repaired session is adopted and persisted again', async () => {
  const { account } = makeAccount({ 'DELETE /auth/logout': { status: 200, text: '' } }, { cookies: { 'vs-trust-1': 'T' } });
  account.markSignedOut('Signed out');
  const saved = [];
  account.adoptSession(account.session, (state) => saved.push(state));
  assert.equal(account.reauthRequired, false);
  account.session._persist();
  assert.equal(saved.length, 1);
});
