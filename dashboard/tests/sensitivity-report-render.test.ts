import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SensitivityReportView } from '../src/pages/experiments/view/sensitivity-report/SensitivityReportView';
import { REPORT_INDICATORS } from '../src/pages/experiments/view/sensitivity-report/reportModel';
import type {
  SensitivityExperimentMetadata,
  SensitivityExperimentResultsPayload,
  SensitivityIndicatorPointMetric,
  SensitivitySamplePoint
} from '../shared/types';

// Render the real component directly; stylesheet loading belongs to the application entry.
{
  const sample = (pointId: string, value: number, isBaseline = false): SensitivitySamplePoint => ({
    pointId, value, isBaseline, label: pointId, slotLabels: []
  });
  const detail: SensitivityExperimentMetadata = {
    experimentId: 'sensitivity-report-render-fixture', title: 'Report rendering fixture', baseline: 'v0o7',
    status: 'succeeded', createdAt: '2026-09-20T12:00:00Z', seeds: [1, 2], seedsPerPoint: 2,
    parameter: {
      key: 'CENTRAL_BANK_INITIAL_BASE_RATE', title: 'Bank Rate', description: '', type: 'number',
      baselineValue: 0.04, min: 0.04, max: 0.05, sampleCount: 2
    },
    sampledPoints: [sample('baseline', 0.04, true), sample('higher', 0.05)],
    warnings: [], warningSummary: { byPoint: {} }, collapsedSlots: {}, runCommand: { commandTemplate: '' }
  };
  const metrics = (baseline: boolean): SensitivityIndicatorPointMetric[] => REPORT_INDICATORS.map((item) => ({
    indicatorId: item.id, title: item.title, units: item.units,
    kpi: { mean: item.id === 'core_debtToIncome' ? baseline ? 200 : 240 : baseline ? 100 : 120,
      cv: 0.1, range: baseline ? 1 : 2, annualisedTrend: null },
    deltaFromBaseline: { mean: baseline ? 0 : 20, cv: null, range: null, annualisedTrend: null }
  }));
  const results: SensitivityExperimentResultsPayload = {
    experimentId: detail.experimentId, baselinePointId: 'baseline',
    points: detail.sampledPoints.map((point) => ({
      ...point, status: 'succeeded', runId: point.pointId, outputPath: null,
      indicatorMetrics: metrics(point.isBaseline),
      seedResults: [1, 2].map((seed) => ({
        seed, status: 'succeeded', runId: `${point.pointId}-${seed}`, outputPath: null,
        indicatorMetrics: metrics(point.isBaseline)
      }))
    }))
  };
  const render = (currentDetail = detail, currentResults = results, windowType: 'post_200' | 'tail_120' = 'post_200') =>
    renderToStaticMarkup(createElement(SensitivityReportView, { detail: currentDetail, results: currentResults, windowType }));

  const html = render();
  assert.match(html, /Complete/);
  assert.match(html, /2 \/ 2 seeds per setting/);
  assert.match(html, /After first 200 valid observations/);
  assert.match(html, /4%/);
  assert.match(html, /5%/);
  assert.match(html, /240%/, 'Prominent mean is the retained value at the highlighted setting');
  assert.match(html, /Baseline mean: 200%/, 'Comparison identifies the raw baseline debt-to-income level');
  assert.match(html, /Mean at 5%/, 'Each headline identifies its own policy setting');
  assert.match(html, /\+20%/, 'Headline uses the signed relative mean difference');
  assert.equal((html.match(/class="sensitivity-report__chart"/g) ?? []).length, 3);
  assert.equal((html.match(/<select/g) ?? []).length, 0, 'The report needs no setting selection to reveal its conclusions');
  assert.equal((html.match(/<table/g) ?? []).length, 0, 'Full tables stay in Detailed');
  assert.equal((html.match(/<details/g) ?? []).length, 1, 'Method definitions have one compact disclosure');
  assert.doesNotMatch(html, /<details[^>]*\sopen/, 'Method text is collapsed initially');
  assert.equal((html.match(/What to investigate/g) ?? []).length, 3, 'Each outcome gets a concise investigation cue');
  assert.match(html, /Mortgage approvals/);
  assert.match(html, /Mortgage debt to income/);
  assert.match(html, /House price to income/);
  assert.doesNotMatch(html, /All 15 indicators|Mean Above Median|Temporal spread/);
  assert.match(html, /Seed uncertainty is not shown/);

  const activeHtml = render({ ...detail, status: 'running' });
  assert.match(activeHtml, /available when this analysis finishes/);
  assert.doesNotMatch(activeHtml, /class="sensitivity-report__chart"|Largest difference/, 'Active experiments cannot present premature conclusions');

  const partial = structuredClone(results);
  partial.points[1].seedResults!.pop();
  const partialHtml = render({ ...detail, status: 'failed' }, partial);
  assert.match(partialHtml, /Incomplete results/);
  assert.match(partialHtml, /3 \/ 4 seeds succeeded/);
  assert.doesNotMatch(partialHtml, /class="sensitivity-report__chart"/, 'A baseline alone is not a tested response');

  const missing = structuredClone(results);
  missing.points[1].seedResults![1].indicatorMetrics[0].kpi.mean = null;
  const missingHtml = render(detail, missing);
  assert.match(missingHtml, /Some outcome means are missing/);
  assert.equal((missingHtml.match(/class="sensitivity-report__chart"/g) ?? []).length, 2);

  const legacy = structuredClone(results);
  for (const point of legacy.points) delete point.seedResults;
  const legacyHtml = render(detail, legacy, 'tail_120');
  assert.match(legacyHtml, /Seed coverage unverified/);
  assert.match(legacyHtml, /Last up to 120 observations/);
  assert.match(legacyHtml, /aggregation across seeds cannot be verified/);
  assert.equal((legacyHtml.match(/class="sensitivity-report__chart"/g) ?? []).length, 3);

  const nearZero = structuredClone(results);
  for (const point of nearZero.points) {
    for (const metric of point.indicatorMetrics) metric.deltaFromBaseline.mean = null;
  }
  const nearZeroHtml = render(detail, nearZero);
  assert.equal((nearZeroHtml.match(/class="sensitivity-report__chart"/g) ?? []).length, 3, 'Unavailable percentages do not hide raw-value charts');
  assert.match(nearZeroHtml, /\+40 pp/, 'Raw differences use percentage points for percent-valued metrics');
  assert.match(nearZeroHtml, /Raw means shown; a relative comparison is unavailable/);

  const noBaselineHtml = render(detail, { ...results, baselinePointId: null });
  assert.match(noBaselineHtml, /Mean at 5%/, 'Raw tested means remain visible without an eligible baseline');
  assert.match(noBaselineHtml, /Baseline mean: Unavailable/);
  assert.doesNotMatch(noBaselineHtml, /\+20%/, 'Missing baselines cannot produce comparisons');

  const unsafeHtml = render({ ...detail, parameter: { ...detail.parameter, title: '<script>unsafe</script>' } });
  assert.match(unsafeHtml, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.doesNotMatch(unsafeHtml, /<script>unsafe/);

  console.log('Sensitivity report rendering checks passed.');
}
