'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { describeViolations } = require('../lib/armReadiness');

const sv = { 'arm_ready.violation.DOOR_WINDOW_OPEN': 'öppen' };
const translate = (key) => sv[key] || key; // Homey returns the key when untranslated

test('violations become "Room (reason)", translated where known', () => {
  assert.equal(
    describeViolations([
      { deviceLabel: 'A', violation: 'DOOR_WINDOW_OPEN' },
      { deviceLabel: 'B', violation: 'DEVICE_OFFLINE' },
    ], { A: 'Entré', B: 'Fönster sovrum' }, translate),
    'Entré (öppen), Fönster sovrum (device offline)',
  );
});

test('unknown devices fall back to their serial; no violations is an empty string', () => {
  assert.equal(describeViolations([{ deviceLabel: '1AB2 X', violation: 'DOOR_WINDOW_OPEN' }], {}, translate), '1AB2 X (öppen)');
  assert.equal(describeViolations([], {}, translate), '');
});
