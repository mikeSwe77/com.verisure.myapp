'use strict';

const VerisureDevice = require('../../lib/VerisureDevice');

class MotionDetectorDevice extends VerisureDevice {

  static KIND = 'motion_detector';

  static MAINTENANCE_CAPABILITIES = ['alarm_tamper', 'alarm_battery'];

  async onVerisureInit() {
    if (this.getCapabilityValue('alarm_motion') === null) await this.updateCapability('alarm_motion', false);
  }

  async onVerisureEvent(event) {
    if (event.kind !== 'intrusion') return;
    this.log(`Intrusion event ${event.type} at ${event.time}`);
    await this.setAlarm('alarm_motion', event.active, Number(this.getSetting('motion_reset')) * 1000);
  }

  async onSnapshot({ devices }) {
    if (!devices) return true;
    return Boolean(devices[this.deviceLabel]);
  }

}

module.exports = MotionDetectorDevice;
