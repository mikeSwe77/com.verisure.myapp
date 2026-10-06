'use strict';

const VerisureDevice = require('../../lib/VerisureDevice');

// Verisure applies plug commands with a delay, so a poll right after a command can still
// report the old state. Like Home Assistant (core PR #149479), the commanded state is
// held for 10 s — this is what made toggling "jump back" in the old Homey app.
const OPTIMISTIC_HOLD_MS = 10000;

class SmartPlugDevice extends VerisureDevice {

  static KIND = 'smart_plug';

  async onVerisureInit() {
    this._commandedAt = 0;
    this.registerCapabilityListener('onoff', async (value) => {
      this._commandedAt = Date.now();
      await this.hub.setSmartPlug(this.deviceLabel, value);
    });
  }

  async onSnapshot({ smartPlugs }) {
    if (!smartPlugs) return true;
    const plug = smartPlugs[this.deviceLabel];
    if (!plug) return false;
    if (Date.now() - this._commandedAt < OPTIMISTIC_HOLD_MS) return true;
    await this.updateCapability('onoff', plug.currentState === 'ON');
    return true;
  }

}

module.exports = SmartPlugDevice;
