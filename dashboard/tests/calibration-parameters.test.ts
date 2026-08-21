import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CalibrationParameterRecord } from '../shared/types.js';
import { AssumptionGroupDisclosure, FittedParameterRow } from '../src/pages/ComparePage.js';

const parameter: CalibrationParameterRecord = {
  key: 'PSYCHOLOGICAL_COST_OF_RENTING',
  name: 'Psychological cost of renting',
  value: 0.75,
  lower: 0,
  upper: 1,
  priorLower: null,
  priorUpper: null,
  meaning: 'Represents the non-financial preference against renting.',
  calibrationReason: 'This preference cannot be observed directly.',
  increaseEffect: 'Renting becomes less attractive.',
  decreaseEffect: 'Renting becomes more attractive.'
};

const comparedParameter: CalibrationParameterRecord = { ...parameter, value: 0.5 };

const singleMarkup = renderToStaticMarkup(createElement(FittedParameterRow, {
  parameter,
  compared: undefined,
  primaryVersion: 'v5o3',
  comparisonVersion: undefined,
  mode: 'single'
}));

assert.match(singleMarkup, /^<details class="calibration-parameter-row calibration-parameter-row-single"><summary/);
assert.equal(/<details[^>]*\sopen(?:=|\s|>)/.test(singleMarkup), false, 'Parameter rows should start collapsed');
assert.ok(singleMarkup.includes('calibration-parameter-indicator') && singleMarkup.includes('▸'));
assert.ok(singleMarkup.includes('Psychological cost of renting'));
assert.ok(singleMarkup.includes('PSYCHOLOGICAL_COST_OF_RENTING'));
assert.ok(singleMarkup.includes('Selected value') && singleMarkup.includes('>0.75</strong>'));
assert.ok(singleMarkup.includes('Range tested') && singleMarkup.includes('>0–1</strong>'));
assert.ok(singleMarkup.indexOf('</summary>') < singleMarkup.indexOf('Behavioural meaning'));
[
  parameter.meaning,
  parameter.calibrationReason,
  parameter.increaseEffect,
  parameter.decreaseEffect
].forEach((copy) => assert.ok(singleMarkup.includes(copy), `Expanded content should retain: ${copy}`));

const comparisonMarkup = renderToStaticMarkup(createElement(FittedParameterRow, {
  parameter,
  compared: comparedParameter,
  primaryVersion: 'v5o3',
  comparisonVersion: 'v4.26',
  mode: 'compare'
}));

assert.ok(comparisonMarkup.includes('v4.26 value') && comparisonMarkup.includes('>0.5</strong>'));
assert.ok(comparisonMarkup.includes('v5o3 value') && comparisonMarkup.includes('>0.75</strong>'));
assert.ok(
  comparisonMarkup.indexOf('v5o3 value') < comparisonMarkup.indexOf('v4.26 value'),
  'The Model 1 value should appear before the Model 2 value in comparison mode'
);
assert.ok(comparisonMarkup.includes('Absolute difference') && comparisonMarkup.includes('>0.25</strong>'));
assert.ok(comparisonMarkup.includes('class="changed"') && comparisonMarkup.includes('>Changed</small>'));
assert.ok(comparisonMarkup.includes('Range tested') && comparisonMarkup.includes('>0–1</strong>'));

const unchangedMarkup = renderToStaticMarkup(createElement(FittedParameterRow, {
  parameter,
  compared: { ...parameter },
  primaryVersion: 'v5o3',
  comparisonVersion: 'v4.26',
  mode: 'compare'
}));
assert.ok(unchangedMarkup.includes('class="unchanged"') && unchangedMarkup.includes('>Unchanged</small>'));

const independentRowsMarkup = renderToStaticMarkup(createElement(Fragment, null,
  createElement(FittedParameterRow, {
    parameter,
    compared: undefined,
    primaryVersion: 'v5o3',
    comparisonVersion: undefined,
    mode: 'single'
  }),
  createElement(FittedParameterRow, {
    parameter: { ...parameter, key: 'SECOND_PARAMETER', name: 'Second parameter' },
    compared: undefined,
    primaryVersion: 'v5o3',
    comparisonVersion: undefined,
    mode: 'single'
  })
));
assert.equal((independentRowsMarkup.match(/<details class="calibration-parameter-row/g) ?? []).length, 2);
assert.equal((independentRowsMarkup.match(/<summary class="calibration-parameter-summary"/g) ?? []).length, 2);

const assumptionGroupMarkup = renderToStaticMarkup(createElement(AssumptionGroupDisclosure, {
  group: 'Housing & Rental Market',
  assumptionCount: 7,
  children: createElement('p', null, 'Grouped assumptions')
}));
assert.match(assumptionGroupMarkup, /^<details class="assumption-group"><summary class="assumption-group-summary">/);
assert.equal(/<details[^>]*\sopen(?:=|\s|>)/.test(assumptionGroupMarkup), false, 'Assumption groups should start collapsed');
assert.ok(assumptionGroupMarkup.includes('assumption-group-indicator') && assumptionGroupMarkup.includes('▸'));
assert.ok(assumptionGroupMarkup.includes('Housing &amp; Rental Market'));
assert.ok(assumptionGroupMarkup.includes('7 assumptions'));
assert.ok(assumptionGroupMarkup.indexOf('</summary>') < assumptionGroupMarkup.indexOf('Grouped assumptions'));

const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const comparePageSource = fs.readFileSync(new URL('../src/pages/ComparePage.tsx', import.meta.url), 'utf8');
assert.match(styles, /\.parameter-row-head code \{[\s\S]*?background: transparent;/);
assert.ok(styles.includes('.calibration-parameter-summary:hover'));
assert.ok(styles.includes('.calibration-parameter-summary:focus-visible'));
assert.ok(styles.includes('.calibration-parameter-row[open] > .calibration-parameter-summary'));
assert.ok(styles.includes('@media (max-width: 980px)') && styles.includes('.parameter-number-grid { grid-column: 2; }'));
assert.ok(styles.includes('@media (max-width: 480px)') && styles.includes('.parameter-number-grid { grid-template-columns: 1fr; }'));
assert.ok(styles.includes('.assumption-group + .assumption-group { border-top: 1px solid var(--rule); }'));
assert.ok(styles.includes('.assumption-group-summary:hover'));
assert.ok(styles.includes('.assumption-group-summary:focus-visible'));
assert.ok(styles.includes('.assumption-group[open] > .assumption-group-summary .assumption-group-indicator'));
assert.ok(styles.includes('.assumption-group-count {'));
assert.ok(!comparePageSource.includes('assumption-search') && !comparePageSource.includes('Search model assumptions'));
assert.ok(!comparePageSource.includes('setSearch') && !styles.includes('.assumption-search'));
assert.match(styles, /\.assumption-table-head, \.assumption-table-row \{[\s\S]*?column-gap: clamp\(1\.25rem, 2\.2vw, 2rem\);/);
assert.match(styles, /\.assumption-table-row \{[\s\S]*?padding: 1\.1rem 1rem;[\s\S]*?border-top: 1px solid var\(--rule\);/);
assert.ok(styles.includes('.assumption-table-row { grid-template-columns: 1fr; row-gap: 1.1rem; padding-block: 1.25rem; }'));
assert.match(styles, /\.assumption-scalar-values > div \{[\s\S]*?grid-template-columns: minmax\(0, max-content\) max-content;[\s\S]*?justify-content: start;[\s\S]*?column-gap: 0\.65rem;/);

console.log('Calibration parameter disclosure tests passed.');
