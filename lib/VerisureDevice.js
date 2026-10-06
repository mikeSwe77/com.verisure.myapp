'use strict';

const Homey = require('homey');

// Base class for every Verisure device. Subclasses set `static KIND` (a key of
// InstallationHub.POLL_OPERATIONS) and implement `onSnapshot(snapshot)`, which maps
// the hub's latest poll onto capabilities.
//
// Device data: { id, giid, deviceLabel? }   store: { email }

class VerisureDevice extends Homey.Device {

  async onInit() {
    const { giid } = this.getData();
    this.giid = giid;
    this.deviceLabel = this.getData().deviceLabel || null;
    this._missing = false;
    this._hubStatus = { state: 'ok', message: null };

    try {
      this.hub = this.homey.app.getHub(this.getStore().email, giid);
    } catch (err) {
      await this.setUnavailable(err.message).catch(this.error);
      return;
    }

    this._resetTimers = new Map();
    // Events and snapshots are applied strictly in the order the hub emits them (events
    // first, then the polled state), even though each handler is async.
    this._queue = Promise.resolve();
    const enqueue = (fn) => {
      this._queue = this._queue.then(fn).catch((err) => this.error(err));
      return this._queue;
    };
    this._onEvents = (events) => enqueue(() => this._handleEvents(events));
    this._onUpdate = (snapshot) => enqueue(() => this._handleSnapshot(snapshot));
    this._onStatus = (status) => {
      this._hubStatus = status;
      this._applyAvailability().catch(this.error);
    };
    this.hub.on('events', this._onEvents);
    this.hub.on('update', this._onUpdate);
    this.hub.on('status', this._onStatus);

    // Tamper and low battery come from the event log for any device; battery-powered
    // sensor drivers list them in MAINTENANCE_CAPABILITIES so they show from the start
    // (and are added to devices paired before they existed).
    for (const capability of this.constructor.MAINTENANCE_CAPABILITIES || []) {
      await this.ensureCapability(capability);
      if (this.getCapabilityValue(capability) === null) await this.updateCapability(capability, false);
    }

    await this.onVerisureInit();

    this._hubStatus = this.hub.status;
    if (this.hub.snapshot) await this._handleSnapshot(this.hub.snapshot);
    else await this._applyAvailability();
    this._unsubscribe = this.hub.subscribe(this.constructor.KIND);
  }

  /** Hook for subclass set-up that must run before the first snapshot. */
  async onVerisureInit() {
    // Optional in subclasses.
  }

  /** Map a hub snapshot onto capabilities. Return false if this device is not in it. */
  async onSnapshot(snapshot) { // eslint-disable-line no-unused-vars
    return true;
  }

  /**
   * Called for each new event-log event about this device (matched on deviceLabel),
   * oldest first. See lib/events.js for the event shape.
   */
  async onVerisureEvent(event) { // eslint-disable-line no-unused-vars
    // Optional in subclasses.
  }

  /** Called with every new event of the installation (for installation-wide triggers). */
  async onInstallationEvents(events) { // eslint-disable-line no-unused-vars
    // Optional in subclasses.
  }

  async _handleEvents(events) {
    try {
      await this.onInstallationEvents(events);
    } catch (err) {
      this.error('Failed to handle installation events:', err);
    }
    if (!this.deviceLabel) return;
    for (const event of events) {
      if (event.deviceLabel !== this.deviceLabel) continue;
      try {
        // Held until Verisure reports the restore code (TR / XR): these are states, not pulses.
        if (event.kind === 'tamper') await this.setAlarm('alarm_tamper', event.active);
        else if (event.kind === 'battery') await this.setAlarm('alarm_battery', event.active);
        else await this.onVerisureEvent(event);
      } catch (err) {
        this.error('Failed to handle event:', err);
      }
    }
  }

  /**
   * Sets a boolean alarm capability and, when `resetMs` > 0, clears it again after that
   * delay — the same behaviour as a motion sensor. A new activation restarts the timer.
   */
  async setAlarm(capability, active, resetMs = 0) {
    const pending = this._resetTimers.get(capability);
    if (pending) this.homey.clearTimeout(pending);
    this._resetTimers.delete(capability);
    await this.ensureCapability(capability);
    await this.updateCapability(capability, Boolean(active));
    if (active && resetMs > 0) {
      this._resetTimers.set(capability, this.homey.setTimeout(() => {
        this._resetTimers.delete(capability);
        this.updateCapability(capability, false).catch(this.error);
      }, resetMs));
    }
  }

  async _handleSnapshot(snapshot) {
    try {
      const present = await this.onSnapshot(snapshot);
      this._missing = present === false;
    } catch (err) {
      this.error('Failed to apply update:', err);
    }
    await this._applyAvailability().catch(this.error);
  }

  async _applyAvailability() {
    const { state, message } = this._hubStatus;
    if (state === 'unavailable') {
      await this.setUnavailable(message);
      return;
    }
    if (this._missing) {
      await this.setUnavailable(this.homey.__('device.missing'));
      return;
    }
    if (!this.getAvailable()) await this.setAvailable();
    if (state === 'warning') await this.setWarning(message);
    else await this.unsetWarning();
  }

  /** setCapabilityValue that skips unknown capabilities, unchanged values and nulls. */
  async updateCapability(capability, value) {
    if (value === null || value === undefined || Number.isNaN(value)) return;
    if (!this.hasCapability(capability)) return;
    if (this.getCapabilityValue(capability) === value) return;
    await this.setCapabilityValue(capability, value).catch((err) => this.error(`Failed to set ${capability}:`, err.message));
  }

  async ensureCapability(capability) {
    if (!this.hasCapability(capability)) await this.addCapability(capability);
  }

  _detach() {
    if (this._unsubscribe) this._unsubscribe();
    this._unsubscribe = null;
    for (const timer of (this._resetTimers || new Map()).values()) this.homey.clearTimeout(timer);
    if (this._resetTimers) this._resetTimers.clear();
    if (this.hub) {
      this.hub.off('events', this._onEvents);
      this.hub.off('update', this._onUpdate);
      this.hub.off('status', this._onStatus);
    }
  }

  async onUninit() {
    this._detach();
  }

  async onDeleted() {
    this._detach();
  }

}

module.exports = VerisureDevice;
