'use strict';

// Verisure reports temperature (and on some models humidity) from many device types via the
// Climate query. device.gui.label is the hardware type, e.g. SMOKE2, HUMIDITY1, SIREN1,
// HOMEPAD, PIR2, VOICEBOX1. Smoke detectors get their own Homey driver (and icon); every
// other type is a "Climate sensor".

const TYPE_NAMES = {
  SMOKE: { en: 'Smoke detector', sv: 'Brandvarnare' },
  HUMIDITY: { en: 'Climate sensor', sv: 'Klimatsensor' },
  SIREN: { en: 'Siren', sv: 'Siren' },
  CAMERAPIR: { en: 'Camera motion detector', sv: 'Kamerarörelsedetektor' },
  PIR: { en: 'Motion detector', sv: 'Rörelsedetektor' },
  VOICEBOX: { en: 'VoiceBox', sv: 'VoiceBox' },
  WATER: { en: 'Water detector', sv: 'Vattenlarm' },
  HOMEPAD: { en: 'VoiceBox', sv: 'VoiceBox' }, // confirmed on real hardware; HA agrees
};

// Per-device icons for types that share the Climate driver, as paths relative to
// drivers/climate/assets/ (Homey's pairing `icon` property). Copies of Homey's built-in
// icons from homey-lib/assets/device/icons. Types not listed (HUMIDITY, SIREN, …) use the
// driver icon, which is the built-in "sensor-temperature".
// Labels come from HA's DEVICE_TYPE_NAME (const.py) plus a real installation; most are
// untested here because the hardware was not available.
const TYPE_ICONS = {
  HOMEPAD: '/icons/voicebox.svg', // built-in "intercom" (HOMEPAD1 is a VoiceBox)
  CAMERAPIR: '/icons/motion-sensor.svg', // built-in "motion-sensor"
  PIR: '/icons/motion-sensor.svg',
  WATER: '/icons/water-detector.svg', // built-in "sensor-water-leak"
  VOICEBOX: '/icons/voicebox.svg', // built-in "intercom"
};

function guiLabel(climate) {
  return String((climate.device && climate.device.gui && climate.device.gui.label) || '').toUpperCase();
}

function isSmokeDetector(climate) {
  return guiLabel(climate).startsWith('SMOKE');
}

function typeName(climate, language) {
  const label = guiLabel(climate);
  const prefix = Object.keys(TYPE_NAMES).find((key) => label.startsWith(key));
  if (!prefix) return label;
  return TYPE_NAMES[prefix][language] || TYPE_NAMES[prefix].en;
}

function hasReadings(climate) {
  return climate.temperatureValue != null || Boolean(climate.humidityEnabled);
}

/** Pairing icon for this device type, or null for the driver's own icon. */
function iconFor(climate) {
  const label = guiLabel(climate);
  const prefix = Object.keys(TYPE_ICONS).find((key) => label.startsWith(key));
  return prefix ? TYPE_ICONS[prefix] : null;
}

/** Capabilities a climate entry supports, for the pairing descriptor. */
function capabilitiesFor(climate) {
  const capabilities = [];
  if (climate.temperatureValue != null) capabilities.push('measure_temperature');
  if (climate.humidityEnabled) capabilities.push('measure_humidity');
  return capabilities;
}

module.exports = {
  isSmokeDetector, typeName, hasReadings, capabilitiesFor, iconFor,
};
