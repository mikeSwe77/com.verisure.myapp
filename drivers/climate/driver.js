'use strict';

const VerisureDriver = require('../../lib/VerisureDriver');
const {
  isSmokeDetector, typeName, hasReadings, capabilitiesFor, iconFor,
} = require('../../lib/climateDevices');

// Temperature/humidity from sirens, the central unit, climate sensors etc. Smoke detectors
// report through the same query but have their own driver (drivers/smoke_detector).
class ClimateDriver extends VerisureDriver {

  static KIND = 'climate';

  includes(climate) {
    return !isSmokeDetector(climate);
  }

  devicesFromSnapshot(snapshot, installation) {
    const language = this.homey.i18n.getLanguage();
    return Object.values(snapshot.climates || {})
      .filter((climate) => hasReadings(climate) && this.includes(climate))
      .map((climate) => {
        const area = climate.device.area || climate.device.deviceLabel;
        const type = typeName(climate, language);
        const icon = iconFor(climate);
        return this.labelledDevice(installation, climate.device.deviceLabel, type ? `${area} ${type}` : area, {
          capabilities: capabilitiesFor(climate),
          ...(icon && { icon }),
        });
      });
  }

}

module.exports = ClimateDriver;
