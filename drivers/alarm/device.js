'use strict';

const VerisureDevice = require('../../lib/VerisureDevice');
const { describeViolations } = require('../../lib/armReadiness');

// Verisure statusType → homealarm_state. PENDING (arming in progress) has no Homey
// equivalent; the current value is kept until the change completes.
const FROM_VERISURE = {
  DISARMED: 'disarmed',
  ARMED_HOME: 'partially_armed',
  ARMED_AWAY: 'armed',
};

const TO_VERISURE = {
  disarmed: 'DISARMED',
  partially_armed: 'ARMED_HOME',
  armed: 'ARMED_AWAY',
};

// "Can the alarm be armed?" (arm dry run, see InstallationHub.checkArmReadiness). Each check
// costs ~3 API calls, so automatic checks follow HA PR #177261: after door/window activity
// (debounced) and otherwise every 30 min, never closer than 2 min apart, and not while armed.
const READINESS_DEBOUNCE_MS = 20 * 1000;
const READINESS_MIN_GAP_MS = 2 * 60 * 1000;
const READINESS_FALLBACK_MS = 30 * 60 * 1000;
const READINESS_MAX_AGE_MS = 60 * 1000; // flow cards reuse a check this recent
const READINESS_CAPABILITIES = ['verisure_arm_ready', 'verisure_arm_blockers'];

class AlarmDevice extends VerisureDevice {

  static KIND = 'alarm';

  async onVerisureInit() {
    // Migration: alarm_offline (true = down, shown red) became broadband_online (Yes/No).
    if (this.hasCapability('alarm_offline')) await this.removeCapability('alarm_offline');
    await this.ensureCapability('broadband_online');

    this._lastChangeDate = null;
    this._lastState = null;
    this._readiness = null;
    this._readinessRun = null;
    this._readinessTimer = null;
    this._lastReadinessAt = 0;
    await this._setReadinessEnabled(this.getSetting('arm_check') !== false);

    this.hub.setPollInterval(this.getSetting('poll_interval'));
    this.registerCapabilityListener('homealarm_state', async (value) => {
      await this.setArmState(TO_VERISURE[value], { forceArm: this.getSetting('force_arm') });
    });
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('poll_interval')) this.hub.setPollInterval(newSettings.poll_interval);
    if (changedKeys.includes('arm_check')) {
      // Settings are saved after this returns; apply once they are.
      this.homey.setTimeout(() => this._setReadinessEnabled(newSettings.arm_check).catch(this.error), 0);
    }
  }

  async _setReadinessEnabled(enabled) {
    this._readinessEnabled = Boolean(enabled);
    if (this._readinessEnabled) {
      for (const capability of READINESS_CAPABILITIES) await this.ensureCapability(capability);
      this.scheduleReadiness(10 * 1000);
    } else {
      this._clearReadinessTimer();
      for (const capability of READINESS_CAPABILITIES) {
        if (this.hasCapability(capability)) await this.removeCapability(capability);
      }
    }
  }

  _clearReadinessTimer() {
    if (this._readinessTimer) this.homey.clearTimeout(this._readinessTimer);
    this._readinessTimer = null;
  }

  /** Schedules an automatic readiness check, respecting the minimum gap. */
  scheduleReadiness(delayMs) {
    if (!this._readinessEnabled) return;
    this._clearReadinessTimer();
    const wait = Math.max(delayMs, this._lastReadinessAt + READINESS_MIN_GAP_MS - Date.now());
    this._readinessTimer = this.homey.setTimeout(() => {
      this._readinessTimer = null;
      this.refreshReadiness().catch((err) => this.error('Arm readiness check failed:', err.message));
    }, wait);
  }

  /**
   * Runs the dry run and updates the capabilities. Automatic checks skip while armed;
   * `force` (flow cards) always asks Verisure.
   */
  async refreshReadiness({ force = false } = {}) {
    if (!force && this.getCapabilityValue('homealarm_state') !== 'disarmed') {
      this.scheduleReadiness(READINESS_FALLBACK_MS);
      return this._readiness;
    }
    if (this._readinessRun) return this._readinessRun;
    this._readinessRun = (async () => {
      try {
        const { ready, violations } = await this.hub.checkArmReadiness();
        const names = violations.length ? await this.hub.getDeviceNames().catch(() => ({})) : {};
        const blockers = describeViolations(violations, names, (key) => this.homey.__(key));
        this._readiness = { ready, blockers, at: Date.now() };
        if (this._readinessEnabled) {
          await this.updateCapability('verisure_arm_ready', ready);
          await this.updateCapability('verisure_arm_blockers', blockers || '–');
        }
        return this._readiness;
      } finally {
        this._lastReadinessAt = Date.now();
        this._readinessRun = null;
        this.scheduleReadiness(READINESS_FALLBACK_MS);
      }
    })();
    return this._readinessRun;
  }

  /** For flow cards: a check from the last minute, or a fresh one. */
  async getReadiness() {
    if (this._readiness && Date.now() - this._readiness.at < READINESS_MAX_AGE_MS) return this._readiness;
    return this.refreshReadiness({ force: true });
  }

  _detach() {
    super._detach();
    this._clearReadinessTimer();
  }

  /**
   * Arms or disarms; fires "arming failed" on error. Uses the code from the device settings
   * unless one is given (the "Set the alarm with a code" card) — Verisure then logs the change
   * under the user that code belongs to.
   */
  async setArmState(target, { forceArm = false, code = null } = {}) {
    try {
      await this.hub.setArmState(target, code || this.getSetting('code'), { forceArm });
      const state = FROM_VERISURE[target];
      if (state) await this.updateCapability('homealarm_state', state);
    } catch (err) {
      this.error('Arm state change failed:', err.message);
      let reason = err.message;
      // When arming (not disarming) fails without force, say what is in the way.
      if (target !== 'DISARMED' && !forceArm) {
        const readiness = await this.refreshReadiness({ force: true }).catch(() => null);
        if (readiness && !readiness.ready && readiness.blockers) {
          reason = `${reason} ${this.homey.__('arm_ready.blocked_by', { devices: readiness.blockers })}`;
        }
      }
      await this.driver.armFailedTrigger
        .trigger(this, { reason, target: FROM_VERISURE[target] || target })
        .catch(this.error);
      throw new Error(reason);
    }
  }

  // Installation-wide detector triggers. Fire events are sometimes attributed to the siren
  // or gateway rather than a smoke detector, and tamper/battery events can come from devices
  // that are not in Homey (keypad), so these catch what per-device cards miss.
  async onInstallationEvents(events) {
    if (events.some((event) => event.kind === 'door')) this.scheduleReadiness(READINESS_DEBOUNCE_MS);
    for (const event of events) {
      const trigger = event.active && this.driver.detectionTriggers[event.kind];
      if (!trigger) continue;
      this.log(`${event.kind} event ${event.type} in ${event.area || '?'} at ${event.time}`);
      await trigger.trigger(this, { area: event.area || '', device: event.deviceLabel || '' }).catch(this.error);
    }
  }

  async onSnapshot(snapshot) {
    const { alarm, broadband } = snapshot;
    if (broadband) await this.updateCapability('broadband_online', broadband.isBroadbandConnected !== false);
    if (!alarm) return true;

    const state = FROM_VERISURE[alarm.statusType];
    if (state) await this.updateCapability('homealarm_state', state);
    if (state === 'disarmed' && this._lastState && this._lastState !== 'disarmed') {
      this.scheduleReadiness(READINESS_DEBOUNCE_MS);
    }
    if (state) this._lastState = state;
    await this.updateCapability('verisure_changed_by', alarm.name || '');

    // The first snapshot after start-up only establishes the baseline.
    if (this._lastChangeDate && alarm.date && alarm.date !== this._lastChangeDate && state) {
      await this.driver.changedByTrigger.trigger(this, {
        state,
        user: alarm.name || '',
        via: alarm.changedVia || '',
      }).catch(this.error);
    }
    if (alarm.date) this._lastChangeDate = alarm.date;
    return true;
  }

}

module.exports = AlarmDevice;
