'use strict';

const ClimateDriver = require('../climate/driver');
const { isSmokeDetector } = require('../../lib/climateDevices');

// Verisure smoke detectors report temperature (and usually humidity) through the Climate
// query. The API exposes no smoke/fire state for them (python-verisure issue #180), so this
// driver has no alarm_smoke capability; fire alarms would come from the event log.
class SmokeDetectorDriver extends ClimateDriver {

  static KIND = 'smoke_detector';

  includes(climate) {
    return isSmokeDetector(climate);
  }

}

module.exports = SmokeDetectorDriver;
