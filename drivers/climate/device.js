'use strict';

const VerisureDevice = require('../../lib/VerisureDevice');

class ClimateDevice extends VerisureDevice {

  static KIND = 'climate';

  async onSnapshot({ climates }) {
    if (!climates) return true;
    const sensor = climates[this.deviceLabel];
    if (!sensor) return false;

    if (sensor.temperatureValue != null) {
      await this.ensureCapability('measure_temperature');
      await this.updateCapability('measure_temperature', Number(sensor.temperatureValue));
    }
    if (sensor.humidityEnabled && sensor.humidityValue != null) {
      await this.ensureCapability('measure_humidity');
      await this.updateCapability('measure_humidity', Number(sensor.humidityValue));
    }
    return true;
  }

}

module.exports = ClimateDevice;
