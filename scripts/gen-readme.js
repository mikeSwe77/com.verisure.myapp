'use strict';

// Regenerates the device and Flow card tables in README.md from app.json, between the
// <!-- GENERATED:devices --> / <!-- GENERATED:flow --> markers. Run after `homey app build`
// or `homey app validate` (which regenerate app.json):  npm run docs

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const README = path.join(ROOT, 'README.md');

// Titles of Homey's standard capabilities come from homey-lib (shipped with the Homey CLI).
let libCapabilities = null;
try {
  const cli = path.dirname(fs.realpathSync(execSync('command -v homey').toString().trim()));
  libCapabilities = path.join(cli, '..', 'node_modules', 'homey-lib', 'assets', 'capability', 'capabilities');
} catch (err) {
  libCapabilities = null;
}

function capabilityTitle(id, options = {}) {
  if (options.title && options.title.en) return options.title.en;
  const base = id.split('.')[0];
  if (app.capabilities && app.capabilities[base]) return app.capabilities[base].title.en;
  try {
    return JSON.parse(fs.readFileSync(path.join(libCapabilities, `${base}.json`), 'utf8')).title.en;
  } catch (err) {
    return id;
  }
}

function settingsOf(driver) {
  const flat = [];
  for (const setting of driver.settings || []) {
    if (setting.type === 'group') flat.push(...setting.children);
    else flat.push(setting);
  }
  return flat.map((s) => s.label.en);
}

function devicesTable() {
  const rows = app.drivers.map((driver) => {
    const caps = driver.capabilities
      .map((id) => capabilityTitle(id, (driver.capabilitiesOptions || {})[id]))
      .join(', ');
    const settings = settingsOf(driver).join(', ') || '–';
    return `| **${driver.name.en}** | ${caps} | ${settings} |`;
  });
  return ['| Device | Shows / controls | Settings |', '|---|---|---|', ...rows].join('\n');
}

function plain(text) {
  // "Broadband !{{is|is not}} online" → "Broadband is / is not online"
  return text.replace(/!\{\{([^|]*)\|([^}]*)\}\}/g, '$1 / $2').replace(/\[\[(\w+)\]\]/g, '‹$1›');
}

function driverOf(card) {
  const device = (card.args || []).find((arg) => arg.type === 'device');
  const match = device && /driver_id=(\w+)/.exec(device.filter || '');
  const driver = match && app.drivers.find((d) => d.id === match[1]);
  return driver ? driver.name.en : 'App';
}

function flowTable(kind, heading) {
  const order = (card) => app.drivers.findIndex((d) => d.name.en === driverOf(card));
  const cards = [...((app.flow && app.flow[kind]) || [])]
    .sort((a, b) => order(a) - order(b) || a.title.en.localeCompare(b.title.en));
  const rows = cards.map((card) => {
    const title = plain((card.titleFormatted && card.titleFormatted.en) || card.title.en);
    const tokens = (card.tokens || []).map((t) => t.title.en).join(', ') || '–';
    const hint = card.hint ? card.hint.en : '';
    return `| ${driverOf(card)} | ${title} | ${tokens} | ${hint} |`;
  });
  return [`**${heading}**`, '', '| Device | Card | Tokens | Notes |', '|---|---|---|---|', ...rows].join('\n');
}

function flowSection() {
  return [
    flowTable('triggers', 'When…'),
    flowTable('conditions', 'And…'),
    flowTable('actions', 'Then…'),
  ].join('\n\n');
}

function replaceBlock(text, name, content) {
  const start = `<!-- GENERATED:${name} -->`;
  const end = `<!-- /GENERATED:${name} -->`;
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from < 0 || to < 0) throw new Error(`README.md is missing the ${start} … ${end} markers`);
  return `${text.slice(0, from + start.length)}\n${content}\n${text.slice(to)}`;
}

let readme = fs.readFileSync(README, 'utf8');
readme = replaceBlock(readme, 'devices', devicesTable());
readme = replaceBlock(readme, 'flow', flowSection());
fs.writeFileSync(README, readme);
console.log('README.md tables regenerated from app.json');
