'use strict';

const VerisureDriver = require('../../lib/VerisureDriver');

// Verisure camera motion detectors (CAMERAPIR) and plain PIRs. They are battery devices
// that only detect while the alarm is armed; motion arrives as an INTRUSION event.
class MotionDetectorDriver extends VerisureDriver {

  static KIND = 'motion_detector';

  devicesFromSnapshot(snapshot, installation) {
    return this.devicesOfType(snapshot, installation, ['CAMERAPIR', 'PIR'], this.homey.__('device.motion_detector'));
  }

}

module.exports = MotionDetectorDriver;
