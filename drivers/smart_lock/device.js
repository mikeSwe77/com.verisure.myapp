'use strict';

const VerisureDevice = require('../../lib/VerisureDevice');

// Ported from Home Assistant's lock platform (reference/ha_verisure/lock.py). Not tested
// against real hardware by this project yet.
const OPTIMISTIC_HOLD_MS = 10000;

class SmartLockDevice extends VerisureDevice {

  static KIND = 'smart_lock';

  async onVerisureInit() {
    this._commandedAt = 0;
    this.registerCapabilityListener('locked', async (value) => {
      this._commandedAt = Date.now();
      await this.hub.setLock(this.deviceLabel, value, this.getSetting('code'));
    });
  }

  async onSnapshot({ smartLocks }) {
    if (!smartLocks) return true;
    const lock = smartLocks[this.deviceLabel];
    if (!lock) return false;
    await this.updateCapability('verisure_changed_by', (lock.user && lock.user.name) || '');
    if (Date.now() - this._commandedAt < OPTIMISTIC_HOLD_MS) return true;
    await this.updateCapability('locked', lock.lockStatus === 'LOCKED');
    return true;
  }

}

module.exports = SmartLockDevice;
