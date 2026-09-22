import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_EXAMPLE_FIGURES, DEMO_EXAMPLE_IDS } from '../shared/demoExamples';
import { seedDemoExamples } from '../server/lib/demoExamples';
import { createDevelopmentRuntimePaths } from '../server/lib/runtimePaths';
import { getResultsCompare, getResultsRunDetail } from '../server/lib/results';
import { getModelRunOptions } from '../server/lib/modelRuns';
import { getSensitivityExperiment, getSensitivityExperimentResults, getSensitivityExperimentCharts } from '../server/lib/sensitivityRuns';
import { formatKpiComparisonDelta, formatKpiValue, getManualComparisonFieldDifferences, getPolicySettingDifferences } from '../src/lib/manualResultsView';
import { POLICY_RESULTS_DEMO } from '../src/lib/guidedDemos/policyResults';
import { SENSITIVITY_RESULTS_DEMO } from '../src/lib/guidedDemos/sensitivityResults';
import { REPORT2_INDICATOR_IDS, getReport2Kpi, getReport2Points, getReport2PrivateRentingShare, getReport2Volatility } from '../src/pages/report2/report2Model';
import { REPORT2_SUMMARY_KEYS, buildSensitivityReport2, chooseReport2Setting, formatReport2Difference, formatReport2Number, formatReport2Pairing, type Report2Metric } from '../src/pages/sensitivity-report2/sensitivityReport2Model';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-demo-figures-'));
const paths = { ...createDevelopmentRuntimePaths(repoRoot), resultsRoot: path.join(fixture, 'results') };
const ids = DEMO_EXAMPLE_IDS;
const metric = (selected: number | null | undefined, baseline: number | null | undefined) => {
  assert(selected !== null && selected !== undefined && Number.isFinite(selected));
  assert(baseline !== null && baseline !== undefined && Number.isFinite(baseline));
  return { selected, baseline, change: selected - baseline, relativeChange: (selected - baseline) / baseline * 100 };
};
function assertFigures(actual: unknown, expected: unknown, label = 'figures'): void {
  if (typeof actual === 'number' && typeof expected === 'number') {
    assert(Math.abs(actual - expected) < 1e-8, `${label}: actual ${actual}, expected ${expected}`);
    return;
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual), Object.keys(expected), label);
    for (const key of Object.keys(actual)) assertFigures((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], `${label}.${key}`);
    return;
  }
  assert.equal(actual, expected, label);
}

try {
  seedDemoExamples(paths);
  const selected = getResultsRunDetail(paths, ids.policyRunId);
  const baseline = getResultsRunDetail(paths, ids.baselineRunId);
  const compare = getResultsCompare(paths, [selected.runId, baseline.runId], REPORT2_INDICATOR_IDS, 'post500', 0);
  assert.equal(compare.window, 'post500');
  assert.deepEqual(getManualComparisonFieldDifferences(selected, baseline), []);
  assert.deepEqual(getPolicySettingDifferences(selected.policySettings, baseline.policySettings).map((entry) => entry.key), ['CENTRAL_BANK_INITIAL_BASE_RATE']);
  assert.deepEqual(selected.provenance.seeds, baseline.provenance.seeds);
  const series = getReport2Points(compare, selected.runId, 'output_saleAvSalePrice');
  const startMonth = Math.min(...series.map((point) => point.modelTime));
  const scenarioRate = selected.policySettings.find((entry) => entry.key === 'CENTRAL_BANK_INITIAL_BASE_RATE')!.value * 100;
  const baselineRate = baseline.policySettings.find((entry) => entry.key === 'CENTRAL_BANK_INITIAL_BASE_RATE')!.value * 100;
  const sweep = getSensitivityExperiment(paths, ids.sensitivityExperimentId).experiment;
  const sweepModel = buildSensitivityReport2(sweep, getSensitivityExperimentResults(paths, sweep.experimentId), getSensitivityExperimentCharts(paths, sweep.experimentId).windowType);
  const modelOption = getModelRunOptions(paths, selected.configuration.modelVersion!, true).snapshots.find((entry) => entry.version === selected.configuration.modelVersion)!;
  assertFigures({
    modelVersion: selected.configuration.modelVersion,
    evidenceYear: modelOption.evidenceYear,
    basePolicy: selected.configuration.basePolicy,
    seeds: selected.provenance.seeds!.length,
    policyMonths: selected.configuration.parameterValues.N_STEPS,
    sensitivityMonths: sweep.generalOverrides!.N_STEPS,
    analysisStartMonth: startMonth,
    policyBankRate: scenarioRate,
    referenceBankRate: baselineRate,
    policyBankRateRisePp: scenarioRate - baselineRate,
    sensitivitySettings: sweep.sampledPoints.map((point) => point.value)
  }, DEMO_EXAMPLE_FIGURES.configuration, 'configuration');
  const policy: Record<string, ReturnType<typeof metric>> = {};
  for (const [key, indicator] of Object.entries({ housePrice: 'output_saleAvSalePrice', debtToIncome: 'core_debtToIncome', approvals: 'core_mortgageApprovals', transactions: 'core_housingTransactions', firstTimeBuyers: 'core_advancesToFTB', homeMovers: 'core_advancesToHM', buyToLet: 'core_advancesToBTL', ownership: 'output_ownershipRate', rentalYield: 'core_rentalYield' })) {
    policy[key] = metric(getReport2Kpi(compare, selected.runId, indicator)?.mean, getReport2Kpi(compare, baseline.runId, indicator)?.mean);
  }
  policy.privateRenting = metric(getReport2PrivateRentingShare(compare, selected.runId, selected), getReport2PrivateRentingShare(compare, baseline.runId, baseline));
  policy.priceGrowthVolatility = metric(getReport2Volatility(getReport2Points(compare, selected.runId, 'core_housePriceGrowth')), getReport2Volatility(getReport2Points(compare, baseline.runId, 'core_housePriceGrowth')));
  assertFigures(policy, DEMO_EXAMPLE_FIGURES.policy, 'policy');
  const lesson = (id: string) => {
    const step = POLICY_RESULTS_DEMO.steps.find((entry) => entry.id === id)!;
    return [...(step.bullets ?? []), ...(step.completionBullets ?? [])].join(' ');
  };
  for (const [id, key, units] of [
    ['headline', 'housePrice', 'GBP'], ['market', 'approvals', 'count/month'],
    ['market', 'transactions', 'count/month'], ['borrowers', 'buyToLet', 'count/month'],
    ['borrowers', 'homeMovers', 'count/month']
  ]) {
    const result = policy[key];
    const displayedChange = formatKpiComparisonDelta(result.selected, result.baseline, units);
    const percent = displayedChange.match(/\(([+-]?)([\d,.]+%)\)$/)?.[2];
    assert.ok(percent, `${key} has a percentage change in the report`);
    assert.ok(lesson(id).includes(percent), `${key} demo must match the report's ${displayedChange}`);
  }
  for (const key of ['ownership', 'privateRenting']) {
    const result = policy[key];
    const selectedShare = formatKpiValue(result.selected, '%');
    assert.ok(lesson('tenure').includes(selectedShare), `${key} demo quotes the selected run's displayed household share ${selectedShare}`);
    const points = formatKpiComparisonDelta(result.selected, result.baseline, '%').replace(/^[+-]/, '').replace(' pp', ' percentage points');
    assert.ok(lesson('tenure').includes(points), `${key} demo must match the report's ${points}`);
  }
  for (const [id, key, units] of [['headline', 'housePrice', 'GBP'], ['borrowers', 'firstTimeBuyers', 'count/month']]) {
    assert.ok(lesson(id).includes(formatKpiValue(policy[key].selected, units)), `${key} selected value matches the report`);
    assert.ok(lesson(id).includes(formatKpiValue(policy[key].baseline, units)), `${key} baseline value matches the report`);
  }
  assert.equal(selected.configuration.parameterValues.recordTransactions, false);
  assert.equal(baseline.configuration.parameterValues.recordTransactions, false);

  const paired = (value: Report2Metric) => ({
    selected: value.value, baseline: value.baselineValue, change: value.change, relativeChange: value.relativeChange,
    higher: value.paired?.higher ?? 0, lower: value.paired?.lower ?? 0, total: value.paired?.total ?? 0,
    min: value.paired?.min ?? 0, max: value.paired?.max ?? 0
  });
  assert(sweepModel.complete);
  assertFigures({
    successfulSeeds: sweepModel.successfulSeeds,
    expectedSeeds: sweepModel.expectedSeeds,
    initialSettingId: chooseReport2Setting(sweepModel)?.point.pointId,
    rows: sweepModel.rows.map((row) => ({
      settingId: row.point.pointId, value: row.point.value, approvals: paired(row.metrics.core_mortgageApprovals),
      debtToIncome: paired(row.metrics.core_debtToIncome), priceToIncome: paired(row.metrics.core_priceToIncome),
      firstTimeBuyers: paired(row.metrics.core_advancesToFTB)
    }))
  }, DEMO_EXAMPLE_FIGURES.sensitivity, 'sensitivity');
  assert(sweepModel.rows.every((row) => Math.abs(row.metrics.core_mortgageApprovals.relativeChange!) < 1));
  const sensitivityLesson = (id: string, completed = false) => {
    const step = SENSITIVITY_RESULTS_DEMO.steps.find((entry) => entry.id === id)!;
    return (completed ? step.completionBullets : step.bullets)!.join(' ');
  };
  const tested = sweepModel.numericRows;
  const tight = chooseReport2Setting(sweepModel)!;
  const loose = tested[tested.length - 1];
  const seeds = sweep.seeds!.length;
  const debtOutcome = sweepModel.outcomes.find((outcome) => outcome.key === 'core_debtToIncome')!;
  // The Report's exact precision and native units, written out as the walkthrough does.
  const points = (value: number | null) => formatReport2Difference(value, debtOutcome).replace(/^[+−-]/, '').replace(' pp', ' percentage points');
  const agreeing = (metric: Report2Metric) => Math.max(metric.paired!.higher, metric.paired!.lower);
  const across = (key: string) => tested.map((row) => row.metrics[key].value!);
  const rising = (values: number[]) => values.every((value, index) => index === 0 || value > values[index - 1]);
  const steady = (values: number[]) => rising(values) || rising([...values].reverse());
  const directions = (key: string) => new Set(tested.filter((row) => !row.point.isBaseline).map((row) => Math.sign(row.metrics[key].change!)));
  assert.equal(sweep.basePolicy, DEMO_EXAMPLE_FIGURES.configuration.basePolicy);
  assert.equal(sweep.parameter.baselineValue, sweepModel.baselineRow!.point.value, 'The baseline is the base policy’s own threshold');
  assert.ok(sensitivityLesson('baseline').includes(sweepModel.baselineRow!.setting), 'The baseline quote matches the actual simulated baseline and its displayed unit');
  assert.ok(sensitivityLesson('baseline').includes(`from ${formatReport2Number(tight.x)}× to ${formatReport2Number(loose.x)}× income`));
  assert.equal(sweepModel.successfulSeeds, sweepModel.expectedSeeds);
  assert.ok(sensitivityLesson('baseline').includes(`all ${sweepModel.successfulSeeds} seed runs completed`));
  assert.ok(sensitivityLesson('response').includes(`averages ${seeds} seeds`));
  for (const row of sweepModel.rows) assert.equal(row.metrics.core_mortgageApprovals.finiteSeeds, seeds, 'The curve really has every quoted finite seed at each setting');
  assert(rising(across('core_debtToIncome')), 'Debt to income rises at every tested step');

  const tightDebt = tight.metrics.core_debtToIncome;
  assert.equal(tightDebt.paired!.total, seeds);
  assert.equal(tightDebt.paired!.lower, seeds, 'Every seed agrees at the tightest setting');
  assert.ok(sensitivityLesson('pairing').includes(`lower in all ${seeds} seeds, by ${formatReport2Number(Math.abs(tightDebt.paired!.max!))} to ${points(tightDebt.paired!.min)}`), 'The pairing lesson quotes the panel’s min–max range');

  const setting = SENSITIVITY_RESULTS_DEMO.steps.find((step) => step.id === 'setting')!;
  const looseDebt = loose.metrics.core_debtToIncome;
  assert.ok(setting.actionHint?.includes(`${formatReport2Number(loose.x)}×`));
  assert.deepEqual(setting.completion, { kind: 'query', key: 'setting', value: loose.point.pointId });
  assert(looseDebt.change! > 0 && agreeing(looseDebt) === looseDebt.paired!.higher && agreeing(looseDebt) >= seeds - 1, 'Nearly all seeds agree on the opposite direction');
  assert.ok(sensitivityLesson('setting', true).includes(`At ${formatReport2Number(loose.x)}×, mortgage debt to income is ${points(looseDebt.change)} higher, in ${looseDebt.paired!.higher} of ${seeds} matched seeds`));

  const looseApprovals = loose.metrics.core_mortgageApprovals;
  assert(looseApprovals.change! > 0 && agreeing(looseApprovals) <= seeds - 3, 'Approvals seeds split at the loosest setting');
  assert.equal(formatReport2Pairing(looseApprovals), `${looseApprovals.paired!.higher} of ${seeds} matched seeds moved higher`);
  assert.ok(sensitivityLesson('outcome', true).includes(`approvals average ${formatReport2Number(looseApprovals.relativeChange)}% higher, but only ${looseApprovals.paired!.higher} of ${seeds} seeds are higher`));
  assert(!steady(across('core_mortgageApprovals')), 'Approvals zigzag across settings');

  assert(agreeing(looseDebt) >= seeds - 1, 'Only debt to income moves consistently in the table');
  for (const key of ['core_mortgageApprovals', 'core_priceToIncome', 'core_advancesToFTB']) {
    assert(agreeing(loose.metrics[key]) <= seeds - 3, `${key} splits across seeds at the loosest setting`);
  }
  assert.deepEqual([...REPORT2_SUMMARY_KEYS].sort(), ['core_advancesToFTB', 'core_debtToIncome', 'core_mortgageApprovals', 'core_priceToIncome'], 'The table lesson names every summary outcome');

  assert.ok(sensitivityLesson('finding').includes(`Tightening to ${formatReport2Number(tight.x)}× lowers mortgage debt to income by ${points(tightDebt.change)}, in every seed`));
  for (const key of ['core_mortgageApprovals', 'core_advancesToFTB']) {
    assert(directions(key).size > 1 && !steady(across(key)), `${key} shows no consistent response across the tested range`);
  }
  assert.ok(sensitivityLesson('finding').includes(`${modelOption.evidenceYear} data`));
  console.log('demo-example-figures: every configuration, policy and sensitivity figure recomputed from bundled examples passed.');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
