/* eslint-disable */
'use strict';

// GENERATED from reference/python-verisure/verisure/session.py (vsure 2.10.1) — do not edit by hand.
// The query strings are byte-for-byte copies of the library's, which is what Verisure's API is known
// to accept. Regenerate with scripts/extract-queries.py when upstream changes.
//
// python-verisure is Copyright (c) 2015 Per Sandström, MIT License — see THIRD_PARTY_NOTICES.md.

module.exports = {
  arm_away: {
    operationName: "armAway",
    query: "mutation armAway($giid: String!, $code: String!, $forceArm: Boolean) {\n  armStateArmAway(giid: $giid, code: $code, forceArm: $forceArm)\n}\n",
  },
  arm_home: {
    operationName: "armHome",
    query: "mutation armHome($giid: String!, $code: String!, $forceArm: Boolean) {\n  armStateArmHome(giid: $giid, code: $code, forceArm: $forceArm)\n}\n",
  },
  arm_state: {
    operationName: "ArmState",
    query: "query ArmState($giid: String!) {\n  installation(giid: $giid) {\n    armState {\n      type\n      statusType\n      date\n      name\n      changedVia\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  arm_state_dry_run: {
    operationName: "ArmStateDryRun",
    query: "mutation ArmStateDryRun($giid: String!) {\n  armStateDryRun(giid: $giid)\n}\n",
  },
  arm_state_dry_run_status: {
    operationName: "ArmStateDryRunStatus",
    query: "query ArmStateDryRunStatus($giid: String!, $transactionId: String!) {\n  installation(giid: $giid) {\n    armState {\n      dryRunStatus(transactionId: $transactionId) {\n        status {\n          status\n          createTime\n          changeTime\n          __typename\n        }\n        result {\n          created\n          received\n          deviceViolations {\n            deviceLabel\n            violation\n            occurred\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  broadband: {
    operationName: "Broadband",
    query: "query Broadband($giid: String!) {\n  installation(giid: $giid) {\n    broadband {\n      testDate\n      isBroadbandConnected\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  camera_capture: {
    operationName: null,
    query: "query queryCaptureImageRequestStatus($giid: String!, $deviceLabel: String!, $requestId: BigInt!) {\n  installation(giid: $giid) {\n    cameraContentProvider {\n      captureImageRequestStatus(deviceLabel: $deviceLabel, requestId: $requestId) {\n        mediaRequestStatus\n      }\n    }\n  }\n}",
  },
  camera_get_request_id: {
    operationName: null,
    query: "mutation cccp($giid: String!, $deviceLabel: String!, $resolution: String!, $deviceIdentifier: String) {\n  ContentProviderCaptureImageRequest(giid: $giid, deviceLabel: $deviceLabel, resolution: $resolution, deviceIdentifier: $deviceIdentifier) {\n    requestId\n  }\n}",
  },
  cameras: {
    operationName: "Camera",
    query: "query Camera($giid: String!, $all: Boolean!) {\n    installation(giid: $giid) {\n        cameras(allCameras: $all) {\n            visibleOnCard\n            initiallyConfigured\n            imageCaptureAllowed\n            imageCaptureAllowedByArmstate\n            device {\n        deviceLabel\n        area\n        __typename\n      }\n            latestCameraSeries {\n                image {\n                    imageId\n                    imageStatus\n                    captureTime\n                    url\n                }\n            }\n        }\n    }\n}",
  },
  cameras_image_series: {
    operationName: "GQL_CCCP_SearchMedia",
    query: "mutation GQL_CCCP_SearchMedia(\n\t$giid: BigInt!\n\t$offset: Int\n\t$limit: Int\n\t$fromDate: Date\n\t$toDate: Date) {\n\n\tContentProviderMediaSearch(\n\t\tgiid: $giid\n\t\toffset: $offset\n\t\tlimit: $limit\n\t\tfromDate: $fromDate\n\t\ttoDate: $toDate\n\t) {\n\t\ttotalNumberOfMediaSeries\n\t\tmediaSeriesList {\n\t\t\tseriesId\n\t\t\tstorageType\n\t\t\tviewed\n\t\t\ttimestamp\n\t\t\tdeviceMediaList {\n\t\t\t\tcontentUrl\n\t\t\t\tmediaAvailable\n\t\t\t\tdeviceLabel\n\t\t\t\tmediaId\n\t\t\t\tcontentType\n\t\t\t\ttimestamp\n\t\t\t\trequestTimestamp\n\t\t\t\tduration\n\t\t\t\texpiryDate\n\t\t\t\tviewed\n\t\t\t\tthumbnailUrl\n\t\t\t\tbitRate\n\t\t\t\twidth\n\t\t\t\theight\n\t\t\t\tcodec\n\t\t\t}\n\t\t}\n\t}\n}",
  },
  cameras_last_image: {
    operationName: null,
    query: "query queryCaptureImageRequestStatus($giid: String!) {\n  installation(giid: $giid) {\n    cameraContentProvider {\n      latestImage {\n        deviceLabel\n        mediaId\n        contentType\n        contentUrl\n        timestamp\n        duration\n        thumbnailUrl\n        bitRate\n        width\n        height\n        codec\n      }\n    }\n  }\n}",
  },
  capability: {
    operationName: "Capability",
    query: "query Capability($giid: String!) {\n  installation(giid: $giid) {\n    capability {\n      current\n      gained {\n        capability\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  charge_sms: {
    operationName: "ChargeSms",
    query: "query ChargeSms($giid: String!) {\n  installation(giid: $giid) {\n    chargeSms {\n      chargeSmartPlugOnOff\n      chargeLockUnlock\n      chargeArmDisarm\n      chargeNotifications\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  climate: {
    operationName: "Climate",
    query: "query Climate($giid: String!) {\n  installation(giid: $giid) {\n    climates {\n      device {\n        deviceLabel\n        area\n        gui {\n          label\n          __typename\n        }\n        __typename\n      }\n      humidityEnabled\n      humidityTimestamp\n      humidityValue\n      temperatureTimestamp\n      temperatureValue\n      thresholds {\n        aboveMaxAlert\n        belowMinAlert\n        sensorType\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  disarm: {
    operationName: "disarm",
    query: "mutation disarm($giid: String!, $code: String!) {\n  armStateDisarm(giid: $giid, code: $code)\n}\n",
  },
  door_lock: {
    operationName: "DoorLock",
    query: "mutation DoorLock($giid: String!, $deviceLabel: String!, $input: LockDoorInput!) {\n  DoorLock(giid: $giid, deviceLabel: $deviceLabel, input: $input)\n}\n",
  },
  door_lock_configuration: {
    operationName: "DoorLockConfiguration",
    query: "query DoorLockConfiguration($giid: String!, $deviceLabel: String!) {\n  installation(giid: $giid) {\n    smartLocks(filter: {deviceLabels: [$deviceLabel]}) {\n      device {\n        area\n        deviceLabel\n        __typename\n      }\n      configuration {\n        ... on YaleLockConfiguration {\n          autoLockEnabled\n          voiceLevel\n          volume\n          __typename\n        }\n        ... on DanaLockConfiguration {\n          holdBackLatchDuration\n          twistAssistEnabled\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  door_unlock: {
    operationName: "DoorUnlock",
    query: "mutation DoorUnlock($giid: String!, $deviceLabel: String!, $input: LockDoorInput!) {\n  DoorUnlock(giid: $giid, deviceLabel: $deviceLabel, input: $input)\n}\n",
  },
  door_window: {
    operationName: "DoorWindow",
    query: "query DoorWindow($giid: String!) {\n  installation(giid: $giid) {\n    doorWindows {\n      device {\n        deviceLabel\n        __typename\n      }\n      type\n      area\n      state\n      wired\n      reportTime\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  event_log: {
    operationName: "EventLog",
    query: "query EventLog($giid: String!, $offset: Int!, $pagesize: Int!, $eventCategories: [String], $fromDate: String, $toDate: String, $eventContactIds: [String], $eventDeviceLabels: [String]) {\n  installation(giid: $giid) {\n    eventLog(offset: $offset, pagesize: $pagesize, eventCategories: $eventCategories, eventContactIds: $eventContactIds, eventDeviceLabels: $eventDeviceLabels, fromDate: $fromDate, toDate: $toDate) {\n      moreDataAvailable\n      pagedList {\n        device {\n          deviceLabel\n          area\n          gui {\n            label\n            __typename\n          }\n          __typename\n        }\n        arloDevice {\n          name\n          __typename\n        }\n        gatewayArea\n        eventType\n        eventCategory\n        eventSource\n        eventId\n        eventTime\n        userName\n        armState\n        userType\n        climateValue\n        sensorType\n        eventCount\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  fetch_all_installations: {
    operationName: "fetchAllInstallations",
    query: "query fetchAllInstallations($email: String!){\n  account(email: $email) {\n    installations {\n      giid\n      alias\n      customerType\n      dealerId\n      subsidiary\n      pinCodeLength\n      locale\n      address {\n        street\n        city\n        postalNumber\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  firmware: {
    operationName: "Firmware",
    query: "query Firmware($giid: String!) {\n  installation(giid: $giid) {\n    firmware {\n      status {\n        latestFirmware\n        requestedFirmware\n        upgradeable\n        status\n        gateways {\n          reportedRunningFirmware\n          deviceLabel\n          status\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  guardian_sos: {
    operationName: "GuardianSos",
    query: "query GuardianSos {\n  guardianSos {\n    serverTime\n    sos {\n      fullName\n      phone\n      deviceId\n      deviceName\n      giid\n      type\n      username\n      expireDate\n      warnBeforeExpireDate\n      contactId\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  is_guardian_activated: {
    operationName: "IsGuardianActivated",
    query: "query IsGuardianActivated($giid: String!, $featureName: String!) {\n  installation(giid: $giid) {\n    activatedFeature {\n      isFeatureActivated(featureName: $featureName)\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  permissions: {
    operationName: "Permissions",
    query: "query Permissions($giid: String!, $email: String!) {\n  permissions(giid: $giid, email: $email) {\n    accountPermissionsHash\n    name\n    __typename\n  }\n}\n",
  },
  poll_arm_state: {
    operationName: "pollArmState",
    query: "query pollArmState($giid: String!, $transactionId: String, $futureState: ArmStateStatusTypes!) {\n  installation(giid: $giid) {\n    armStateChangePollResult(transactionId: $transactionId, futureState: $futureState) {\n      result\n      createTime\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  poll_lock_state: {
    operationName: "pollLockState",
    query: "query pollLockState($giid: String!, $transactionId: String, $deviceLabel: String!, $futureState: DoorLockState!) {\n  installation(giid: $giid) {\n    doorLockStateChangePollResult(transactionId: $transactionId, deviceLabel: $deviceLabel, futureState: $futureState) {\n      result\n      createTime\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  remaining_sms: {
    operationName: "RemainingSms",
    query: "query RemainingSms($giid: String!) {\n  installation(giid: $giid) {\n    remainingSms\n    __typename\n  }\n}\n",
  },
  set_autolock_enabled: {
    operationName: "DoorLockUpdateConfig",
    query: "mutation DoorLockUpdateConfig($giid: String!, $deviceLabel: String!, $input: DoorLockUpdateConfigInput!) {\n  DoorLockUpdateConfig(giid: $giid, deviceLabel: $deviceLabel, input: $input)\n}\n",
  },
  set_smartplug: {
    operationName: "UpdateState",
    query: "mutation UpdateState($giid: String!, $deviceLabel: String!, $state: Boolean!) {\n  SmartPlugSetState(giid: $giid, input: [{deviceLabel: $deviceLabel, state: $state}])}",
  },
  smart_button: {
    operationName: "SmartButton",
    query: "query SmartButton($giid: String!) {\n  installation(giid: $giid) {\n    smartButton {\n      entries {\n        smartButtonId\n        icon\n        label\n        color\n        active\n        action {\n          actionType\n          expectedState\n          target {\n            ... on Installation {\n              alias\n              __typename\n            }\n            ... on Device {\n              deviceLabel\n              area\n              gui {\n                label\n                __typename\n              }\n              featureStatuses(type: \"SmartPlug\") {\n                device {\n                  deviceLabel\n                  __typename\n                }\n                ... on SmartPlug {\n                  icon\n                  isHazardous\n                  __typename\n                }\n                __typename\n              }\n              __typename\n            }\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  smart_lock: {
    operationName: "SmartLock",
    query: "query SmartLock($giid: String!) {\n  installation(giid: $giid) {\n    smartLocks {\n      lockStatus\n      doorState\n      lockMethod\n      eventTime\n      doorLockType\n      secureMode\n      device {\n        deviceLabel\n        area\n        __typename\n      }\n      user {\n        name\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  smartplug: {
    operationName: "SmartPlug",
    query: "query SmartPlug($giid: String!, $deviceLabel: String!) {\n  installation(giid: $giid) {\n    smartplugs(filter: {deviceLabels: [$deviceLabel]}) {\n      device {\n        deviceLabel\n        area\n        __typename\n      }\n      currentState\n      icon\n      isHazardous\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  smartplugs: {
    operationName: "SmartPlug",
    query: "query SmartPlug($giid: String!) {\n  installation(giid: $giid) {\n    smartplugs {\n      device {\n        deviceLabel\n        area\n        __typename\n      }\n      currentState\n      icon\n      isHazardous\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
  user_trackings: {
    operationName: "userTrackings",
    query: "query userTrackings($giid: String!) {\n  installation(giid: $giid) {\n    userTrackings {\n      isCallingUser\n      webAccount\n      status\n      xbnContactId\n      currentLocationName\n      deviceId\n      name\n      initials\n      currentLocationTimestamp\n      deviceName\n      currentLocationId\n      __typename\n    }\n    __typename\n  }\n}\n",
  },
};
