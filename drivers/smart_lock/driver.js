'use strict';

const VerisureDriver = require('../../lib/VerisureDriver');

class SmartLockDriver extends VerisureDriver {

  static KIND = 'smart_lock';

  async onInit() {
    this.homey.flow.getActionCard('set_autolock')
      .registerRunListener(async ({ device, enabled }) => {
        await device.hub.setAutolock(device.deviceLabel, enabled === 'on');
      });
  }

  devicesFromSnapshot(snapshot, installation) {
    return Object.values(snapshot.smartLocks || {}).map((lock) => this.labelledDevice(
      installation, lock.device.deviceLabel, lock.device.area,
    ));
  }

}

module.exports = SmartLockDriver;
