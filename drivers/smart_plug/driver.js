'use strict';

const VerisureDriver = require('../../lib/VerisureDriver');

class SmartPlugDriver extends VerisureDriver {

  static KIND = 'smart_plug';

  devicesFromSnapshot(snapshot, installation) {
    return Object.values(snapshot.smartPlugs || {}).map((plug) => this.labelledDevice(
      installation, plug.device.deviceLabel, plug.device.area,
    ));
  }

}

module.exports = SmartPlugDriver;
