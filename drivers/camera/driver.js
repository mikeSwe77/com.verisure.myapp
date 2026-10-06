'use strict';

const VerisureDriver = require('../../lib/VerisureDriver');

class CameraDriver extends VerisureDriver {

  static KIND = 'camera';

  async onInit() {
    this.newImageTrigger = this.homey.flow.getDeviceTriggerCard('new_image');
    this.homey.flow.getActionCard('capture_image')
      .registerRunListener(async ({ device }) => device.capture());
  }

  devicesFromSnapshot(snapshot, installation) {
    return Object.values(snapshot.cameras || {}).map((camera) => this.labelledDevice(
      installation, camera.device.deviceLabel, camera.device.area,
    ));
  }

}

module.exports = CameraDriver;
