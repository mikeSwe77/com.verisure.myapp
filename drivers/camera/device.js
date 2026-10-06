'use strict';

const VerisureDevice = require('../../lib/VerisureDevice');
const { download } = require('../../lib/http');

// Pictures come from the content-provider media search (HA camera.py check_imagelist):
// the newest IMAGE_JPEG for this camera, downloaded from its pre-signed contentUrl.
class CameraDevice extends VerisureDevice {

  static KIND = 'camera';

  async onVerisureInit() {
    this._mediaId = this.getStoreValue('mediaId') || null;
    this._latest = null;
    this._checkedAt = 0;

    this.image = await this.homey.images.createImage();
    this.image.setStream(async (stream) => {
      const latest = this._latest || await this.hub.getLatestImage(this.deviceLabel);
      if (!latest) throw new Error(this.homey.__('camera.no_image'));
      const { buffer, contentType } = await download(latest.contentUrl);
      stream.contentType = contentType || 'image/jpeg';
      stream.filename = `${latest.mediaId}.jpg`;
      stream.end(buffer);
    });
    await this.setCameraImage('latest', this.homey.__('camera.latest'), this.image);

    this.registerCapabilityListener('button.capture', async () => this.capture());
  }

  async capture() {
    const ok = await this.hub.captureImage(this.deviceLabel);
    if (!ok) throw new Error(this.homey.__('camera.capture_timeout'));
    await this.checkForNewImage({ force: true });
  }

  async checkForNewImage({ force = false } = {}) {
    const minutes = Number(this.getSetting('image_refresh'));
    if (!force && (!minutes || Date.now() - this._checkedAt < minutes * 60 * 1000)) return;
    this._checkedAt = Date.now();

    const latest = await this.hub.getLatestImage(this.deviceLabel);
    if (!latest || latest.mediaId === this._mediaId) return;

    const isFirst = this._mediaId === null;
    this._latest = latest;
    this._mediaId = latest.mediaId;
    await this.setStoreValue('mediaId', latest.mediaId);
    await this.image.update();
    // The first image seen after pairing is old news — unless the user just asked for it.
    if (!isFirst || force) {
      await this.driver.newImageTrigger.trigger(this, { image: this.image }).catch(this.error);
    }
  }

  async onSnapshot({ cameras }) {
    if (!cameras) return true;
    if (!cameras[this.deviceLabel]) return false;
    this.checkForNewImage().catch((err) => this.error('Image check failed:', err.message));
    return true;
  }

}

module.exports = CameraDevice;
