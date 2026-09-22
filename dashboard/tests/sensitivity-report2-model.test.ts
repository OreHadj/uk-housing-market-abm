import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  SensitivityExperimentChartsPayload,
  SensitivityExperimentMetadata,
  SensitivityExperimentResultsPayload,
  SensitivityIndicatorPointMetric,
  SensitivityPointResult,
  SensitivitySamplePoint
} from '../shared/types';
import {
  REPORT2_OUTCOMES,
  analyseReport2Outcome,
  buildReport2Observations,
  buildSensitivityReport2,
  chooseReport2Setting,
  formatReport2Difference,
  formatReport2Pairing,
  formatReport2Value
} from '../src/pages/sensitivity-report2/sensitivityReport2Model';

const approvals = 'core_mortgageApprovals';
const debt = 'core_debtToIncome';
const ftb = 'core_advancesToFTB';
const growth = 'core_housePriceGrowth';

function metric(id: string, mean: number | null, range: number | null = 5): SensitivityIndicatorPointMetric {
  const definition = REPORT2_OUTCOMES.find((outcome) => outcome.id === id)!;
  return { indicatorId: id, title: definition.title, units: definition.units,
    kpi: { mean, range, cv: 0.2, annualisedTrend: null },
    // Deliberately not calculated from per-seed values. New comparisons must use retained KPIs.
    deltaFromBaseline: { mean: 98765, range: 98765, cv: null, annualisedTrend: null } };
}

function result(point: SensitivitySamplePoint, means: Array<number | null>): SensitivityPointResult {
  const present = means.filter((value): value is number => value !== null);
  return { ...point, status: 'succeeded', runId: point.pointId, outputPath: null,
    indicatorMetrics: [metric(approvals, present.length ? present.reduce((a, b) => a + b, 0) / present.length : null)],
    seedResults: means.map((value, index) => ({ seed: 11 + index, status: 'succeeded', runId: `${point.pointId}-${index}`,
      outputPath: null, indicatorMetrics: [metric(approvals, value)] })) };
}

function fixture(values = [0.01, 0.02, 0.05, 0.1], means = [100, 102, 105, 109], baselineIndex = 1) {
  const points = values.map((value, index): SensitivitySamplePoint => ({
    pointId: `p${index}`, value, label: `p${index}`, slotLabels: [], isBaseline: index === baselineIndex
  }));
  const detail: SensitivityExperimentMetadata = {
    experimentId: 'report2-fixture', baseline: 'v0o7', status: 'succeeded', createdAt: '2026-09-21',
    seeds: [11, 12], seedsPerPoint: 2, parameter: {
      key: 'CENTRAL_BANK_INITIAL_BASE_RATE', title: 'Bank rate', description: '', type: 'number',
      baselineValue: values[baselineIndex], min: values[0], max: values[values.length - 1], sampleCount: values.length
    }, sampledPoints: points, warnings: [], warningSummary: { byPoint: {} }, collapsedSlots: {}, runCommand: { commandTemplate: '' }
  };
  const results: SensitivityExperimentResultsPayload = {
    experimentId: detail.experimentId, baselinePointId: points[baselineIndex].pointId,
    points: points.map((point, index) => result(point, [means[index] - 1, means[index] + 1]))
  };
  return { detail, results };
}

function addMetric(point: SensitivityPointResult, id: string, means: Array<number | null>, ranges = means.map(() => 5)) {
  const finite = means.filter((value): value is number => value !== null);
  point.indicatorMetrics.push(metric(id, finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null,
    ranges.reduce((a, b) => a + b, 0) / ranges.length));
  point.seedResults!.forEach((seed, index) => seed.indicatorMetrics.push(metric(id, means[index], ranges[index])));
}

{
  const { detail, results } = fixture();
  const original = JSON.stringify({ detail, results });
  const model = buildSensitivityReport2(detail, results, 'post_200');
  assert.equal(model.complete, true);
  assert.equal(model.expectedSeeds, 8);
  assert.equal(model.successfulSeeds, 8);
  assert.equal(model.windowLabel, 'After first 200 valid observations');
  assert.deepEqual(model.numericRows.map((row) => row.x), [1, 2, 5, 10]);
  assert.equal(model.axis.stepUnit, '1 pp of policy setting');
  const analysis = analyseReport2Outcome(model, approvals);
  assert.deepEqual(analysis.intervals.map((interval) => interval.slope), [2, 1, 0.8]);
  assert.equal(analysis.largestIntervals[0].from.point.pointId, 'p0', 'Largest native change is not largest response per actual policy distance');
  assert.equal(analysis.largestIntervals[0].slopeUnits, 'count/month per 1 pp of policy setting');
  assert.equal(analysis.diminishing.length, 2);
  assert.equal(analysis.boundaryRows[0].point.pointId, 'p3');
  assert.equal(model.rows[2].metrics[approvals].change, 3);
  assert.equal(model.rows[2].metrics[approvals].relativeChange, 100 * 3 / 102);
  assert.equal(chooseReport2Setting(model)?.point.pointId, 'p0');
  assert.equal(chooseReport2Setting(model, 'p3')?.point.pointId, 'p3');
  assert.equal(JSON.stringify({ detail, results }), original, 'No payload mutation');
  const observations = buildReport2Observations(model, approvals);
  assert.deepEqual(observations.map((observation) => observation.kind), ['interval', 'diminishing', 'boundary']);
  assert.match(observations[0].text, /1% to 2%/);
  assert.match(observations[0].text, /2\/2 and 2\/2 valid planned seeds/);
}

for (const state of ['missing', 'failed', 'canceled', 'partial', 'metric-missing', 'unexpected-seed', 'duplicate-seed'] as const) {
  const { detail, results } = fixture();
  const second = results.points[1];
  if (state === 'missing') results.points.splice(1, 1);
  else if (state === 'failed' || state === 'canceled') second.status = state;
  else if (state === 'partial') second.seedResults!.pop();
  else if (state === 'metric-missing') second.seedResults![0].indicatorMetrics[0].kpi.mean = null;
  else if (state === 'unexpected-seed') second.seedResults![0].seed = 99;
  else second.seedResults![0].seed = 12;
  const model = buildSensitivityReport2(detail, results, 'post_200');
  const analysis = analyseReport2Outcome(model, approvals);
  assert.deepEqual(analysis.intervals.map((interval) => [interval.from.point.pointId, interval.to.point.pointId]), [['p2', 'p3']], state);
  assert.equal(model.rows[1].metrics[approvals].eligible, false, state);
  assert.equal(model.rows[1].coverage.state, state === 'metric-missing' ? 'complete' :
    state === 'unexpected-seed' || state === 'duplicate-seed' ? 'partial' : state, state);
  if (state === 'missing') assert.equal(model.rows[1].metrics[approvals].value, null);
}

{
  const { detail, results } = fixture();
  delete detail.seeds;
  delete detail.seedsPerPoint;
  results.points.forEach((point) => { delete point.seedResults; });
  const model = buildSensitivityReport2(detail, results, 'tail_120');
  assert.equal(model.windowLabel, 'Last up to 120 observations');
  assert.equal(model.rows[0].coverage.state, 'legacy');
  assert.equal(model.rows[0].metrics[approvals].value, 100);
  assert.equal(model.rows[0].metrics[approvals].eligible, false);
  assert.equal(model.rows[0].metrics[approvals].paired, null);
  assert.equal(analyseReport2Outcome(model, approvals).intervals.length, 0, 'Legacy aggregates do not compete with complete observations');
  assert.equal(buildReport2Observations(model, approvals).length, 0);
}

{
  const { detail, results } = fixture();
  detail.seedsPerPoint = 3;
  const model = buildSensitivityReport2(detail, results, null);
  assert.equal(model.rows[0].coverage.state, 'partial', 'Conflicting expected count and IDs cannot establish complete coverage');
  assert.equal(model.rows[0].coverage.expected, 3, 'Do not hide the larger planned count when metadata conflicts');
  assert.equal(model.windowLabel, 'Not recorded');
  detail.seedsPerPoint = 2;
  detail.seeds = [11, 11];
  assert.equal(buildSensitivityReport2(detail, results, null).rows[0].coverage.state, 'partial');
}

{
  const { detail, results } = fixture([0.01, 0.02], [110, 100], 1);
  results.points[0] = result(detail.sampledPoints[0], [50, 170]);
  results.points[1] = result(detail.sampledPoints[1], [10, 190]);
  results.points[0].seedResults!.reverse();
  const model = buildSensitivityReport2(detail, results, 'post_200');
  const current = model.rows[0].metrics[approvals];
  assert.equal(current.change, 10);
  assert.equal(current.relativeChange, 10, 'Change of aggregate means, not mean of per-seed percentages (194.7%)');
  assert.deepEqual(current.paired, { total: 2, higher: 1, lower: 1, equal: 0, min: -20, max: 40,
    differences: [{ seed: 11, difference: 40 }, { seed: 12, difference: -20 }] });
  assert.equal(formatReport2Pairing(current), '1 of 2 matched seeds moved higher');
  results.points[0].seedResults![0].status = 'failed';
  const single = buildSensitivityReport2(detail, results, 'post_200').rows[0].metrics[approvals];
  assert.equal(single.paired?.total, 1);
  assert.match(formatReport2Pairing(single), /variation across seeds cannot be assessed/);
}

for (const reference of [0, -5, 0.01]) {
  const { detail, results } = fixture([0.01, 0.02], [1, reference], 1);
  const model = buildSensitivityReport2(detail, results, 'post_200');
  assert.equal(model.rows[0].metrics[approvals].change, 1 - reference);
  assert.equal(model.rows[0].metrics[approvals].relativeChange, null, `Unsuitable ${reference} baseline percent omitted`);
}

{
  const { detail, results } = fixture();
  results.points[0].indicatorMetrics[0].deltaFromBaseline.mean = null;
  assert.equal(buildSensitivityReport2(detail, results, 'post_200').rows[0].metrics[approvals].relativeChange, null,
    'Persisted comparison suppression must survive even a positive baseline');
  results.baselinePointId = null;
  const model = buildSensitivityReport2(detail, results, 'post_200');
  assert.equal(model.rows[0].metrics[approvals].baselineValue, null);
  assert.equal(model.rows[0].metrics[approvals].change, null);
  assert.equal(model.rows[0].metrics[approvals].paired, null);
  results.experimentId = 'stale';
  assert.ok(buildSensitivityReport2(detail, results, null).rows.every((row) => row.coverage.state === 'missing'));
}

{
  const { detail, results } = fixture([0.01, 0.02, 0.03], [100, 102, 100], 1);
  const model = buildSensitivityReport2(detail, results, 'post_200');
  const analysis = analyseReport2Outcome(model, approvals);
  assert.equal(analysis.largestIntervals.length, 2, 'Tied magnitudes retain both signed intervals');
  assert.equal(analysis.reversals.length, 1);
  assert.equal(analysis.boundaryRows.length, 2);
  const observations = buildReport2Observations(model, approvals);
  assert.match(observations[0].title, /tied/);
  assert.ok(observations.some((observation) => observation.kind === 'reversal'));
  results.points[1].seedResults!.pop();
  const incomplete = buildSensitivityReport2(detail, results, 'post_200');
  assert.equal(analyseReport2Outcome(incomplete, approvals).reversals.length, 0);
  assert.equal(buildReport2Observations(incomplete, approvals)[0].kind, 'coverage');
}

{
  const { detail, results } = fixture([0.85, 0.95], [100, 110], 1);
  detail.parameter = { ...detail.parameter, key: 'package', packageId: 'package',
    parameterKeys: ['CENTRAL_BANK_LTV_HARD_MAX_FTB', 'CENTRAL_BANK_LTV_HARD_MAX_HM'],
    baselineValue: null, baselineValuesByKey: { CENTRAL_BANK_LTV_HARD_MAX_FTB: 0.95, CENTRAL_BANK_LTV_HARD_MAX_HM: 0.9 } };
  detail.sampledPoints[1].value = null;
  results.points[1].value = null;
  const model = buildSensitivityReport2(detail, results, 'post_200');
  assert.equal(model.baselineRow?.x, null);
  assert.equal(model.numericRows.length, 1);
  assert.match(model.baselineRow!.setting, /95%/);
  assert.match(model.baselineRow!.setting, /90%/);
  assert.equal(model.rows[0].metrics[approvals].baselineValue, 110);
  assert.equal(model.rows[0].metrics[approvals].change, -10);
  assert.equal(analyseReport2Outcome(model, approvals).intervals.length, 0);
}

{
  const { detail, results } = fixture([0.01, 0.02, 0.03], [100, 100, 100]);
  detail.warnings = [{ code: 'central_bank_upper_limit_non_binding', severity: 'warning', message: 'CENTRAL_BANK_LTV_HARD_MAX_FTB=0.95 is not stricter than BANK_LTV_HARD_MAX_FTB=0.9' }];
  detail.warningSummary.byPoint = { p0: ['central_bank_upper_limit_non_binding', 'central_bank_upper_limit_non_binding'],
    p1: ['central_bank_upper_limit_non_binding'] };
  const model = buildSensitivityReport2(detail, results, 'post_200');
  assert.equal(model.warnings.length, 1);
  assert.deepEqual(model.warnings[0].settings, ['1%', '2%']);
  assert.equal(buildReport2Observations(model, approvals)[0].kind, 'warning');
  assert.match(buildReport2Observations(model, approvals)[0].text, /bank LTV caps of 90%\./,
    'Central-bank settings must not be parsed as the private-bank cap');
  detail.warnings = [];
  detail.warningSummary.byPoint = {};
  assert.equal(buildReport2Observations(buildSensitivityReport2(detail, results, 'post_200'), approvals).length, 0,
    'Flat outcomes without warning do not manufacture advice or no-effect claims');
}

{
  const { detail, results } = fixture([0.01, 0.02], [100, 110], 1);
  addMetric(results.points[0], debt, [180, 200]);
  addMetric(results.points[1], debt, [200, 220]);
  addMetric(results.points[0], ftb, [10, 20]);
  addMetric(results.points[1], ftb, [20, 30]);
  addMetric(results.points[0], growth, [0.001, -0.001], [4, 6]);
  addMetric(results.points[1], growth, [0, 0], [8, 10]);
  const model = buildSensitivityReport2(detail, results, 'post_200');
  const observations = buildReport2Observations(model, approvals, 'p0');
  const tradeoff = observations.find((observation) => observation.kind === 'tradeoff');
  assert.ok(tradeoff);
  assert.match(tradeoff.text, /-20 pp/);
  assert.match(tradeoff.text, /-10 \/ month/);
  assert.deepEqual(tradeoff.pointIds, ['p0', 'p1']);
  const rangeOutcome = model.outcomes.find((outcome) => outcome.key === `${growth}:range`)!;
  const range = model.rows[0].metrics[rangeOutcome.key];
  assert.equal(range.value, 5, 'Mean of retained per-seed temporal ranges');
  assert.equal(range.change, -4);
  assert.equal(range.relativeChange, -100 * 4 / 9, 'Range comparison independent of near-zero growth mean');
  assert.equal(formatReport2Value(range.value, rangeOutcome), '5 pp');
  assert.equal(formatReport2Difference(range.change, rangeOutcome), '-4 pp');
  assert.match(rangeOutcome.title, /temporal P95–P5 range/);
  assert.match(REPORT2_OUTCOMES.find((outcome) => outcome.key === 'core_ooLTV')!.title, /Mean Above Median/);
}

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const realIds = ['sensitivity-20260701T171506Z-8f1fded4', 'sensitivity-20260820T141915Z-85147433',
  'sensitivity-20260919T123021Z-9de0cb69', 'sensitivity-20260919T124055Z-1405820a'];
let checkedSaved = 0;
for (const experimentId of realIds) {
  const directory = path.join(repository, 'Results/experiments/sensitivity', experimentId);
  if (!fs.existsSync(path.join(directory, 'summary.json'))) continue;
  const detail = JSON.parse(fs.readFileSync(path.join(directory, 'metadata.json'), 'utf8')) as SensitivityExperimentMetadata;
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'summary.json'), 'utf8')) as {
    results: SensitivityExperimentResultsPayload; charts: SensitivityExperimentChartsPayload
  };
  const model = buildSensitivityReport2(detail, saved.results, saved.charts.windowType);
  assert.equal(model.rows.length, detail.sampledPoints.length);
  assert.equal(model.numericRows.length, new Set(detail.sampledPoints.filter((point) => point.value !== null).map((point) => point.value)).size);
  for (const row of model.rows) {
    const actual = saved.results.points.find((point) => point.pointId === row.point.pointId)!;
    const retained = actual.indicatorMetrics.find((item) => item.indicatorId === approvals)!;
    assert.equal(row.metrics[approvals].value, retained.kpi.mean);
    const baseline = model.baselineRow?.metrics[approvals].value;
    if (baseline !== null && baseline !== undefined) assert.equal(row.metrics[approvals].change, retained.kpi.mean! - baseline);
  }
  if (experimentId.endsWith('9de0cb69')) {
    const low = model.numericRows.find((row) => row.point.value === 4)!;
    assert.ok(Math.abs(low.metrics[approvals].change! - 287.29502856123145) < 1e-9);
    assert.equal(low.metrics[approvals].paired?.higher, 6);
    assert.equal(low.metrics[approvals].paired?.total, 8);
    assert.equal(formatReport2Pairing(low.metrics[ftb]), '3 of 8 matched seeds moved lower', 'Aggregate direction need not match seed majority');
  }
  if (experimentId.endsWith('1405820a')) {
    const warning = buildReport2Observations(model, approvals).find((observation) => observation.kind === 'warning');
    assert.ok(warning);
    assert.match(warning.text, /bank LTV caps of 90%\./);
    assert.equal(model.warnings[0].pointIds.length, 4);
  }
  checkedSaved += 1;
}
console.log(`Sensitivity Report2 model checks passed; verified ${checkedSaved} saved experiments.`);
