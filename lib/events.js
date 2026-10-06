'use strict';

// Verisure exposes no live smoke, water or motion state over the app API — every
// integration that has those (openHAB's binding is the reference: VerisureThingHandler.java)
// reads them from the event log. Events carry SIA-style eventType codes and identify the
// device by device.deviceLabel (the same serial the other queries use).
//
//   category                  eventType                         → detector event
//   FIRE                      FA (alarm) / FR (restore)          fire
//   WATER                     WA / WR                            water
//   INTRUSION                 BA / BR                            intrusion (motion)
//   TECHNICAL, INTRUSION      TA / TR                            tamper
//   TECHNICAL                 XT / XR                            battery (low / replaced)
//   DOORWINDOW_STATE_OPENED   DOORWINDOW_STATE_CHANGE_OPENED     door_open    (verified live)
//   DOORWINDOW_STATE_CLOSED   DOORWINDOW_STATE_CHANGE_CLOSED     door_closed  (verified live)
//
// Fire/water/intrusion/tamper/battery codes come from openHAB and python-verisure #112 and
// are NOT yet verified on a live installation, so classification falls back to the category
// and treats anything that is not a known restore code as an alarm.

// Categories requested with every poll. Only categories an installation supports return
// events (its notificationCategoryFilter); unsupported ones are ignored by the API.
const DETECTOR_CATEGORIES = [
  'FIRE', 'WATER', 'INTRUSION', 'TECHNICAL',
  'DOORWINDOW_STATE_OPENED', 'DOORWINDOW_STATE_CLOSED',
];

const RESTORE_TYPES = new Set(['FR', 'WR', 'BR', 'TR', 'XR']);
const TAMPER_TYPES = new Set(['TA', 'TR']);
const BATTERY_TYPES = new Set(['XT', 'XR']);

/**
 * Normalises an event-log entry into a detector event, or null when it is not one.
 * @returns {{ id, time, deviceLabel, area, kind, active, category, type } | null}
 */
function classify(entry) {
  if (!entry) return null;
  const category = String(entry.eventCategory || '').toUpperCase();
  const type = String(entry.eventType || '').toUpperCase();
  let kind = null;
  let active = !RESTORE_TYPES.has(type);

  if (TAMPER_TYPES.has(type)) kind = 'tamper';
  else if (BATTERY_TYPES.has(type)) kind = 'battery';
  else if (category === 'DOORWINDOW_STATE_OPENED' || type === 'DOORWINDOW_STATE_CHANGE_OPENED') {
    kind = 'door';
    active = true;
  } else if (category === 'DOORWINDOW_STATE_CLOSED' || type === 'DOORWINDOW_STATE_CHANGE_CLOSED') {
    kind = 'door';
    active = false;
  } else if (category === 'FIRE') kind = 'fire';
  else if (category === 'WATER') kind = 'water';
  else if (category === 'INTRUSION') kind = 'intrusion';
  if (!kind) return null;

  const device = entry.device || {};
  return {
    id: entry.eventId != null ? String(entry.eventId) : `${entry.eventTime}|${device.deviceLabel}|${type}`,
    time: entry.eventTime || null,
    deviceLabel: device.deviceLabel || null,
    area: device.area || entry.gatewayArea || '',
    kind,
    active,
    category,
    type,
  };
}

const SEEN_LIMIT = 500;

/**
 * Tracks which log entries were already handled. The first batch only sets the baseline —
 * otherwise every restart would re-fire the last 25 events (openHAB does the same).
 */
class EventTracker {

  constructor() {
    this._seen = new Set();
    this._order = [];
    this._initialised = false;
  }

  /** Returns the new detector events, oldest first. */
  take(entries) {
    const fresh = [];
    for (const entry of [...(entries || [])].reverse()) { // log is newest first
      const event = classify(entry);
      const key = event ? event.id : entry && entry.eventId;
      if (key == null || this._seen.has(key)) continue;
      this._remember(key);
      if (event) fresh.push(event);
    }
    if (!this._initialised) {
      this._initialised = true;
      return [];
    }
    return fresh;
  }

  _remember(key) {
    this._seen.add(key);
    this._order.push(key);
    if (this._order.length > SEEN_LIMIT) this._seen.delete(this._order.shift());
  }

}

module.exports = {
  DETECTOR_CATEGORIES, classify, EventTracker,
};
