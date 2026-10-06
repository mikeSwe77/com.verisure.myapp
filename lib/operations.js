'use strict';

const Q = require('./queries');
const { DETECTOR_CATEGORIES } = require('./events');

// Builders for the GraphQL operations Verisure's app API accepts. Each returns the
// `{ operationName, variables, query }` object that VerisureSession.request() posts;
// several can be batched into one HTTP call. Variable shapes follow python-verisure
// 2.10.1 exactly. Operations upstream sends without an operationName (the camera
// content-provider ones) are sent the same way here.

// Deliberate deviations from / additions to upstream, each verified against the live API.
const OVERRIDES = {
  // Not in python-verisure. Lists every device with its hardware type, including ones no
  // other query returns (camera PIRs, water detectors). From Soleg06/Verisure_API; verified
  // 2026-10-06. Note: deviceLabel sits on the item itself, not under `device`.
  devices: {
    operationName: 'Devices',
    // eslint-disable-next-line max-len
    query: 'query Devices($giid: String!) {\n  installation(giid: $giid) {\n    devices {\n      deviceLabel\n      area\n      capability\n      gui {\n        label\n        deviceGroup\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n',
  },
  // Upstream asks for DoorWindow.area, which Verisure returns as null (the cause of HA
  // issue #181182: sensors named after the installation). The room name lives on
  // device.area, as in every other query. Verified 2026-10-06.
  door_window: {
    operationName: 'DoorWindow',
    // eslint-disable-next-line max-len
    query: 'query DoorWindow($giid: String!) {\n  installation(giid: $giid) {\n    doorWindows {\n      device {\n        deviceLabel\n        area\n        gui {\n          label\n          __typename\n        }\n        __typename\n      }\n      type\n      area\n      state\n      wired\n      reportTime\n      __typename\n    }\n    __typename\n  }\n}\n',
  },
};

function op(name, variables) {
  const { operationName, query } = OVERRIDES[name] || Q[name];
  return operationName
    ? { operationName, variables, query }
    : { variables, query };
}

const ALL_EVENT_CATEGORIES = [
  'INTRUSION', 'FIRE', 'SOS', 'WATER', 'ANIMAL', 'TECHNICAL', 'WARNING',
  'ARM', 'DISARM', 'LOCK', 'UNLOCK', 'PICTURE', 'CLIMATE', 'CAMERA_SETTINGS',
];

module.exports = {
  ALL_EVENT_CATEGORIES,

  fetchAllInstallations: (email) => op('fetch_all_installations', { email }),

  // Alarm
  armState: (giid) => op('arm_state', { giid }),
  armAway: (giid, code, forceArm = false) => op('arm_away', { giid, code, forceArm }),
  armHome: (giid, code, forceArm = false) => op('arm_home', { giid, code, forceArm }),
  disarm: (giid, code) => op('disarm', { giid, code }),
  pollArmState: (giid, transactionId, futureState) => op('poll_arm_state', { giid, transactionId, futureState }),
  armStateDryRun: (giid) => op('arm_state_dry_run', { giid }),
  armStateDryRunStatus: (giid, transactionId) => op('arm_state_dry_run_status', { giid, transactionId }),

  // Sensors
  broadband: (giid) => op('broadband', { giid }),
  climate: (giid) => op('climate', { giid }),
  doorWindow: (giid) => op('door_window', { giid }),

  // Smart plugs
  smartplugs: (giid) => op('smartplugs', { giid }),
  smartplug: (giid, deviceLabel) => op('smartplug', { giid, deviceLabel }),
  setSmartplug: (giid, deviceLabel, state) => op('set_smartplug', { giid, deviceLabel, state }),

  // Smart locks
  smartLock: (giid) => op('smart_lock', { giid }),
  doorLock: (giid, deviceLabel, code) => op('door_lock', { giid, deviceLabel, input: { code } }),
  doorUnlock: (giid, deviceLabel, code) => op('door_unlock', { giid, deviceLabel, input: { code } }),
  pollLockState: (giid, transactionId, deviceLabel, futureState) => op('poll_lock_state', {
    giid, transactionId, deviceLabel, futureState,
  }),
  doorLockConfiguration: (giid, deviceLabel) => op('door_lock_configuration', { giid, deviceLabel }),
  setAutolockEnabled: (giid, deviceLabel, autoLockEnabled) => op('set_autolock_enabled', {
    giid, deviceLabel, input: { autoLockEnabled },
  }),

  // Cameras
  cameras: (giid) => op('cameras', { all: true, giid }),
  camerasLastImage: (giid) => op('cameras_last_image', { giid }),
  camerasImageSeries: (giid, limit = 50, offset = 0) => op('cameras_image_series', { giid, limit, offset }),
  cameraGetRequestId: (giid, deviceLabel) => op('camera_get_request_id', {
    deviceIdentifier: 'RandomString', deviceLabel, giid, resolution: 'high',
  }),
  cameraCapture: (giid, deviceLabel, requestId) => op('camera_capture', { deviceLabel, giid, requestId }),

  // Misc
  eventLog: (giid, { pagesize = 15, eventCategories = ALL_EVENT_CATEGORIES } = {}) => op('event_log', {
    giid,
    offset: 0,
    pagesize,
    eventCategories,
    eventContactIds: [],
    eventDeviceLabels: [],
    fromDate: null,
    toDate: null,
  }),
  // Smoke, water, motion and door/window events (see lib/events.js). 25 entries covers a
  // poll interval comfortably; older ones were already seen.
  detectorEvents: (giid) => module.exports.eventLog(giid, { pagesize: 25, eventCategories: DETECTOR_CATEGORIES }),
  devices: (giid) => op('devices', { giid }),
  userTrackings: (giid) => op('user_trackings', { giid }),
  firmware: (giid) => op('firmware', { giid }),
};
