'use strict';

const https = require('https');

// Minimal HTTPS transport. Node's https module is used rather than fetch because the
// Verisure session lives entirely in cookies and fetch does not reliably expose every
// Set-Cookie header on all Node versions Homey ships.
//
// Resolves { status, text, setCookies } for any HTTP status; rejects only on transport
// failure (DNS, reset, timeout). VerisureSession decides what a status means.

const DEFAULT_TIMEOUT_MS = 30000;

function request({
  method = 'GET', url, headers = {}, body = null, timeout = DEFAULT_TIMEOUT_MS,
}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(body);
    const req = https.request(url, {
      method,
      headers: payload ? { ...headers, 'Content-Length': payload.length } : headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'] || [];
        resolve({
          status: res.statusCode,
          text: Buffer.concat(chunks).toString('utf8'),
          setCookies: Array.isArray(setCookie) ? setCookie : [setCookie],
        });
      });
      res.on('error', reject);
    });
    req.setTimeout(timeout, () => req.destroy(new Error(`Request timed out after ${timeout} ms`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Downloads a binary body (camera images). Follows up to 3 redirects because pre-signed
// media URLs are commonly served behind one.
function download(url, { timeout = DEFAULT_TIMEOUT_MS, redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    // python-requests always sends a User-Agent and Verisure's auth endpoints fail without
    // one, so the image download sends one too.
    const req = https.get(url, { headers: { 'User-Agent': 'com.verisure.myapp (Homey)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(download(new URL(res.headers.location, url).toString(), { timeout, redirects: redirects - 1 }));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Image download failed with HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] }));
      res.on('error', reject);
    });
    req.setTimeout(timeout, () => req.destroy(new Error(`Download timed out after ${timeout} ms`)));
    req.on('error', reject);
  });
}

module.exports = { request, download };
