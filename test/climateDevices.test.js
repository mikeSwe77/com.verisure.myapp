'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');
const {
  isSmokeDetector, typeName, hasReadings, capabilitiesFor, iconFor,
} = require('../lib/climateDevices');

// gui labels as reported by a real installation (2026-10-06).
const climate = (label, extra = {}) => ({
  device: { deviceLabel: `L-${label}`, area: 'Kök', gui: { label } },
  temperatureValue: 21.5,
  humidityEnabled: false,
  ...extra,
});

test('only SMOKE* devices go to the smoke detector driver', () => {
  assert.equal(isSmokeDetector(climate('SMOKE')), true);
  assert.equal(isSmokeDetector(climate('SMOKE2')), true);
  for (const label of ['HOMEPAD', 'HUMIDITY', 'SIREN', 'PIR2', 'VOICEBOX1']) {
    assert.equal(isSmokeDetector(climate(label)), false, label);
  }
  assert.equal(isSmokeDetector({ device: {} }), false);
});

test('type names are translated, unknown types fall back to the label', () => {
  assert.equal(typeName(climate('SMOKE2'), 'sv'), 'Brandvarnare');
  assert.equal(typeName(climate('HOMEPAD'), 'en'), 'VoiceBox');
  assert.equal(typeName(climate('SIREN1'), 'nl'), 'Siren');
  assert.equal(typeName(climate('NEWTHING'), 'en'), 'NEWTHING');
});

test('capabilities follow what the sensor reports', () => {
  assert.deepEqual(capabilitiesFor(climate('SMOKE', { humidityEnabled: true })), ['measure_temperature', 'measure_humidity']);
  assert.deepEqual(capabilitiesFor(climate('SIREN')), ['measure_temperature']);
  assert.equal(hasReadings(climate('X', { temperatureValue: null })), false);
});

test('per-type icons: built-in Homey icons for types sharing the climate driver', () => {
  const assets = path.join(__dirname, '..', 'drivers', 'climate', 'assets');
  const expected = {
    HOMEPAD1: '/icons/voicebox.svg',
    PIR2: '/icons/motion-sensor.svg',
    CAMERAPIR2: '/icons/motion-sensor.svg',
    WATER1: '/icons/water-detector.svg',
    VOICEBOX1: '/icons/voicebox.svg',
  };
  for (const [label, icon] of Object.entries(expected)) {
    assert.equal(iconFor(climate(label)), icon, label);
    assert.ok(fs.existsSync(path.join(assets, icon)), `${icon} exists`);
  }
  // These use the driver icon (sensor-temperature).
  for (const label of ['HUMIDITY1', 'SIREN1']) assert.equal(iconFor(climate(label)), null, label);
});

test('CAMERAPIR is named as a camera detector, not a plain PIR', () => {
  assert.equal(typeName(climate('CAMERAPIR2'), 'en'), 'Camera motion detector');
  assert.equal(typeName(climate('PIR2'), 'en'), 'Motion detector');
});
