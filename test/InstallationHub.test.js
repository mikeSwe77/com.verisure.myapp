'use strict';

const { test } = require('node:test');
const { EventEmitter } = require('events');
const assert = require('node:assert/strict');

const InstallationHub = require('../lib/InstallationHub');
const { RateLimitError, ReauthRequiredError, TransactionError } = require('../lib/errors');

const { RATE_LIMIT_BACKOFF_MS } = InstallationHub;

// Stands in for VerisureAccount: answers each GraphQL operation by name.
function fakeAccount(byOperation) {
  const account = new EventEmitter();
  account.batches = [];
  account.request = async (...ops) => {
    account.batches.push(ops.map((op) => op.operationName || (op.query.match(/(?:query|mutation)\s+(\w+)/) || [])[1]));
    if (account.fail) {
      const err = account.fail;
      if (!account.failForever) account.fail = null;
      throw err;
    }
    return ops.map((op) => {
      const name = op.operationName || (op.query.match(/(?:query|mutation)\s+(\w+)/) || [])[1];
      const answer = byOperation[name];
      return typeof answer === 'function' ? answer(op.variables) : (answer || {});
    });
  };
  return account;
}

// Manual timers: nothing fires until the test calls fireNext().
function manualTimers() {
  const pending = [];
  return {
    pending,
    setTimeout: (fn, ms) => {
      const timer = { fn, ms };
      pending.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      const index = pending.indexOf(timer);
      if (index >= 0) pending.splice(index, 1);
    },
    lastDelay: () => pending.at(-1) && pending.at(-1).ms,
  };
}

const OVERVIEW = {
  ArmState: { data: { installation: { armState: { statusType: 'ARMED_HOME', name: 'Anna', date: 'd1' } } } },
  Broadband: { data: { installation: { broadband: { isBroadbandConnected: true } } } },
  DoorWindow: {
    data: {
      installation: {
        doorWindows: [
          { device: { deviceLabel: 'DW1' }, area: 'Hall', state: 'OPEN' },
          { device: { deviceLabel: 'DW2' }, area: 'Kitchen', state: 'CLOSE' },
        ],
      },
    },
  },
  Climate: { data: { installation: { climates: [{ device: { deviceLabel: 'SM1' }, temperatureValue: 21.5 }] } } },
};

function makeHub(byOperation = OVERVIEW) {
  const account = fakeAccount(byOperation);
  const timers = manualTimers();
  const hub = new InstallationHub({
    account, giid: '111', timers, sleep: async () => {},
  });
  return { hub, account, timers };
}

test('one batched poll with only the operations subscribed devices need', async () => {
  const { hub, account } = makeHub();
  hub.subscribe('alarm');
  await hub.refresh();
  assert.deepEqual(account.batches.at(-1), ['ArmState', 'Broadband', 'EventLog']);
  assert.equal(hub.snapshot.alarm.statusType, 'ARMED_HOME');
  assert.equal(hub.snapshot.doorWindows, null, 'not polled is null, not "empty"');

  hub.subscribe('door_window');
  await hub.refresh();
  assert.deepEqual(account.batches.at(-1), ['ArmState', 'Broadband', 'EventLog', 'DoorWindow']);
  assert.equal(hub.snapshot.doorWindows.DW1.state, 'OPEN');
  assert.equal(hub.snapshot.doorWindows.DW2.area, 'Kitchen');
});

test('polling repeats at the configured interval, never below 30 s', async () => {
  const { hub, timers } = makeHub();
  hub.subscribe('alarm');
  await hub.refresh();
  assert.equal(timers.lastDelay(), 60000);

  hub.setPollInterval(5);
  assert.equal(hub.pollSeconds, 30);
  assert.equal(timers.lastDelay(), 30000);
});

test('the last unsubscribe stops polling', async () => {
  const { hub, timers } = makeHub();
  const unsubscribe = hub.subscribe('alarm');
  await hub.refresh();
  assert.equal(timers.pending.length, 1);
  unsubscribe();
  assert.equal(timers.pending.length, 0);
});

test('rate limiting backs off 5, 15, 30, 60, 60 minutes and resets after a good poll', async () => {
  const { hub, account, timers } = makeHub();
  hub.subscribe('alarm');
  await hub.refresh(); // let the poll started by subscribe() settle
  const statuses = [];
  hub.on('status', (s) => statuses.push(s.state));

  account.fail = new RateLimitError('429');
  account.failForever = true;
  const delays = [];
  for (let i = 0; i < 5; i++) {
    await hub.refresh().catch(() => {});
    delays.push(timers.lastDelay());
  }
  assert.deepEqual(delays, [...RATE_LIMIT_BACKOFF_MS, RATE_LIMIT_BACKOFF_MS[3]]);
  assert.equal(statuses[0], 'warning');

  account.fail = null;
  account.failForever = false;
  await hub.refresh();
  assert.equal(timers.lastDelay(), 60000);
  assert.equal(hub.status.state, 'ok');

  account.fail = new RateLimitError('429');
  await hub.refresh().catch(() => {});
  assert.equal(timers.lastDelay(), RATE_LIMIT_BACKOFF_MS[0]);
});

test('devices go unavailable after three failed polls in a row, and recover', async () => {
  const { hub, account } = makeHub();
  hub.subscribe('alarm');
  await hub.refresh();
  account.fail = new Error('ECONNRESET');
  account.failForever = true;
  await hub.refresh().catch(() => {});
  await hub.refresh().catch(() => {});
  assert.equal(hub.status.state, 'ok');
  await hub.refresh().catch(() => {});
  assert.equal(hub.status.state, 'unavailable');

  account.failForever = false;
  account.fail = null;
  await hub.refresh();
  assert.equal(hub.status.state, 'ok');
});

test('reauth makes devices unavailable at once and polling resumes after repair', async () => {
  const { hub, account, timers } = makeHub();
  hub.subscribe('alarm');
  await hub.refresh();
  account.fail = new ReauthRequiredError('sign in again');
  await hub.refresh().catch(() => {});
  assert.equal(hub.status.state, 'unavailable');
  assert.equal(timers.pending.length, 0, 'no retry loop while waiting for the user');

  account.emit('reauthenticated');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(hub.status.state, 'ok');
});

test('arming sends the mutation, then polls the transaction until OK', async () => {
  let polls = 0;
  const { hub, account } = makeHub({
    ...OVERVIEW,
    armAway: (vars) => {
      assert.deepEqual(vars, { giid: '111', code: '1234', forceArm: true });
      return { data: { armStateArmAway: 'tx-1' } };
    },
    pollArmState: (vars) => {
      assert.deepEqual(vars, { giid: '111', transactionId: 'tx-1', futureState: 'ARMED_AWAY' });
      polls += 1;
      return { data: { installation: { armStateChangePollResult: { result: polls < 3 ? null : 'OK' } } } };
    },
  });

  await hub.setArmState('ARMED_AWAY', 1234, { forceArm: true });
  assert.equal(polls, 3);
  assert.deepEqual(account.batches[0], ['armAway']);
});

test('a rejected code is reported with Verisure\'s message', async () => {
  const { hub } = makeHub({ disarm: { data: null, errors: [{ message: 'Invalid code' }] } });
  await assert.rejects(hub.setArmState('DISARMED', '0000'), (err) => {
    assert.ok(err instanceof TransactionError);
    assert.match(err.message, /Invalid code/);
    return true;
  });
});

test('arming without a code fails before calling Verisure', async () => {
  const { hub, account } = makeHub();
  await assert.rejects(hub.setArmState('ARMED_HOME', ''), TransactionError);
  assert.equal(account.batches.length, 0);
});

test('a transaction that never confirms gives up after 30 polls', async () => {
  const { hub, account } = makeHub({
    armHome: { data: { armStateArmHome: 'tx' } },
    pollArmState: { data: { installation: { armStateChangePollResult: { result: null } } } },
  });
  await assert.rejects(hub.setArmState('ARMED_HOME', '1'), /did not confirm/);
  assert.equal(account.batches.filter((b) => b[0] === 'pollArmState').length, 30);
});

test('smart plug commands go through SmartPlugSetState', async () => {
  const { hub, account } = makeHub({ UpdateState: { data: { SmartPlugSetState: true } } });
  await hub.setSmartPlug('SP1', true);
  assert.deepEqual(account.batches[0], ['UpdateState']);
});

test('latest camera image: newest JPEG for that camera, skipping uploads in progress, cached 60 s', async () => {
  let searches = 0;
  const { hub } = makeHub({
    GQL_CCCP_SearchMedia: () => {
      searches += 1;
      return {
        data: {
          ContentProviderMediaSearch: {
            mediaSeriesList: [
              {
                deviceMediaList: [
                  { deviceLabel: 'CAM1', mediaId: '-1', contentType: 'IMAGE_JPEG' },
                  {
                    deviceLabel: 'CAM2', mediaId: 'm2', contentType: 'IMAGE_JPEG', contentUrl: 'https://x/2',
                  },
                ],
              },
              {
                deviceMediaList: [
                  { deviceLabel: 'CAM2', mediaId: 'v1', contentType: 'VIDEO_MP4' },
                  {
                    deviceLabel: 'CAM2', mediaId: 'm1', contentType: 'IMAGE_JPEG', contentUrl: 'https://x/1',
                  },
                ],
              },
            ],
          },
        },
      };
    },
  });

  assert.equal(await hub.getLatestImage('CAM1'), null);
  assert.deepEqual(await hub.getLatestImage('CAM2'), { mediaId: 'm2', contentUrl: 'https://x/2', timestamp: undefined });
  assert.equal(searches, 1);
});

test('new log events are emitted before the snapshot update, and the first poll is only a baseline', async () => {
  let log = [{
    eventId: 'old', eventCategory: 'FIRE', eventType: 'FA', device: { deviceLabel: 'S1' },
  }];
  const { hub } = makeHub({ ...OVERVIEW, EventLog: () => ({ data: { installation: { eventLog: { pagedList: log } } } }) });
  const seen = [];
  hub.on('events', (events) => seen.push(['events', events.map((e) => e.id)]));
  hub.on('update', () => seen.push(['update']));
  hub.subscribe('smoke_detector');
  await hub.refresh();
  assert.deepEqual(seen, [['update']], 'old events are not replayed at start-up');

  log = [
    {
      eventId: 'new', eventCategory: 'FIRE', eventType: 'FA', device: { deviceLabel: 'S1' },
    },
    ...log,
  ];
  seen.length = 0;
  await hub.refresh();
  assert.deepEqual(seen, [['events', ['new']], ['update']]);
});

test('detector kinds poll the Devices query, keyed by deviceLabel', async () => {
  const { hub, account } = makeHub({
    Devices: { data: { installation: { devices: [{ deviceLabel: 'P1', area: 'Hall', gui: { label: 'CAMERAPIR' } }] } } },
  });
  hub.subscribe('motion_detector');
  await hub.refresh();
  assert.deepEqual(account.batches.at(-1), ['Devices', 'EventLog']);
  assert.equal(hub.snapshot.devices.P1.area, 'Hall');
});

test('arm readiness: dry run polled until DONE, violations returned', async () => {
  let polls = 0;
  const { hub, account } = makeHub({
    ArmStateDryRun: { data: { armStateDryRun: 'tx-9' } },
    ArmStateDryRunStatus: (vars) => {
      assert.deepEqual(vars, { giid: '111', transactionId: 'tx-9' });
      polls += 1;
      return {
        data: {
          installation: {
            armState: {
              dryRunStatus: polls < 2
                ? { status: { status: 'STARTED' }, result: null }
                : { status: { status: 'DONE' }, result: { deviceViolations: [{ deviceLabel: 'DW1', violation: 'DOOR_WINDOW_OPEN', occurred: 'x' }] } },
            },
          },
        },
      };
    },
  });
  assert.deepEqual(await hub.checkArmReadiness(), {
    ready: false,
    violations: [{ deviceLabel: 'DW1', violation: 'DOOR_WINDOW_OPEN' }],
  });
  assert.equal(polls, 2);
  assert.deepEqual(account.batches.map((b) => b[0]), ['ArmStateDryRun', 'ArmStateDryRunStatus', 'ArmStateDryRunStatus']);
});

test('arm readiness: no violations means ready (as seen live)', async () => {
  const { hub } = makeHub({
    ArmStateDryRun: { data: { armStateDryRun: 'tx' } },
    ArmStateDryRunStatus: { data: { installation: { armState: { dryRunStatus: { status: { status: 'DONE' }, result: { deviceViolations: [] } } } } } },
  });
  assert.deepEqual(await hub.checkArmReadiness(), { ready: true, violations: [] });
});

test('arm readiness: errors when the check cannot start or never finishes', async () => {
  const { hub: rejected } = makeHub({ ArmStateDryRun: { data: null, errors: [{ message: 'nope' }] } });
  await assert.rejects(rejected.checkArmReadiness(), /did not start the arm check \(nope\)/);

  const { hub: stuck, account } = makeHub({
    ArmStateDryRun: { data: { armStateDryRun: 'tx' } },
    ArmStateDryRunStatus: { data: { installation: { armState: { dryRunStatus: { status: { status: 'STARTED' } } } } } },
  });
  await assert.rejects(stuck.checkArmReadiness(), /did not finish/);
  assert.equal(account.batches.filter((b) => b[0] === 'ArmStateDryRunStatus').length, 30);
});

test('device names come from the Devices query and are cached', async () => {
  let calls = 0;
  const { hub } = makeHub({
    Devices: () => {
      calls += 1;
      return { data: { installation: { devices: [{ deviceLabel: 'DW1', area: 'Entré' }, { deviceLabel: 'X' }] } } };
    },
  });
  assert.deepEqual(await hub.getDeviceNames(), { DW1: 'Entré', X: 'X' });
  await hub.getDeviceNames();
  assert.equal(calls, 1);
});
