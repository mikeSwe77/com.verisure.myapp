'use strict';

// Turns arm dry-run violations into the text shown on the alarm device and in Flow tokens,
// e.g. "Entré (open), Fönster sovrum (open)". Known violation codes are translated; unknown ones
// are shown in readable form ("SOME_CODE" → "some code") so new codes still make sense.

function describeViolations(violations, names, translate) {
  return violations.map(({ deviceLabel, violation }) => {
    const name = (names && names[deviceLabel]) || deviceLabel || '?';
    const key = `arm_ready.violation.${violation}`;
    const translated = translate(key);
    const reason = translated && translated !== key
      ? translated
      : String(violation || '').toLowerCase().replace(/_/g, ' ');
    return reason ? `${name} (${reason})` : name;
  }).join(', ');
}

module.exports = { describeViolations };
