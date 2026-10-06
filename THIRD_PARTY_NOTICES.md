# Third-party notices

Verisure for Homey is licensed under the GNU General Public License v3.0 (see [LICENSE](LICENSE)).
It includes or is derived from the following third-party work.

## python-verisure

`lib/queries.js` contains the GraphQL query strings of
[python-verisure](https://github.com/persandstrom/python-verisure) (version 2.10.1), copied verbatim
by `scripts/extract-queries.py`. The API client in `lib/VerisureSession.js` is a port of its
`verisure/session.py`.

```
The MIT License (MIT)

Copyright (c) 2015 Per Sandström

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Homey device icons

The driver icons for door/window sensors, smoke, motion and water detectors, climate sensors,
VoiceBox, smart plugs, smart locks and cameras are Homey's built-in device icons from
[homey-lib](https://github.com/athombv/node-homey-lib) by Athom B.V., licensed under the
GNU General Public License v3.0.

## Homey Vectors

The alarm driver icon is from Athom's
[homey-vectors-public](https://github.com/athombv/homey-vectors-public), licensed under the
GNU General Public License v3.0.

## Design references (no code copied)

- Session handling, polling and rate-limit back-off follow Home Assistant's
  [Verisure integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/verisure)
  (Apache License 2.0).
- Reading detector events from Verisure's event log follows the
  [openHAB Verisure binding](https://github.com/openhab/openhab-addons/tree/main/bundles/org.openhab.binding.verisure)
  (Eclipse Public License 2.0).
