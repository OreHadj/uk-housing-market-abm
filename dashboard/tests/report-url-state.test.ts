import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { SensitivityExperimentMetadata, SensitivityExperimentResultsPayload } from '../shared/types';
import { readReportIndicator, readSensitivityReportState, updateReportQuery } from '../src/lib/reportUrlState';
import { buildSensitivityReport2 } from '../src/pages/sensitivity-report2/sensitivityReport2Model';

const original = new URLSearchParams('type=manual&presentation=report&baselineRunId=Example+policy&comparisonRunId=Example+baseline&demo=policy-results&step=market&from=policy&journey=test-journey&window=post500&custom=a&custom=b');
const snapshot = original.toString();
assert.equal(readReportIndicator(original), 'output_saleAvSalePrice');
const selected = updateReportQuery(original, { indicator: 'core_mortgageApprovals' });
assert.equal(readReportIndicator(new URLSearchParams(selected.toString())), 'core_mortgageApprovals', 'Refresh restores the selected market chart');
assert.equal(original.toString(), snapshot, 'URL updates never mutate the router snapshot');
for (const key of ['demo', 'step', 'from', 'journey', 'baselineRunId', 'comparisonRunId', 'window', 'presentation']) {
  assert.equal(selected.get(key), original.get(key), `Changing an indicator preserves ${key}`);
}
assert.deepEqual(selected.getAll('custom'), ['a', 'b']);
assert.equal(readReportIndicator(new URLSearchParams('indicator=unavailable')), 'output_saleAvSalePrice');
assert.equal(readReportIndicator(new URLSearchParams('indicator=%20core_housingTransactions%20')), 'core_housingTransactions');
assert.equal(updateReportQuery(selected, { indicator: '', window: null }).has('indicator'), false);
assert.equal(updateReportQuery(selected, { indicator: '', window: null }).has('window'), false);

const sampledPoints = [4, 4.5, 5].map((value) => ({ pointId: `point-${value}`, value, label: String(value), slotLabels: [], isBaseline: value === 4.5 }));
const detail: SensitivityExperimentMetadata = {
  experimentId: 'isolated-url-fixture', baseline: 'v0o7', status: 'succeeded', createdAt: '2026-09-21',
  seeds: [1], seedsPerPoint: 1,
  parameter: { key: 'BANK_LTI_HARD_MAX_FTB', title: 'LTI', description: '', type: 'number', baselineValue: 4.5, min: 4, max: 5, sampleCount: 3 },
  sampledPoints, warnings: [], warningSummary: { byPoint: {} }, collapsedSlots: {}, runCommand: { commandTemplate: '' }
};
const results: SensitivityExperimentResultsPayload = { experimentId: detail.experimentId, baselinePointId: 'point-4.5', points: [] };
const model = buildSensitivityReport2(detail, results, null);
const sensitivity = new URLSearchParams('type=sensitivity&presentation=report&experimentId=isolated-url-fixture&demo=sensitivity-results&step=outcome');
assert.deepEqual(readSensitivityReportState(sensitivity, model), {
  outcomeKey: 'core_mortgageApprovals', settingId: 'point-4', hasExplicitSetting: false
});
const changedOutcome = updateReportQuery(sensitivity, { outcome: 'core_debtToIncome' });
const changedSetting = updateReportQuery(changedOutcome, { setting: 'point-5' });
assert.deepEqual(readSensitivityReportState(new URLSearchParams(changedSetting.toString()), model), {
  outcomeKey: 'core_debtToIncome', settingId: 'point-5', hasExplicitSetting: true
}, 'Refresh restores both independent sensitivity controls');
assert.equal(changedSetting.get('step'), 'outcome', 'Page actions do not advance the guide');
assert.equal(changedSetting.get('experimentId'), detail.experimentId);
assert.equal(readSensitivityReportState(changedOutcome, model).settingId, 'point-4', 'Prior history entry retains its prior selection');
assert.equal(readSensitivityReportState(new URLSearchParams('outcome=unknown&setting=point-99'), model).settingId, 'point-4');
assert.equal(readSensitivityReportState(new URLSearchParams('outcome=unknown&setting=point-99'), model).outcomeKey, 'core_mortgageApprovals');
assert.equal(readSensitivityReportState(new URLSearchParams('setting=point-4.5'), model).settingId, 'point-4.5', 'Baseline is a valid explicit selection');
const emptyModel = { ...model, rows: [], numericRows: [], baselineRow: null, outcomes: [] };
assert.deepEqual(readSensitivityReportState(changedSetting, emptyModel), { outcomeKey: '', settingId: null, hasExplicitSetting: false });

const policyPage = fs.readFileSync(new URL('../src/pages/report2/Report2Page.tsx', import.meta.url), 'utf8');
const sensitivityPage = fs.readFileSync(new URL('../src/pages/sensitivity-report2/SensitivityReport2Page.tsx', import.meta.url), 'utf8');
assert.match(policyPage, /const marketId = readReportIndicator\(searchParams\)/);
assert.match(policyPage, /update\(\{ indicator: item.id \}\)/);
assert.match(sensitivityPage, /readSensitivityReportState\(searchParams, model\)/);
assert.match(sensitivityPage, /const choosePoint = \(pointId: string\) => update\(\{ setting: pointId \}\)/, 'Select and chart clicks share the URL writer');
for (const page of [policyPage, sensitivityPage]) {
  assert.match(page, /updateReportQuery\(current, updates\), \{ replace: true \}/, 'Page controls replace their current history entry');
  assert.doesNotMatch(page, /className="example-badge"/, 'Results reports omit the redundant Example tag');
  assert.doesNotMatch(page, /isExample \? ' · Example' : ''/, 'Selectors retain the saved title without an extra Example suffix');
}
assert.match(policyPage, /if \(isPolicyGuide \|\| primaryId \|\| runsLoading/, 'Missing guided examples never select another saved run');
assert.match(sensitivityPage, /if \(isSensitivityGuide \|\| experimentId \|\| listLoading/, 'Missing guided sweeps never select another experiment');
for (const target of ['policy-run-selectors', 'policy-context', 'policy-market', 'policy-borrowers', 'policy-rental']) assert.ok(policyPage.includes(`data-guided-target="${target}"`));
assert.ok(policyPage.includes('guidedTarget="policy-house-price"'));
for (const target of ['sensitivity-context', 'sensitivity-response', 'sensitivity-selected', 'sensitivity-pairing']) assert.ok(sensitivityPage.includes(`data-guided-target="${target}"`));
console.log('Report URL state tests passed.');
