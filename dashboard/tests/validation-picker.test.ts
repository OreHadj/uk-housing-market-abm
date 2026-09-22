import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ValidationMetricSummary, ValidationVersionSummary } from '../shared/types.js';
import { CollapsibleSection } from '../src/components/CollapsibleSection.js';
import { MODEL_ANCHORS } from '../src/lib/modelAnchors.js';
import {
  DEFAULT_VALIDATION_METRIC_SORT,
  describeThemeStatuses,
  findValidationThemeId,
  formatValidationScorecardValue,
  formatValidationSnapshotProtocol,
  hasMetricProvenance,
  resolveValidationModelsForEvidenceYear,
  sortValidationMetrics,
  VALIDATION_METRIC_DETAILS_PANEL_ID,
  ValidationMetricDetailsPanel,
  ValidationMetricTable,
  ValidationModelOptions,
  ValidationPage
} from '../src/pages/ValidationPage.js';

assert.equal(
  describeThemeStatuses(Array.from({ length: 5 }, () => ({ status: 'fail' as const }))),
  '5/5 fail',
  'Theme summaries should show the failing count over the total metric count'
);
assert.equal(
  describeThemeStatuses([
    { status: 'pass' },
    { status: 'fail' },
    { status: 'warn' },
    { status: 'pass' },
    { status: 'fail' }
  ]),
  '2/5 fail · 1/5 warn · 2/5 pass',
  'Mixed theme summaries should use the same total for every status'
);
assert.equal(findValidationThemeId('core_advancesToBTL'), 'activity');
assert.equal(findValidationThemeId('housing_wealth_distribution_jsd'), 'distribution');
assert.equal(findValidationThemeId('core_housingTransactions'), 'activity');

const describedDisclosureMarkup = renderToStaticMarkup(
  createElement(
    CollapsibleSection,
    {
      title: 'Summary card',
      description: 'Description beside the title block.',
      summary: 'Original summary at the row end',
      children: createElement('p', null, 'Disclosure content')
    }
  )
);
assert.match(
  describedDisclosureMarkup,
  /collapsible-section-title[^>]*>Summary card<\/span>[\s\S]*?collapsible-section-description[^>]*>Description beside the title block\.<\/span>[\s\S]*?collapsible-section-summary[^>]*>Original summary at the row end<\/span>/,
  'Described disclosures should stack title then description, with the summary at the far right of the row'
);
assert.ok(
  describedDisclosureMarkup.includes('collapsible-section-heading-copy'),
  'Described disclosures should stack the description directly beneath the title'
);

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
  singleMarkup.includes('The selected model is validated against <strong>2024 evidence</strong>.'),
  'The selected evidence year should be explanatory text'
);
assert.ok(singleMarkup.includes('>Evidence year</span>'), 'Evidence year should be selectable');
assert.ok(singleMarkup.includes('>2024 evidence</option>'));
assert.ok(singleMarkup.includes('>2011 reference evidence</option>'));

const referenceMarkup = renderValidation('/validation?version=v0o7&evidenceYear=2011');
assert.ok(
  referenceMarkup.includes('<strong>2011 reference evidence overlay</strong>') &&
    referenceMarkup.includes('historical reference view'),
  'The 2011 choice should be clearly identified as a reference evidence overlay'
);

const validationAvailability = {
  availableVersions: ['v0', 'v0o2', 'v0o7', 'v5o3'],
  availableValidationTargetYearsByVersion: {
    v0: [2024, 2011],
    v0o2: [2024, 2011],
    v0o7: [2024, 2011],
    v5o3: [2024]
  }
};
assert.deepEqual(
  resolveValidationModelsForEvidenceYear(validationAvailability, 'v0o2', 'v0', 2011),
  {
    eligibleVersions: ['v0', 'v0o7'],
    selectedVersion: 'v0o7',
    comparisonVersion: 'v0'
  },
  'A historical calibration step should fall back to the latest runnable model'
);
assert.deepEqual(
  resolveValidationModelsForEvidenceYear(validationAvailability, 'v5o3', 'v0', 2011),
  {
    eligibleVersions: ['v0', 'v0o7'],
    selectedVersion: 'v0o7',
    comparisonVersion: 'v0'
  },
  'An incompatible primary should fall back to the latest eligible named model'
);
assert.equal(
  resolveValidationModelsForEvidenceYear(validationAvailability, 'v0', 'v5o3', 2011).comparisonVersion,
  '',
  'An incompatible comparison should be cleared'
);
assert.ok(
  singleMarkup.includes('If you want to understand the difference between two models, visit the') &&
    singleMarkup.includes('>calibration page</a>'),
  'Validation should always direct users to calibration for model differences'
);
assert.ok(
  singleMarkup.indexOf('If you want to understand the difference between two models, visit the') >
    singleMarkup.indexOf('Check Compare to enable this column.'),
  'The calibration guidance should appear below the complete model selection interface'
);
assert.match(
  singleMarkup,
  /visit the <a href="[^"]+">calibration page<\/a>\./,
  'Only “calibration page” should be linked in the guidance sentence'
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
assert.equal(formatValidationScorecardValue(5, 3), '5 vs 3');
assert.equal(formatValidationScorecardValue('60%', '40%'), '60% vs 40%');
assert.equal(formatValidationScorecardValue(5), '5');
assert.ok(
  compareMarkup.includes(
    '/model-evidence?view=calibration&amp;mode=compare&amp;left=v4.26&amp;right=v5o3'
  ),
  'The permanent calibration link should preserve Validation Model 1 as Calibration Primary'
);

const v5o3Snapshot = JSON.parse(
  fs.readFileSync(new URL('../../input-data-versions/validation/v5o3.json', import.meta.url), 'utf8')
) as ValidationVersionSummary;
const v426Snapshot = JSON.parse(
  fs.readFileSync(new URL('../../input-data-versions/validation/v4.26.json', import.meta.url), 'utf8')
) as ValidationVersionSummary;
for (const relativeDirectory of ['validation', 'validation-overlays']) {
  const snapshotDirectory = new URL(`../../input-data-versions/${relativeDirectory}/`, import.meta.url);
  for (const fileName of fs.readdirSync(snapshotDirectory).filter((name) => name.endsWith('.json'))) {
    const snapshot = JSON.parse(fs.readFileSync(new URL(fileName, snapshotDirectory), 'utf8')) as ValidationVersionSummary;
    assert.ok(Array.isArray(snapshot.seeds), `${relativeDirectory}/${fileName} should retain its seed list`);
    assert.equal(typeof snapshot.window?.startIndex, 'number', `${relativeDirectory}/${fileName} should retain its window start`);
    assert.equal(typeof snapshot.window?.endIndex, 'number', `${relativeDirectory}/${fileName} should retain its window end`);
    snapshot.metrics.forEach((metric) => {
      assert.equal(metric.metricWeight ?? 1, 1, `${relativeDirectory}/${fileName} ${metric.metricId} should retain unit weight`);
      assert.ok(hasMetricProvenance(metric), `${relativeDirectory}/${fileName} ${metric.metricId} should expose Details`);
    });
  }
}
assert.equal(
  formatValidationSnapshotProtocol(v5o3Snapshot),
  '10 seeds, aggregation window steps 500–3,500',
  'The v5o3 view should describe the protocol stored on its displayed snapshot'
);
assert.equal(
  formatValidationSnapshotProtocol(v426Snapshot),
  '8 seeds, aggregation window steps 200–2,000',
  'The v4.26 view should describe its shorter stored protocol rather than using fixed page copy'
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

const baseMetric: ValidationMetricSummary = {
  metricId: 'fixture',
  label: 'Fixture metric',
  status: 'fail',
  requirement: 'required',
  units: 'count/month',
  sourceLabel: 'Fixture evidence source',
  sourceIndicatorLabel: 'Fixture indicator',
  sourceDocumentPath: 'evidence/fixture.csv',
  sourceTextPath: null,
  sourceTable: 'Fixture table',
  sourcePage: 1,
  rawSourceValue: 62_863,
  sourceValue: 62.86,
  sourceAsOf: '2024',
  sourceUnits: 'count/month',
  comparisonUnits: 'thousand count/month',
  mappingStatus: 'derived_match',
  bandMethod: 'fixture_band',
  bandNotes: 'Fixture target-band note.',
  sourceReferences: [{
    label: 'Fixture reference',
    sourceDocumentPath: 'evidence/fixture.csv',
    sourceTextPath: null,
    sourceTable: 'Fixture table',
    sourcePage: 1,
    sourceIndicatorLabel: 'Fixture indicator',
    rawSourceValue: 62_863,
    sourceAsOf: '2024',
    sourceUnits: 'count/month',
    notes: 'Fixture provenance note.'
  }],
  targetBand: { lower: 55.25, upper: 70.75 },
  seedMean: 75.125,
  p25: 74.875,
  p75: 75.375,
  insideRate: 0.4,
  lossFamily: 'positive_level',
  lossTransform: 'log_ratio',
  lossScale: 62.86,
  lossScaleBasis: 'source_value',
  additiveScale: null,
  additiveScaleBasis: null,
  normalizedDistance: 0.2,
  normalizedIqr: 0.01,
  distanceComponent: 0.2,
  spreadComponent: 0.01,
  levelComponent: 0.2,
  insideRateComponent: 0.6,
  metricLoss: 0.6725,
  lossDeltaVsReference2011: 0.12,
  lossDeltaPercentVsReference2011: 21.4,
  metricWeight: 1
};

function metricFixture(overrides: Partial<ValidationMetricSummary>): ValidationMetricSummary {
  return { ...baseMetric, ...overrides };
}

const tableMetrics = [
  metricFixture({ metricId: 'core_mortgageApprovals', label: 'Mortgage Approvals', metricLoss: 0.6725 }),
  metricFixture({ metricId: 'core_housingTransactions', label: 'Housing Transactions', metricLoss: 0.8865 }),
  metricFixture({ metricId: 'core_advancesToFTB', label: 'Advances to FTB', metricLoss: 0.537 })
];

assert.deepEqual(
  sortValidationMetrics(tableMetrics).map((metric) => metric.metricId),
  ['core_housingTransactions', 'core_mortgageApprovals', 'core_advancesToFTB'],
  'The default section sort should put the highest metric loss first'
);
assert.deepEqual(
  DEFAULT_VALIDATION_METRIC_SORT,
  { key: 'loss', direction: 'descending' },
  'The published default sort should remain loss descending'
);

const stableSortMetrics = [
  metricFixture({ metricId: 'stable-first', label: 'Stable first', metricLoss: 0.4 }),
  metricFixture({ metricId: 'highest', label: 'Highest', metricLoss: 0.9 }),
  metricFixture({ metricId: 'stable-second', label: 'Stable second', metricLoss: 0.4 }),
  metricFixture({ metricId: 'unsupported', label: 'Unsupported', metricLoss: null, status: 'unsupported' })
];
assert.deepEqual(
  sortValidationMetrics(stableSortMetrics).map((metric) => metric.metricId),
  ['highest', 'stable-first', 'stable-second', 'unsupported'],
  'Loss sorting should be stable for ties and keep unsupported values at the end'
);
assert.deepEqual(
  sortValidationMetrics(stableSortMetrics, { key: 'loss', direction: 'ascending' }).map((metric) => metric.metricId),
  ['stable-first', 'stable-second', 'highest', 'unsupported'],
  'Numeric columns should support the opposite sort direction without disturbing ties'
);

const closedValidationTableMarkup = renderToStaticMarkup(
  createElement(ValidationMetricTable, {
    themeTitle: 'Market activity and lending',
    metrics: tableMetrics
  })
);
const validationTableMarkup = renderToStaticMarkup(
  createElement(ValidationMetricTable, {
    themeTitle: 'Market activity and lending',
    metrics: tableMetrics,
    activeMetricId: 'core_mortgageApprovals'
  })
);
const validationCompareTableMarkup = renderToStaticMarkup(
  createElement(ValidationMetricTable, {
    themeTitle: 'Market activity and lending',
    metrics: tableMetrics,
    comparisonMetrics: new Map(tableMetrics.map((metric) => [metric.metricId, metric])),
    versionLabels: { selected: 'v5o3', comparison: 'v4.26' }
  })
);
assert.ok(
  validationTableMarkup.includes('<table class="validation-metrics-table">') &&
    validationTableMarkup.includes('<caption class="visually-hidden">Market activity and lending</caption>') &&
    validationTableMarkup.includes('<thead>') &&
    validationTableMarkup.includes('scope="col"') &&
    validationTableMarkup.includes('scope="row"') &&
    validationTableMarkup.includes('tabindex="0"'),
  'Each theme should render a semantic, keyboard-scrollable table with a section caption'
);
[
  'Metric',
  'Status',
  'Target',
  'Target band',
  'Simulated mean',
  'Simulated IQR',
  'Off target',
  'Seeds in band',
  'Loss'
].forEach((heading) => {
  assert.ok(validationTableMarkup.includes(heading), `Expected the ${heading} table column`);
});
assert.equal(validationTableMarkup.includes('Weight'), false, 'The constant metric weight should not render as a column');
assert.equal(validationTableMarkup.includes('Δ vs 2011'), false, 'Cross-catalogue loss deltas should not render as a column');
assert.equal(validationCompareTableMarkup.includes('Weight'), false, 'Compare tables should also omit the weight column');
assert.equal(validationCompareTableMarkup.includes('Δ vs 2011'), false, 'Compare tables should also omit cross-catalogue deltas');
assert.equal(
  (validationTableMarkup.match(/class="validation-sort-button"/g) ?? []).length,
  4,
  'Only Metric, Off target, Seeds in band, and Loss should expose sort controls'
);
['Target', 'Target band', 'Simulated mean', 'Simulated IQR'].forEach((heading) => {
  assert.equal(
    validationTableMarkup.includes(`aria-label="Sort by ${heading},`),
    false,
    `${heading} should remain a plain, unsortable header`
  );
});
assert.ok(
  validationTableMarkup.includes('aria-sort="descending"') &&
    validationTableMarkup.indexOf('Housing Transactions') < validationTableMarkup.indexOf('Mortgage Approvals') &&
    validationTableMarkup.indexOf('Mortgage Approvals') < validationTableMarkup.indexOf('Advances to FTB') &&
    validationTableMarkup.includes('0.5370'),
  'The rendered table should expose its default sort and format every loss to four decimal places'
);
assert.ok(
  validationTableMarkup.includes('aria-expanded="true"') &&
    validationTableMarkup.includes(`aria-controls="${VALIDATION_METRIC_DETAILS_PANEL_ID}"`) &&
    validationTableMarkup.includes('aria-haspopup="dialog"') &&
    validationTableMarkup.includes('>Details</button>'),
  'Each sourced metric should expose a labelled Details trigger associated with the side panel'
);
assert.equal(
  (validationTableMarkup.match(/>Details<\/button>/g) ?? []).length,
  tableMetrics.length,
  'Every sourced fixture row should show the Details text trigger'
);
assert.equal(
  validationTableMarkup.includes('validation-metric-detail-row'),
  false,
  'Details must not insert an expanding row into the table'
);

const extractTable = (markup: string) => markup.match(/<table class="validation-metrics-table">[\s\S]*<\/table>/)?.[0] ?? '';
const normalizeExpandedState = (markup: string) => markup
  .replace(/aria-expanded="(?:true|false)"/g, 'aria-expanded="state"')
  .replace(/aria-label="(?:Open|Close) details for /g, 'aria-label="Details for ');
assert.equal(
  normalizeExpandedState(extractTable(validationTableMarkup)),
  normalizeExpandedState(extractTable(closedValidationTableMarkup)),
  'Opening the external panel must leave the table DOM and row geometry unchanged'
);

const metricDetailsMarkup = renderToStaticMarkup(
  createElement(ValidationMetricDetailsPanel, {
    detail: { metric: tableMetrics[0]!, trigger: null, showBandNote: true },
    onClose: () => undefined
  })
);
assert.ok(
  metricDetailsMarkup.includes(`id="${VALIDATION_METRIC_DETAILS_PANEL_ID}"`) &&
    metricDetailsMarkup.includes('role="dialog"') &&
    metricDetailsMarkup.includes('tabindex="-1"') &&
    metricDetailsMarkup.includes('aria-labelledby="validation-metric-details-heading-core_mortgageApprovals"') &&
    metricDetailsMarkup.includes('Mortgage Approvals') &&
    metricDetailsMarkup.includes('validation-loss-family-detail') &&
    metricDetailsMarkup.includes('<dt>Loss family</dt>') &&
    metricDetailsMarkup.includes('<strong>Positive level</strong>') &&
    metricDetailsMarkup.includes('<small><span>Transform</span>Log ratio</small>') &&
    metricDetailsMarkup.includes('Sources and provenance') &&
    metricDetailsMarkup.includes('Fixture evidence source'),
  'The external panel should be labelled by the metric and retain loss-family and provenance content'
);

const noProvenanceMetric = metricFixture({
  metricId: 'no-provenance',
  sourceLabel: '',
  sourceReferences: [],
  sourceDocumentPath: null,
  sourceTextPath: null,
  bandNotes: null
});
assert.equal(hasMetricProvenance(noProvenanceMetric), false);
const noProvenanceMarkup = renderToStaticMarkup(
  createElement(ValidationMetricTable, { themeTitle: 'No provenance', metrics: [noProvenanceMetric] })
);
assert.equal(noProvenanceMarkup.includes('>Details</button>'), false, 'Rows without provenance should have no empty trigger');

const advancesToBtl = v5o3Snapshot.metrics.find((metric) => metric.metricId === 'core_advancesToBTL');
assert.ok(v5o3Snapshot.metrics.every(hasMetricProvenance), 'Every v5o3 metric should have data for a Details trigger');
assert.ok(advancesToBtl, 'The v5o3 snapshot should include Advances to BTL');
const advancesToBtlPanel = renderToStaticMarkup(
  createElement(ValidationMetricDetailsPanel, {
    detail: { metric: advancesToBtl!, trigger: null, showBandNote: true },
    onClose: () => undefined
  })
);
[
  'Buy to let Mortgage Market Update Q1.pdf · p.2 · Latest 2024 Q1 summary panel',
  'Buy to let Mortgage Market Update Q2.pdf · p.2 · Latest 2024 Q2 summary panel',
  'Buy to let Mortgage Market Update Q3.pdf · p.2 · Latest 2024 Q3 summary panel',
  'Buy to let Mortgage Market Update Q4.pdf · p.2 · Latest 2024 Q4 summary panel',
  'Quarterly house-purchase counts 12,422 + 14,955 + 16,410 + 18,268 converted to monthly mean: 62,055 / 12 / 1,000 = 5.171.'
].forEach((provenanceLine) => {
  assert.ok(advancesToBtlPanel.includes(provenanceLine), `Advances to BTL should retain: ${provenanceLine}`);
});

console.log('Validation model picker tests passed.');
