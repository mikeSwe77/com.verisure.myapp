'use strict';

const VerisureDevice = require('../../lib/VerisureDevice');

// Leaks arrive as WATER events in the event log (see lib/events.js).
class WaterDetectorDevice extends VerisureDevice {

  static KIND = 'water_detector';

  static MAINTENANCE_CAPABILITIES = ['alarm_tamper', 'alarm_battery'];

  async onVerisureInit() {
    if (this.getCapabilityValue('alarm_water') === null) await this.updateCapability('alarm_water', false);
  }

  async onVerisureEvent(event) {
    if (event.kind !== 'water') return;
    this.log(`Water event ${event.type} (${event.active ? 'alarm' : 'restored'}) at ${event.time}`);
    await this.setAlarm('alarm_water', event.active, Number(this.getSetting('water_reset')) * 60 * 1000);
  }

  async onSnapshot({ devices }) {
    if (!devices) return true;
    return Boolean(devices[this.deviceLabel]);
  }

}

module.exports = WaterDetectorDevice;
