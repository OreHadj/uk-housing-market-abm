import assert from 'node:assert/strict';
import type { ResultsCompareIndicator } from '../shared/types';
import { buildManualOverlayOption } from '../src/lib/manualOverlayChartOption';

function payload(units: string, primary: number[], comparison: number[]): ResultsCompareIndicator {
  const points = (values: number[]) => values.map((value, index) => ({ modelTime: 500 + index, value }));
  return {
    indicator: { id: `fixture_${units}`, title: 'Fixture', units, description: '', source: 'output', scaling: 'none' },
    seriesByRun: [
      { runId: 'policy', points: points(primary) },
      { runId: 'baseline', points: points(comparison) }
    ]
  };
}

type Series = { data: Array<number | null>; markLine?: { data: Array<{ yAxis: number }> } };

function read(units: string, primary: number[], comparison: number[]) {
  const option = buildManualOverlayOption(payload(units, primary, comparison), 'policy', 'baseline');
  const series = option.series as Series[];
  const formatter = (option.tooltip as { formatter: (params: unknown) => string }).formatter;
  const tooltip = formatter([
    { axisValueLabel: '500', seriesName: 'Primary run', marker: '', value: series[0].data[0] },
    { axisValueLabel: '500', seriesName: 'Comparison run', marker: '', value: series[1].data[0] }
  ]).replace(/<[^>]+>|&[^;]+;/g, ' ').replace(/\s+/g, ' ');
  return { series, yAxisName: (option.yAxis as { name: string }).name, tooltip };
}

const close = (actual: number | null | undefined, expected: number, label: string) =>
  assert(actual !== null && actual !== undefined && Math.abs(actual - expected) < 1e-9, `${label}: ${actual} vs ${expected}`);

// The mortgage interest rate is stored as a fraction. The trend must show it in percent, as the
// results table does; at two decimals of the raw fraction, 6.39% and 5.39% both read as "0.06"/"0.05".
const rate = read('rate', [0.0639, 0.0641], [0.0539, 0.0541]);
close(rate.series[0].data[0], 6.39, 'Rate points are plotted in percent');
close(rate.series[1].data[1], 5.41, 'Every run is scaled');
close(rate.series[0].markLine?.data[0].yAxis, 6.4, 'The dotted mean is in percent too');
assert.equal(rate.yAxisName, '%', 'The axis names the displayed unit, not "rate"');
assert.match(rate.tooltip, /Primary run: 6\.39% /, 'The tooltip keeps the one-point gap visible');
assert.match(rate.tooltip, /Comparison run: 5\.39% /);
assert.match(rate.tooltip, /Primary run mean: 6\.4%/);

const share = read('%', [55.6, 55.62], [56.1, 56.12]);
close(share.series[0].data[0], 55.6, 'Percentage indicators are not rescaled');
assert.equal(share.yAxisName, '%');
assert.match(share.tooltip, /Primary run: 55\.6% /, 'Percentage tooltips carry their unit');

const price = read('GBP', [161026, 161030], [156467, 156470]);
close(price.series[0].data[0], 161026, 'Other units are not rescaled');
assert.equal(price.yAxisName, 'GBP');
assert.match(price.tooltip, /Primary run: £161,026 /);

console.log('manual-overlay-chart: all checks passed');
