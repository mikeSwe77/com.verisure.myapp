'use strict';

const VerisureDriver = require('../../lib/VerisureDriver');

class DoorWindowDriver extends VerisureDriver {

  static KIND = 'door_window';

  devicesFromSnapshot(snapshot, installation) {
    return Object.values(snapshot.doorWindows || {}).map((sensor) => this.labelledDevice(
      installation, sensor.device.deviceLabel, sensor.device.area || sensor.area,
    ));
  }

}

module.exports = DoorWindowDriver;
