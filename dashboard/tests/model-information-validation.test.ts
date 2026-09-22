import assert from 'node:assert/strict';
import type { ValidationMetricSummary, ValidationOverviewPayload } from '../shared/types';
import {
  matchesModelInformationValidationSelection,
  selectModelInformationValidationMetric
} from '../src/lib/guidedDemos/modelInformationValidation';

type DemoMetric = Pick<ValidationMetricSummary,
  'metricId' | 'status' | 'sourceValue' | 'targetBand' | 'seedMean' | 'insideRate' | 'lossFamily'>;

const approvals: DemoMetric = {
  metricId: 'core_mortgageApprovals', status: 'pass', sourceValue: 50,
  targetBand: { lower: 45, upper: 55 }, seedMean: 52, insideRate: 0.8, lossFamily: 'positive_level'
};
const transactions = { ...approvals, metricId: 'core_housingTransactions' };
const priceToIncome = { ...approvals, metricId: 'core_priceToIncome' };
const order = [transactions.metricId, approvals.metricId, priceToIncome.metricId];

assert.equal(selectModelInformationValidationMetric([transactions, approvals], order), approvals,
  'Use the familiar mortgage approvals example even if payload ordering differs');
assert.equal(selectModelInformationValidationMetric([priceToIncome, transactions], order), transactions,
  'Fallback follows the visible theme order rather than incidental payload ordering');
assert.equal(selectModelInformationValidationMetric([{ ...approvals, status: 'unsupported' }, transactions], order), transactions);
assert.equal(selectModelInformationValidationMetric([{ ...approvals, sourceValue: null }, transactions], order), transactions);
assert.equal(selectModelInformationValidationMetric([{ ...approvals, lossFamily: 'bounded_low_is_better' }, transactions], order), transactions,
  'Distribution-shape metrics cannot support the scalar-target explanation');
assert.equal(selectModelInformationValidationMetric([{ ...approvals, insideRate: null }], order), null);
assert.equal(selectModelInformationValidationMetric([{ ...approvals, insideRate: 70 }], order), null);
assert.equal(selectModelInformationValidationMetric([{ ...approvals, targetBand: { lower: 55, upper: 45 } }], order), null);
assert.equal(selectModelInformationValidationMetric([{ ...approvals, seedMean: Number.NaN }], order), null);
assert.equal(selectModelInformationValidationMetric([approvals], ['other-metric']), null,
  'Do not choose a metric that has no visible table row');

const overview = {
  selectedVersion: 'v0o7', selectedValidationTargetYear: 2011,
  selectedSummary: { version: 'v0o7', validationTargetYear: 2011 }
} as Pick<ValidationOverviewPayload, 'selectedVersion' | 'selectedValidationTargetYear' | 'selectedSummary'>;
assert.equal(matchesModelInformationValidationSelection(overview, 'v0o7', 2011), true);
assert.equal(matchesModelInformationValidationSelection(overview, 'v0o7', 2024), false,
  'An unavailable evidence year must not become a silent year change');
assert.equal(matchesModelInformationValidationSelection(overview, 'v1', 2011), false,
  'An unavailable model must not become a silent model change');
assert.equal(matchesModelInformationValidationSelection({
  ...overview, selectedSummary: { ...overview.selectedSummary!, version: 'v1' }
}, 'v0o7', 2011), false, 'The actual summary must match, not only the response metadata');
assert.equal(matchesModelInformationValidationSelection(overview, '', 2011), false);

const comparisonSummary = {
  ...overview.selectedSummary!, version: 'v1'
};
const comparisonOverview = { ...overview, comparisonSummary };
assert.equal(matchesModelInformationValidationSelection(comparisonOverview, 'v0o7', 2011, 'v1'), true,
  'A comparison is ready only when both requested models use the selected evidence year');
assert.equal(matchesModelInformationValidationSelection(comparisonOverview, 'v0o7', 2011, 'v2'), false,
  'A stale comparison must not be displayed after selecting a different second model');
assert.equal(matchesModelInformationValidationSelection({
  ...comparisonOverview, comparisonSummary: { ...comparisonSummary, validationTargetYear: 2024 }
}, 'v0o7', 2011, 'v1'), false, 'A comparison from another evidence year is unavailable');
assert.equal(matchesModelInformationValidationSelection(overview, 'v0o7', 2011, 'v1'), false,
  'An absent optional comparison cannot count as a successful comparison request');
assert.equal(matchesModelInformationValidationSelection(comparisonOverview, 'v0o7', 2011, ''), false,
  'Clearing the comparison must immediately hide the previously loaded second model');
assert.equal(matchesModelInformationValidationSelection(overview, 'v0o7', 2011, ''), true,
  'The walkthrough remains usable without selecting a comparison');
assert.equal(matchesModelInformationValidationSelection({
  ...overview, comparisonSummary: overview.selectedSummary
}, 'v0o7', 2011, 'v0o7'), false, 'The second model must differ from the primary model');
assert.equal(matchesModelInformationValidationSelection(comparisonOverview, 'v0o7', 2011), true,
  'Recovery can separately verify the exact primary model before clearing an unavailable comparison');

console.log('Model information validation selection tests passed.');
