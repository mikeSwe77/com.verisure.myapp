'use strict';

const { EventEmitter } = require('events');
const operations = require('./operations');
const { graphqlErrorText } = require('./VerisureSession');
const { RateLimitError, ReauthRequiredError, TransactionError } = require('./errors');
const { EventTracker } = require('./events');

// Polls one Verisure installation (giid) and fans the result out to its Homey devices.
//
// Port of Home Assistant's coordinator `_async_update_data` (reference/ha_verisure/
// coordinator.py): every poll is ONE batched POST /graphql. Unlike HA, the batch only
// contains the operations some paired device actually needs — fewer fields, same single
// call. Verisure counts calls per account and blocks accounts that poll too often (the
// old Homey app's 5 s polling got users blocked daily in 2023), so the floor is 30 s.

// detectorEvents = the event log (fire, water, intrusion, door open/close). It rides in the
// same batched request, so detectors add no extra API calls.
const POLL_OPERATIONS = {
  alarm: ['armState', 'broadband', 'detectorEvents'],
  door_window: ['doorWindow', 'detectorEvents'],
  climate: ['climate'],
  smoke_detector: ['climate', 'detectorEvents'],
  motion_detector: ['devices', 'detectorEvents'],
  water_detector: ['devices', 'detectorEvents'],
  smart_plug: ['smartplugs'],
  smart_lock: ['smartLock'],
  camera: ['cameras'],
};

const DEFAULT_POLL_SECONDS = 60;
const MIN_POLL_SECONDS = 30;
const RATE_LIMIT_BACKOFF_MS = [5, 15, 30, 60].map((minutes) => minutes * 60 * 1000);
const UNAVAILABLE_AFTER_FAILURES = 3;
const TRANSACTION_ATTEMPTS = 30;
const TRANSACTION_DELAY_MS = 500;
const IMAGE_SERIES_MIN_AGE_MS = 60 * 1000;
const DEVICE_NAMES_MAX_AGE_MS = 60 * 60 * 1000;

function byDeviceLabel(list) {
  const map = {};
  for (const item of list || []) {
    // Most queries nest the label under `device`; the Devices query has it on the item.
    const label = item && ((item.device && item.device.deviceLabel) || item.deviceLabel);
    if (label) map[label] = item;
  }
  return map;
}

// HA's unpack(): find `key` under data.installation in any of the batched results.
function unpack(results, key) {
  for (const result of results) {
    const installation = result && result.data && result.data.installation;
    if (installation && installation[key] !== undefined) return installation[key];
  }
  return undefined;
}

// A section is null when it was not part of this poll (no device of that kind was
// subscribed yet) and a label-keyed object when it was — devices must not treat "not
// polled" as "removed from the installation".
function toSnapshot(results) {
  const list = (key) => {
    const value = unpack(results, key);
    return value === undefined ? null : byDeviceLabel(value);
  };
  return {
    alarm: unpack(results, 'armState') || null,
    broadband: unpack(results, 'broadband') || null,
    doorWindows: list('doorWindows'),
    climates: list('climates'),
    smartPlugs: list('smartplugs'),
    smartLocks: list('smartLocks'),
    cameras: list('cameras'),
    devices: list('devices'),
  };
}

function eventEntries(results) {
  const log = unpack(results, 'eventLog');
  return log ? log.pagedList || [] : null;
}

class InstallationHub extends EventEmitter {

  /**
   * @param {object}   options
   * @param {VerisureAccount} options.account
   * @param {string}   options.giid
   * @param {object}   options.timers   { setTimeout, clearTimeout } — pass homey's in the app
   * @param {Function} [options.sleep]
   * @param {Function} [options.now]
   * @param {Function} [options.log]
   */
  constructor({
    account, giid, timers, sleep, now = Date.now, log = () => {},
  }) {
    super();
    this.account = account;
    this.giid = giid;
    this._timers = timers;
    this._sleep = sleep || ((ms) => new Promise((resolve) => timers.setTimeout(resolve, ms)));
    this._now = now;
    this._log = log;
    this._subscribers = new Map(); // kind -> count
    this._pollSeconds = DEFAULT_POLL_SECONDS;
    this._timer = null;
    this._inFlight = null;
    this._backoffLevel = 0;
    this._failures = 0;
    this._stopped = true;
    this._imageSeries = null;
    this._imageSeriesAt = 0;
    this.snapshot = null;
    this.status = { state: 'ok', message: null };
    this._events = new EventTracker();

    this._onReauthenticated = () => {
      this._log('Account re-authenticated; resuming polling');
      if (!this._stopped) this.refresh().catch(() => {});
    };
    this._onReauthRequired = (reason) => this._setStatus('unavailable', reason);
    account.on('reauthenticated', this._onReauthenticated);
    account.on('reauthRequired', this._onReauthRequired);
  }

  get pollSeconds() {
    return this._pollSeconds;
  }

  setPollInterval(seconds) {
    const value = Math.max(MIN_POLL_SECONDS, Number(seconds) || DEFAULT_POLL_SECONDS);
    if (value === this._pollSeconds) return;
    this._pollSeconds = value;
    if (!this._stopped && !this._inFlight) this._schedule(value * 1000);
  }

  /**
   * Registers interest in a kind of device (a key of POLL_OPERATIONS). Polling runs while
   * at least one subscriber exists. Returns an unsubscribe function.
   */
  subscribe(kind) {
    if (!POLL_OPERATIONS[kind]) throw new Error(`Unknown device kind: ${kind}`);
    this._subscribers.set(kind, (this._subscribers.get(kind) || 0) + 1);
    if (this._stopped) {
      this._stopped = false;
      this.refresh().catch(() => {});
    } else if (this._subscribers.get(kind) === 1) {
      // A new kind needs data the last poll did not fetch.
      this.refresh().catch(() => {});
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const count = this._subscribers.get(kind) - 1;
      if (count > 0) this._subscribers.set(kind, count);
      else this._subscribers.delete(kind);
      if (this._subscribers.size === 0) this.stop();
    };
  }

  get isIdle() {
    return this._subscribers.size === 0;
  }

  stop() {
    this._stopped = true;
    if (this._timer) this._timers.clearTimeout(this._timer);
    this._timer = null;
  }

  destroy() {
    this.stop();
    this.account.off('reauthenticated', this._onReauthenticated);
    this.account.off('reauthRequired', this._onReauthRequired);
    this.removeAllListeners();
  }

  _schedule(delayMs) {
    if (this._timer) this._timers.clearTimeout(this._timer);
    this._timer = null;
    if (this._stopped) return;
    this._timer = this._timers.setTimeout(() => {
      this._timer = null;
      this.refresh().catch(() => {});
    }, delayMs);
  }

  _setStatus(state, message = null) {
    if (this.status.state === state && this.status.message === message) return;
    this.status = { state, message };
    this.emit('status', this.status);
  }

  /** Polls now (or joins a poll already in flight). Resolves the new snapshot. */
  refresh() {
    if (!this._inFlight) {
      this._inFlight = this._poll().finally(() => {
        this._inFlight = null;
      });
    }
    return this._inFlight;
  }

  /** Polls a couple of seconds from now — after a command, to pick up the new state. */
  refreshSoon(delayMs = 2000) {
    this._schedule(delayMs);
  }

  _pollOperations() {
    const names = new Set();
    for (const kind of this._subscribers.keys()) {
      for (const name of POLL_OPERATIONS[kind]) names.add(name);
    }
    return [...names].map((name) => operations[name](this.giid));
  }

  async _poll() {
    const ops = this._pollOperations();
    if (ops.length === 0) return this.snapshot;
    try {
      const results = await this.account.request(...ops);
      this.snapshot = toSnapshot(results);
      this._backoffLevel = 0;
      this._failures = 0;
      this._setStatus('ok');
      // Events first (oldest first), then the polled state: a door opened and closed
      // between two polls still fires both triggers, and the final state wins.
      const entries = eventEntries(results);
      if (entries) {
        const events = this._events.take(entries);
        if (events.length) this.emit('events', events);
      }
      this.emit('update', this.snapshot);
      this._schedule(this._pollSeconds * 1000);
      return this.snapshot;
    } catch (err) {
      this._handlePollError(err);
      throw err;
    }
  }

  _handlePollError(err) {
    if (err instanceof ReauthRequiredError) {
      // Nothing to retry until the user repairs; 'reauthenticated' restarts polling.
      if (this._timer) this._timers.clearTimeout(this._timer);
      this._timer = null;
      this._setStatus('unavailable', err.message);
      return;
    }
    if (err instanceof RateLimitError) {
      const level = Math.min(this._backoffLevel, RATE_LIMIT_BACKOFF_MS.length - 1);
      const retryIn = RATE_LIMIT_BACKOFF_MS[level];
      this._backoffLevel = Math.min(this._backoffLevel + 1, RATE_LIMIT_BACKOFF_MS.length - 1);
      this._log(`Rate limited by Verisure; next attempt in ${retryIn / 60000} min`);
      this._setStatus('warning', `Verisure is limiting requests; retrying in ${retryIn / 60000} minutes.`);
      this._schedule(retryIn);
      return;
    }
    this._failures += 1;
    this._log(`Poll failed (${this._failures}): ${err.message}`);
    if (this._failures >= UNAVAILABLE_AFTER_FAILURES) {
      this._setStatus('unavailable', `Cannot reach Verisure: ${err.message}`);
    }
    this._schedule(this._pollSeconds * 1000);
  }

  // HA's transaction polling for arm/lock commands: up to 30 polls, 0.5 s apart from the
  // third attempt on, until the result is non-null.
  async _awaitTransaction(buildOp, extract) {
    for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt++) {
      if (attempt > 1) await this._sleep(TRANSACTION_DELAY_MS);
      const [result] = await this.account.request(buildOp());
      const value = extract(result);
      if (value !== null && value !== undefined) return value;
    }
    return null;
  }

  async _mutate(op, rejectedMessage) {
    const [result] = await this.account.request(op);
    const data = result && result.data;
    // The result field usually matches the operation name (DoorLock → data.DoorLock) but
    // not always (UpdateState → data.SmartPlugSetState); a mutation has one field either way.
    const value = data && (data[op.operationName] ?? Object.values(data)[0]);
    if (value === null || value === undefined) {
      const detail = graphqlErrorText(result);
      throw new TransactionError(detail ? `${rejectedMessage} (${detail})` : rejectedMessage);
    }
    return value;
  }

  /**
   * Arms or disarms. `target` is ARMED_AWAY, ARMED_HOME or DISARMED. Resolves once
   * Verisure confirms the change; throws when the code is rejected or it times out.
   */
  async setArmState(target, code, { forceArm = false } = {}) {
    if (!code) throw new TransactionError('No alarm code set. Enter your Verisure code in the alarm device settings.');
    let op;
    if (target === 'DISARMED') op = operations.disarm(this.giid, String(code));
    else if (target === 'ARMED_HOME') op = operations.armHome(this.giid, String(code), forceArm);
    else if (target === 'ARMED_AWAY') op = operations.armAway(this.giid, String(code), forceArm);
    else throw new Error(`Unknown arm state: ${target}`);

    let transactionId;
    try {
      // armStateArmAway / armStateArmHome / armStateDisarm return the transaction id.
      const [result] = await this.account.request(op);
      transactionId = result && result.data && Object.values(result.data)[0];
      if (!transactionId) {
        const detail = graphqlErrorText(result);
        throw new TransactionError(`Verisure did not accept the request. Check your code; repeated wrong codes lock the account for a while.${detail ? ` (${detail})` : ''}`);
      }
    } finally {
      this.refreshSoon();
    }

    const outcome = await this._awaitTransaction(
      () => operations.pollArmState(this.giid, transactionId, target),
      (r) => r && r.data && r.data.installation
        && r.data.installation.armStateChangePollResult
        && r.data.installation.armStateChangePollResult.result,
    );
    this.refreshSoon();
    if (outcome !== 'OK') {
      throw new TransactionError(outcome
        ? `Verisure reported ${outcome}. A door or window may be open — try force arming.`
        : 'Verisure did not confirm the change in time.');
    }
  }

  async setSmartPlug(deviceLabel, on) {
    await this._mutate(operations.setSmartplug(this.giid, deviceLabel, Boolean(on)), 'Verisure did not accept the smart plug command');
    this.refreshSoon();
  }

  async setLock(deviceLabel, locked, code) {
    if (!code) throw new TransactionError('No lock code set. Enter your code in the lock device settings.');
    const op = locked
      ? operations.doorLock(this.giid, deviceLabel, String(code))
      : operations.doorUnlock(this.giid, deviceLabel, String(code));
    const transactionId = await this._mutate(op, 'Verisure did not accept the lock command');
    const futureState = locked ? 'LOCKED' : 'UNLOCKED';
    const outcome = await this._awaitTransaction(
      () => operations.pollLockState(this.giid, transactionId, deviceLabel, futureState),
      (r) => r && r.data && r.data.installation
        && r.data.installation.doorLockStateChangePollResult
        && r.data.installation.doorLockStateChangePollResult.result,
    );
    this.refreshSoon();
    if (outcome !== 'OK') {
      throw new TransactionError(outcome ? `Verisure reported ${outcome}` : 'The lock did not confirm the change in time.');
    }
  }

  async setAutolock(deviceLabel, enabled) {
    await this._mutate(operations.setAutolockEnabled(this.giid, deviceLabel, Boolean(enabled)), 'Verisure did not accept the auto-lock change');
  }

  /**
   * Asks a camera to take a picture (HA smartcam_capture). Resolves true once Verisure
   * reports the image AVAILABLE.
   */
  async captureImage(deviceLabel) {
    const [request] = await this.account.request(operations.cameraGetRequestId(this.giid, deviceLabel));
    const requestId = request && request.data && request.data.ContentProviderCaptureImageRequest
      && request.data.ContentProviderCaptureImageRequest.requestId;
    if (!requestId) {
      throw new TransactionError(`Verisure did not accept the capture request${graphqlErrorText(request) ? ` (${graphqlErrorText(request)})` : ''}`);
    }
    let status = null;
    for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS && status !== 'AVAILABLE'; attempt++) {
      if (attempt > 1) await this._sleep(TRANSACTION_DELAY_MS);
      const [result] = await this.account.request(operations.cameraCapture(this.giid, deviceLabel, requestId));
      const provider = result && result.data && result.data.installation && result.data.installation.cameraContentProvider;
      status = provider && provider.captureImageRequestStatus && provider.captureImageRequestStatus.mediaRequestStatus;
    }
    this._imageSeriesAt = 0; // force the next getLatestImage() to fetch
    return status === 'AVAILABLE';
  }

  /**
   * Newest JPEG for a camera from the media search (HA update_smartcam_imageseries),
   * cached for 60 s across all cameras of the installation. Resolves
   * { mediaId, contentUrl, timestamp } or null.
   */
  async getLatestImage(deviceLabel) {
    if (!this._imageSeries || this._now() - this._imageSeriesAt >= IMAGE_SERIES_MIN_AGE_MS) {
      const [result] = await this.account.request(operations.camerasImageSeries(this.giid));
      const series = (result && result.data && result.data.ContentProviderMediaSearch
        && result.data.ContentProviderMediaSearch.mediaSeriesList) || [];
      this._imageSeries = series
        .flatMap((s) => s.deviceMediaList || [])
        .filter((media) => media.contentType === 'IMAGE_JPEG');
      this._imageSeriesAt = this._now();
    }
    const image = this._imageSeries.find((media) => media.deviceLabel === deviceLabel);
    if (!image || image.mediaId === '-1') return null; // -1 = still uploading
    return { mediaId: image.mediaId, contentUrl: image.contentUrl, timestamp: image.timestamp };
  }

  /**
   * Arm dry run (vsure 2.10 arm_state_dry_run; HA PR #177261): asks Verisure whether
   * arming would need force, without arming. Resolves { ready, violations } where
   * violations is [{ deviceLabel, violation }] — e.g. violation DOOR_WINDOW_OPEN.
   * Costs one mutation plus a status poll or two (DONE after ~0.5 s, verified live).
   */
  async checkArmReadiness() {
    const [start] = await this.account.request(operations.armStateDryRun(this.giid));
    const transactionId = start && start.data && start.data.armStateDryRun;
    if (!transactionId) {
      const detail = graphqlErrorText(start);
      throw new TransactionError(`Verisure did not start the arm check${detail ? ` (${detail})` : ''}`);
    }
    for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt++) {
      if (attempt > 0) await this._sleep(TRANSACTION_DELAY_MS);
      const [result] = await this.account.request(operations.armStateDryRunStatus(this.giid, transactionId));
      const dryRun = result && result.data && result.data.installation && result.data.installation.armState
        && result.data.installation.armState.dryRunStatus;
      if (dryRun && dryRun.status && dryRun.status.status === 'DONE') {
        const violations = ((dryRun.result && dryRun.result.deviceViolations) || [])
          .map(({ deviceLabel, violation }) => ({ deviceLabel, violation }));
        return { ready: violations.length === 0, violations };
      }
    }
    throw new TransactionError('Verisure did not finish the arm check in time.');
  }

  /** deviceLabel → area for every device, from the Devices query, cached for an hour. */
  async getDeviceNames() {
    if (!this._deviceNames || this._now() - this._deviceNamesAt >= DEVICE_NAMES_MAX_AGE_MS) {
      const [result] = await this.account.request(operations.devices(this.giid));
      const devices = (result && result.data && result.data.installation && result.data.installation.devices) || [];
      this._deviceNames = Object.fromEntries(devices.map((d) => [d.deviceLabel, d.area || d.deviceLabel]));
      this._deviceNamesAt = this._now();
    }
    return this._deviceNames;
  }

  async getEventLog(options) {
    const [result] = await this.account.request(operations.eventLog(this.giid, options));
    const log = result && result.data && result.data.installation && result.data.installation.eventLog;
    return (log && log.pagedList) || [];
  }

}

module.exports = InstallationHub;
module.exports.POLL_OPERATIONS = POLL_OPERATIONS;
module.exports.MIN_POLL_SECONDS = MIN_POLL_SECONDS;
module.exports.DEFAULT_POLL_SECONDS = DEFAULT_POLL_SECONDS;
module.exports.RATE_LIMIT_BACKOFF_MS = RATE_LIMIT_BACKOFF_MS;
module.exports.TransactionError = TransactionError;
module.exports.toSnapshot = toSnapshot;
