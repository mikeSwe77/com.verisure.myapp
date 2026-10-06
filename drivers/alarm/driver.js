'use strict';

const VerisureDriver = require('../../lib/VerisureDriver');

class AlarmDriver extends VerisureDriver {

  static KIND = 'alarm';

  async onInit() {
    this.armFailedTrigger = this.homey.flow.getDeviceTriggerCard('arm_failed');
    this.changedByTrigger = this.homey.flow.getDeviceTriggerCard('alarm_changed_by');
    this.detectionTriggers = {
      fire: this.homey.flow.getDeviceTriggerCard('fire_detected'),
      water: this.homey.flow.getDeviceTriggerCard('water_detected'),
      intrusion: this.homey.flow.getDeviceTriggerCard('intrusion_detected'),
      tamper: this.homey.flow.getDeviceTriggerCard('tamper_detected'),
      battery: this.homey.flow.getDeviceTriggerCard('battery_low'),
    };

    this.homey.flow.getActionCard('arm_with_options')
      .registerRunListener(async ({ device, mode, force }) => {
        await device.setArmState(mode === 'home' ? 'ARMED_HOME' : 'ARMED_AWAY', { forceArm: force === 'yes' });
      });

    this.homey.flow.getActionCard('refresh_now')
      .registerRunListener(async ({ device }) => {
        await device.hub.refresh();
      });

    this.homey.flow.getConditionCard('arm_ready')
      .registerRunListener(async ({ device }) => (await device.getReadiness()).ready);

    this.homey.flow.getActionCard('check_arm_readiness')
      .registerRunListener(async ({ device }) => {
        const { ready, blockers } = await device.getReadiness();
        return { ready, blockers: blockers || '' };
      });

    this.homey.flow.getConditionCard('broadband_online')
      .registerRunListener(async ({ device }) => device.getCapabilityValue('broadband_online') === true);
  }

  devicesFromSnapshot(snapshot, installation) {
    return [{
      name: installation.alias || 'Verisure',
      data: { id: installation.giid, giid: installation.giid },
    }];
  }

}

module.exports = AlarmDriver;
