'use strict';

const VerisureDriver = require('../../lib/VerisureDriver');

class WaterDetectorDriver extends VerisureDriver {

  static KIND = 'water_detector';

  devicesFromSnapshot(snapshot, installation) {
    return this.devicesOfType(snapshot, installation, ['WATER'], this.homey.__('device.water_detector'));
  }

}

module.exports = WaterDetectorDriver;
