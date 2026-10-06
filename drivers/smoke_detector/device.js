'use strict';

const ClimateDevice = require('../climate/device');

// Smoke is detected from FIRE events in the event log (see lib/events.js); the Climate
// query only provides temperature/humidity. alarm_smoke gives Homey's standard
// "Smoke detected / stopped" triggers and condition.
class SmokeDetectorDevice extends ClimateDevice {

  static KIND = 'smoke_detector';

  static MAINTENANCE_CAPABILITIES = ['alarm_tamper', 'alarm_battery'];

  async onVerisureInit() {
    // Devices paired before alarm_smoke existed get it added here.
    await this.ensureCapability('alarm_smoke');
    if (this.getCapabilityValue('alarm_smoke') === null) await this.updateCapability('alarm_smoke', false);
  }

  async onVerisureEvent(event) {
    if (event.kind !== 'fire') return;
    this.log(`Fire event ${event.type} (${event.active ? 'alarm' : 'restored'}) at ${event.time}`);
    await this.setAlarm('alarm_smoke', event.active, Number(this.getSetting('smoke_reset')) * 60 * 1000);
  }

}

module.exports = SmokeDetectorDevice;
