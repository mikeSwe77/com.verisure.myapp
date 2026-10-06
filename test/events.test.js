'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { classify, EventTracker } = require('../lib/events');

function pick(event) {
  return event && { kind: event.kind, active: event.active, deviceLabel: event.deviceLabel };
}

const entry = (eventId, eventCategory, eventType, deviceLabel = 'D1', eventTime = '2026-10-06T15:00:00.000Z') => ({
  eventId, eventCategory, eventType, eventTime, device: { deviceLabel, area: 'Kök' }, gatewayArea: 'Hall',
});

test('door/window events as seen live (2026-10-06)', () => {
  assert.deepEqual(
    pick(classify(entry('1', 'DOORWINDOW_STATE_OPENED', 'DOORWINDOW_STATE_CHANGE_OPENED', '1AB2 CD34'))),
    { kind: 'door', active: true, deviceLabel: '1AB2 CD34' },
  );
  assert.deepEqual(
    pick(classify(entry('2', 'DOORWINDOW_STATE_CLOSED', 'DOORWINDOW_STATE_CHANGE_CLOSED', '1AB2 CD34'))),
    { kind: 'door', active: false, deviceLabel: '1AB2 CD34' },
  );
});

test('fire, water, intrusion and tamper follow the SIA alarm/restore codes', () => {
  assert.deepEqual(pick(classify(entry('1', 'FIRE', 'FA'))), { kind: 'fire', active: true, deviceLabel: 'D1' });
  assert.deepEqual(pick(classify(entry('2', 'FIRE', 'FR'))), { kind: 'fire', active: false, deviceLabel: 'D1' });
  assert.deepEqual(pick(classify(entry('3', 'WATER', 'WA'))), { kind: 'water', active: true, deviceLabel: 'D1' });
  assert.deepEqual(pick(classify(entry('4', 'WATER', 'WR'))), { kind: 'water', active: false, deviceLabel: 'D1' });
  assert.deepEqual(pick(classify(entry('5', 'INTRUSION', 'BA'))), { kind: 'intrusion', active: true, deviceLabel: 'D1' });
  assert.deepEqual(pick(classify(entry('6', 'TECHNICAL', 'TA'))), { kind: 'tamper', active: true, deviceLabel: 'D1' });
  assert.deepEqual(pick(classify(entry('7', 'TECHNICAL', 'TR'))), { kind: 'tamper', active: false, deviceLabel: 'D1' });
});

test('battery low / replaced (XT / XR) and tamper win over the category', () => {
  assert.deepEqual(pick(classify(entry('1', 'TECHNICAL', 'XT'))), { kind: 'battery', active: true, deviceLabel: 'D1' });
  assert.deepEqual(pick(classify(entry('2', 'TECHNICAL', 'XR'))), { kind: 'battery', active: false, deviceLabel: 'D1' });
  assert.deepEqual(pick(classify(entry('3', 'INTRUSION', 'TA'))), { kind: 'tamper', active: true, deviceLabel: 'D1' });
});

test('unknown codes in a detector category still count as an alarm', () => {
  assert.deepEqual(pick(classify(entry('1', 'FIRE', 'XYZ'))), { kind: 'fire', active: true, deviceLabel: 'D1' });
});

test('arm, disarm and climate events are not detector events', () => {
  assert.equal(classify(entry('1', 'ARM', 'CJ')), null);
  assert.equal(classify(entry('2', 'DISARM', 'OS')), null);
  assert.equal(classify(entry('3', 'CLIMATE', 'MJ')), null);
});

test('area falls back to the gateway area when the device has none', () => {
  const event = classify({ ...entry('1', 'FIRE', 'FA'), device: { deviceLabel: 'S1' } });
  assert.equal(event.area, 'Hall');
});

test('tracker: first batch is the baseline, later batches yield only new events, oldest first', () => {
  const tracker = new EventTracker();
  // The log is newest first.
  assert.deepEqual(tracker.take([entry('b', 'FIRE', 'FA'), entry('a', 'WATER', 'WA')]), []);

  const fresh = tracker.take([
    entry('d', 'DOORWINDOW_STATE_CLOSED', 'DOORWINDOW_STATE_CHANGE_CLOSED'),
    entry('c', 'DOORWINDOW_STATE_OPENED', 'DOORWINDOW_STATE_CHANGE_OPENED'),
    entry('b', 'FIRE', 'FA'),
  ]);
  assert.deepEqual(fresh.map((e) => [e.id, e.active]), [['c', true], ['d', false]]);
  assert.deepEqual(tracker.take([entry('d', 'X', 'Y')]), []);
});

test('tracker: an empty first batch still sets the baseline', () => {
  const tracker = new EventTracker();
  assert.deepEqual(tracker.take([]), []);
  assert.equal(tracker.take([entry('a', 'FIRE', 'FA')]).length, 1);
});
