'use strict';

const VerisureDevice = require('../../lib/VerisureDevice');

// Open/closed comes from two sources:
//  - the event log: every DOORWINDOW_STATE_CHANGE_OPENED / _CLOSED, applied oldest first, so a
//    door opened and closed between two polls still fires both triggers;
//  - the DoorWindow query (polled state), applied afterwards as the final word.
class DoorWindowDevice extends VerisureDevice {

  static KIND = 'door_window';

  static MAINTENANCE_CAPABILITIES = ['alarm_tamper', 'alarm_battery'];

  async onVerisureEvent(event) {
    if (event.kind !== 'door') return;
    await this.updateCapability('alarm_contact', event.active);
  }

  async onSnapshot({ doorWindows }) {
    if (!doorWindows) return true; // not polled yet
    const sensor = doorWindows[this.deviceLabel];
    if (!sensor) return false;
    // Verisure reports OPEN / CLOSE; HA treats anything but OPEN as closed.
    await this.updateCapability('alarm_contact', sensor.state === 'OPEN');
    return true;
  }

}

module.exports = DoorWindowDevice;
