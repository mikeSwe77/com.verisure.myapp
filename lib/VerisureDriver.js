'use strict';

const Homey = require('homey');
const VerisureSession = require('./VerisureSession');
const operations = require('./operations');
const { POLL_OPERATIONS, toSnapshot } = require('./InstallationHub');
const { MfaRequiredError, RateLimitError, AuthenticationError } = require('./errors');

// Shared pairing and repair for every driver. The custom `login` view (pair/login.html,
// identical in every driver — the source is lib/pair/login.html, copied by
// `npm run sync-pair`) walks through:
//
//   credentials ─┬─────────────► installation picker ─► list_devices (pair)
//                └► MFA code ──┘                      └► done (repair)
//
// A stored trust cookie for the same e-mail is reused, so adding more devices or
// repairing does not ask for a new code unless Verisure insists.
//
// Subclasses set `static KIND` and implement `devicesFromSnapshot(snapshot, installation)`.

function describeInstallation(installation) {
  const street = installation.address && installation.address.street;
  return {
    giid: installation.giid,
    name: installation.alias || installation.giid,
    address: street || '',
  };
}

function friendlyError(err, homey) {
  if (err instanceof RateLimitError) return homey.__('pair.error.rate_limited');
  if (err instanceof AuthenticationError) return homey.__('pair.error.invalid_auth');
  return err.message;
}

class VerisureDriver extends Homey.Driver {

  /** @abstract map a snapshot to Homey device descriptors */
  devicesFromSnapshot(snapshot, installation) { // eslint-disable-line no-unused-vars
    return [];
  }

  /**
   * Pairing list from the Devices query, for hardware no state query returns (camera PIRs,
   * water detectors). `prefixes` match device.gui.label, e.g. ['CAMERAPIR', 'PIR'].
   */
  devicesOfType(snapshot, installation, prefixes, typeName) {
    return Object.values(snapshot.devices || {})
      .filter((device) => {
        const label = String((device.gui && device.gui.label) || '').toUpperCase();
        return prefixes.some((prefix) => label.startsWith(prefix));
      })
      .map((device) => {
        const area = device.area || device.deviceLabel;
        return this.labelledDevice(installation, device.deviceLabel, typeName ? `${area} ${typeName}` : area);
      });
  }

  /** Descriptor for a device Verisure identifies by deviceLabel (its serial). */
  labelledDevice(installation, deviceLabel, name, extra = {}) {
    return {
      name: name || deviceLabel,
      ...extra,
      data: { id: `${installation.giid}:${deviceLabel}`, giid: installation.giid, deviceLabel },
    };
  }

  _bindLoginHandlers(session, { repairDevice = null } = {}) {
    const state = { verisure: null, installations: [], installation: null };

    const finishLogin = (installations) => {
      this.homey.app.registerLogin(state.verisure);
      state.installations = installations;
      const list = installations.map(describeInstallation);
      if (repairDevice) {
        const { giid } = repairDevice.getData();
        if (!installations.some((i) => i.giid === giid)) {
          throw new Error(this.homey.__('pair.error.installation_missing'));
        }
      }
      return { status: 'ok', installations: list };
    };

    session.setHandler('init', async () => ({
      repair: Boolean(repairDevice),
      email: repairDevice
        ? repairDevice.getStore().email
        : (this.homey.app.knownAccounts()[0] || ''),
    }));

    session.setHandler('login', async ({ email, password }) => {
      const username = String(email || '').trim();
      if (!username || !password) throw new Error(this.homey.__('pair.error.missing_credentials'));
      if (password.length > 30) this.log('Password longer than 30 characters; Verisure may reject it');

      // Reuse the stored trust cookie for this account so a known client skips MFA.
      const record = this.homey.app.getAccountRecord(username);
      state.verisure = new VerisureSession({
        username,
        password,
        cookies: record && record.cookies,
        trustToken: record && record.trustToken,
        log: (...args) => this.log('[pair]', ...args),
      });

      try {
        const installations = state.verisure.hasTrustCookie
          ? await state.verisure.loginCookie()
          : await state.verisure.login();
        return finishLogin(installations);
      } catch (err) {
        if (!(err instanceof MfaRequiredError)) {
          this.error('Login failed:', err.message);
          throw new Error(friendlyError(err, this.homey));
        }
      }

      try {
        const channel = await state.verisure.requestMfa();
        return { status: 'mfa', channel };
      } catch (err) {
        this.error('Requesting MFA code failed:', err.message);
        throw new Error(friendlyError(err, this.homey));
      }
    });

    session.setHandler('resend_mfa', async () => {
      if (!state.verisure) throw new Error(this.homey.__('pair.error.session_lost'));
      try {
        return { channel: await state.verisure.requestMfa() };
      } catch (err) {
        throw new Error(friendlyError(err, this.homey));
      }
    });

    session.setHandler('mfa', async ({ code }) => {
      if (!state.verisure) throw new Error(this.homey.__('pair.error.session_lost'));
      try {
        return finishLogin(await state.verisure.validateMfa(code));
      } catch (err) {
        this.error('MFA validation failed:', err.message);
        throw new Error(err instanceof AuthenticationError
          ? this.homey.__('pair.error.invalid_code')
          : friendlyError(err, this.homey));
      }
    });

    session.setHandler('select_installation', async ({ giid }) => {
      state.installation = state.installations.find((i) => i.giid === giid) || null;
      if (!state.installation) throw new Error(this.homey.__('pair.error.installation_missing'));
      return true;
    });

    return state;
  }

  async onPair(session) {
    const state = this._bindLoginHandlers(session);

    session.setHandler('list_devices', async () => {
      if (!state.verisure || !state.installation) throw new Error(this.homey.__('pair.error.session_lost'));
      const { giid } = state.installation;
      const account = this.homey.app.getAccount(state.verisure.username);
      const ops = POLL_OPERATIONS[this.constructor.KIND].map((name) => operations[name](giid));
      const snapshot = toSnapshot(await account.request(...ops));
      const devices = this.devicesFromSnapshot(snapshot, state.installation);
      return devices.map((device) => ({
        ...device,
        store: { ...(device.store || {}), email: state.verisure.username },
      }));
    });
  }

  async onRepair(session, device) {
    this._bindLoginHandlers(session, { repairDevice: device });
  }

}

module.exports = VerisureDriver;
