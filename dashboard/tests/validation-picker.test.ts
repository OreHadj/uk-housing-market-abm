import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MODEL_ANCHORS } from '../src/lib/modelAnchors.js';
import { ValidationModelOptions, ValidationPage } from '../src/pages/ValidationPage.js';

function renderValidation(entry: string): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [entry] },
      createElement(Routes, null, createElement(Route, { path: '/validation', element: createElement(ValidationPage) }))
    )
  );
}

const singleMarkup = renderValidation('/validation?version=v5o3&evidenceYear=2024');
assert.ok(
  singleMarkup.includes('The evidence used to validate this model was from <strong>2024</strong>.'),
  'The fixed evidence year should be explanatory text'
);
assert.equal(singleMarkup.includes('>Evidence year</span>'), false, 'Evidence year should not look selectable');
assert.ok(
  singleMarkup.includes('If you want to understand the difference between two models, visit the') &&
    singleMarkup.includes('>calibration page</a>'),
  'The validation description should always direct users to calibration for model differences'
);
assert.ok(
  singleMarkup.includes('/model-evidence?view=calibration&amp;mode=single&amp;version=v5o3'),
  'The calibration guidance should carry the primary model into the calibration page'
);
assert.equal(singleMarkup.includes('What differs between'), false, 'The contextual comparison button should be removed');
assert.ok(singleMarkup.includes('Sort models by'), 'The shared model sort control should remain available');
assert.equal(
  (singleMarkup.match(/<section class="validation-model-column/g) ?? []).length,
  2,
  'Both model columns should always render'
);
assert.ok(
  singleMarkup.includes('Primary model') && singleMarkup.includes('Comparison model'),
  'The side-by-side columns should have clear roles'
);
assert.ok(
  singleMarkup.includes('validation-model-column-comparison is-disabled') &&
    singleMarkup.includes('aria-disabled="true"') &&
    singleMarkup.includes('role="radiogroup"'),
  'The visible comparison column should be disabled until Compare is checked'
);
assert.ok(singleMarkup.includes('Check Compare to enable this column.'));
assert.equal(
  singleMarkup.includes('Models ordered by distance'),
  false,
  'The redundant sorting explanation should not render'
);

const compareMarkup = renderValidation('/validation?version=v5o3&evidenceYear=2024&comparisonVersion=v4.26');
assert.ok(compareMarkup.includes('validation-model-column-comparison is-enabled'));
assert.ok(compareMarkup.includes('aria-disabled="false"'));
assert.ok(
  compareMarkup.includes(
    '/model-evidence?view=calibration&amp;mode=compare&amp;left=v5o3&amp;right=v4.26'
  ),
  'The permanent calibration link should carry both selected models when comparing'
);

const anchorVersions = MODEL_ANCHORS.map((anchor) => anchor.version);
const sortedVersions = [...anchorVersions].reverse();
const rankings = sortedVersions.map((version, index) => ({
  version,
  deviationPercent: index * 2,
  status: null,
  metricLoss: null
}));
const primaryOptionsMarkup = renderToStaticMarkup(
  createElement(ValidationModelOptions, {
    versions: sortedVersions,
    selectedVersion: 'v5o3',
    name: 'primary-model-test',
    label: 'Primary model test',
    rankings,
    onChange: () => undefined
  })
);
assert.equal(
  (primaryOptionsMarkup.match(/type="radio"/g) ?? []).length,
  4,
  'All four named models should be visible as radio options'
);
['1.', '2.', '3.', '4.'].forEach((rank) => {
  assert.ok(
    primaryOptionsMarkup.includes(`>${rank}</span>`),
    `Rank ${rank} should use a minimal ordinal label`
  );
});
MODEL_ANCHORS.forEach((anchor) => {
  assert.ok(primaryOptionsMarkup.includes(anchor.name), `${anchor.name} should be visible`);
});
assert.ok(
  primaryOptionsMarkup.indexOf('Refitted 2024 model') < primaryOptionsMarkup.indexOf('2024 data model') &&
    primaryOptionsMarkup.indexOf('2024 data model') < primaryOptionsMarkup.indexOf('Refitted 2011 model') &&
    primaryOptionsMarkup.indexOf('Refitted 2011 model') < primaryOptionsMarkup.indexOf('Original 2011 model'),
  'The visible rows should follow the supplied metric ranking'
);

const disabledComparisonMarkup = renderToStaticMarkup(
  createElement(ValidationModelOptions, {
    versions: anchorVersions,
    selectedVersion: '',
    name: 'comparison-model-disabled-test',
    label: 'Disabled comparison model test',
    disabled: true,
    unavailableVersion: 'v5o3',
    onChange: () => undefined
  })
);
assert.equal(
  (disabledComparisonMarkup.match(/type="radio"/g) ?? []).length,
  4,
  'The disabled comparison column should still show all four models'
);
assert.equal(
  (disabledComparisonMarkup.match(/disabled=""/g) ?? []).length,
  4,
  'All comparison choices should be untouchable until Compare is checked'
);

const enabledComparisonMarkup = renderToStaticMarkup(
  createElement(ValidationModelOptions, {
    versions: anchorVersions,
    selectedVersion: 'v4.26',
    name: 'comparison-model-enabled-test',
    label: 'Enabled comparison model test',
    unavailableVersion: 'v5o3',
    onChange: () => undefined
  })
);
assert.equal(
  (enabledComparisonMarkup.match(/type="radio"/g) ?? []).length,
  4,
  'Enabling comparison must not hide the primary model row'
);
assert.equal(
  (enabledComparisonMarkup.match(/disabled=""/g) ?? []).length,
  1,
  'Only the model already selected as primary should remain unavailable'
);
assert.ok(enabledComparisonMarkup.includes('Selected as primary'));

console.log('Validation model picker tests passed.');
