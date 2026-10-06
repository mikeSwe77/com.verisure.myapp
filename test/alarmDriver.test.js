'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// `homey` is provided by the Homey runtime, not npm; stub it before requiring the driver.
const HOMEY_STUB_ID = 'homey-test-stub';
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolveFilename(request, ...rest) {
  if (request === 'homey') return HOMEY_STUB_ID;
  return originalResolve.call(this, request, ...rest);
};
require.cache[HOMEY_STUB_ID] = {
  id: HOMEY_STUB_ID,
  filename: HOMEY_STUB_ID,
  loaded: true,
  exports: { Device: class {}, Driver: class {}, App: class {} },
};

const AlarmDriver = require('../drivers/alarm/driver');
const AlarmDevice = require('../drivers/alarm/device');

// A driver whose flow cards record their run listeners, initialised like Homey would.
async function makeDriver() {
  const listeners = {};
  const card = (id) => ({
    registerRunListener(fn) {
      listeners[id] = fn; return this;
    },
    trigger: async () => {},
  });
  const driver = Object.create(AlarmDriver.prototype);
  driver.homey = {
    __: (key) => key,
    flow: {
      getActionCard: card, getConditionCard: card, getDeviceTriggerCard: card,
    },
  };
  await driver.onInit();
  return { driver, run: (id, args) => listeners[id](args) };
}

function fakeDevice() {
  const calls = [];
  return { calls, setArmState: async (target, options) => calls.push([target, options]) };
}

test('"Set the alarm with a code" maps the mode and passes the code', async () => {
  const { run } = await makeDriver();
  const device = fakeDevice();
  await run('set_alarm_with_code', {
    device, mode: 'away', code: ' 123456 ', force: 'yes',
  });
  await run('set_alarm_with_code', {
    device, mode: 'home', code: '1234', force: 'no',
  });
  assert.deepEqual(device.calls, [
    ['ARMED_AWAY', { code: '123456', forceArm: true }],
    ['ARMED_HOME', { code: '1234', forceArm: false }],
  ]);
});

test('force arm is never sent when disarming', async () => {
  const { run } = await makeDriver();
  const device = fakeDevice();
  await run('set_alarm_with_code', {
    device, mode: 'disarm', code: '1234', force: 'yes',
  });
  assert.deepEqual(device.calls, [['DISARMED', { code: '1234', forceArm: false }]]);
});

test('codes that are not 4–8 digits are rejected before calling Verisure', async () => {
  const { run } = await makeDriver();
  const device = fakeDevice();
  for (const code of ['', '12', '12a4', '123456789', '12 34']) {
    await assert.rejects(run('set_alarm_with_code', {
      device, mode: 'away', code, force: 'no',
    }), /arm_code\.invalid/, `code ${JSON.stringify(code)}`);
  }
  assert.equal(device.calls.length, 0);
});

test('the device uses the given code instead of the one in settings', async () => {
  const device = Object.create(AlarmDevice.prototype);
  const sent = [];
  Object.assign(device, {
    hub: { setArmState: async (target, code, options) => sent.push([target, code, options]) },
    getSetting: (key) => ({ code: '0000' })[key],
    updateCapability: async () => {},
  });
  await device.setArmState('DISARMED', { code: '4321' });
  await device.setArmState('DISARMED');
  assert.deepEqual(sent, [
    ['DISARMED', '4321', { forceArm: false }],
    ['DISARMED', '0000', { forceArm: false }],
  ]);
});
