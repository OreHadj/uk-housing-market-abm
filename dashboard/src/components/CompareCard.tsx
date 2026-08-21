import { useMemo, useState } from 'react';
import type { CompareResult, DatasetAttribution, ScalarDatum } from '../../shared/types';
import { EChart } from './EChart';
import { getAxisSpec } from '../lib/chartAxes';
import { jointHeatmapOption, resolveAdaptiveHeatmapLayout } from '../lib/jointHeatmapOption';
import {
  binnedOption,
  binnedSingleOption,
  curveOption,
  curveSingleOption,
  formatChartNumber,
  jointLayoutOverrides
} from '../lib/compareChartOptions';

interface CompareCardProps {
  item: CompareResult;
  mode: 'single' | 'compare';
  inProgressVersions: string[];
  defaultExpanded?: boolean;
  presentation?: 'card' | 'visualization';
}

const formatNumber = formatChartNumber;
const BUY_QUAD_CURVE_LAYOUT_OVERRIDES = { gridLeft: 108, gridRight: 30, yAxisNameGap: 76 };

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return 'n/a';
  }
  return `${value.toFixed(2)}%`;
}

function formatProbability(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatProbabilityDelta(value: number): string {
  const percentagePoints = value * 100;
  const sign = percentagePoints >= 0 ? '+' : '';
  return `${sign}${percentagePoints.toFixed(2)} pp`;
}

function deltaClassName(value: number): string {
  if (Math.abs(value) < 1e-12) {
    return 'neutral';
  }
  return value > 0 ? 'positive' : 'negative';
}

function validationStatusLabel(status: string): string {
  return status === 'in_progress' ? 'In progress' : 'Complete';
}

function withInProgressLabel(version: string, inProgressVersions: Set<string>): string {
  return inProgressVersions.has(version) ? `${version} (In progress)` : version;
}

function formatDatasetAttribution(dataset: DatasetAttribution): string {
  const parts = [`Year: ${dataset.year}`];
  if (dataset.edition) {
    parts.push(`Edition: ${dataset.edition}`);
  }
  return `${dataset.fullName} (${parts.join(', ')})`;
}

function isWithinDomain(value: number, domain: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= domain.min && value <= domain.max;
}

function buildSingleMedianLegendMarkers(
  value: number,
  domain?: { min: number; max: number }
): Array<{ x: number; name: string; color: string }> {
  const shouldRender = domain ? isWithinDomain(value, domain) : Number.isFinite(value);
  return shouldRender
    ? [
        {
          x: value,
          name: 'Median',
          color: '#495057'
        }
      ]
    : [];
}

function buildCompareMedianLegendMarkers(
  leftValue: number,
  rightValue: number,
  leftLabel: string,
  rightLabel: string,
  domain?: { min: number; max: number }
): Array<{ x: number; name: string; color: string }> {
  const markers: Array<{ x: number; name: string; color: string }> = [];

  if (domain ? isWithinDomain(leftValue, domain) : Number.isFinite(leftValue)) {
    markers.push({
      x: leftValue,
      name: `${leftLabel} median`,
      color: '#0b7285'
    });
  }

  if (domain ? isWithinDomain(rightValue, domain) : Number.isFinite(rightValue)) {
    markers.push({
      x: rightValue,
      name: `${rightLabel} median`,
      color: '#18958b'
    });
  }

  return markers;
}

function renderScalarTable(values: ScalarDatum[], mode: 'single' | 'compare') {
  if (mode === 'single') {
    return (
      <table className="param-table">
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {values.map((row) => (
            <tr key={row.key}>
              <td>{row.key}</td>
              <td>{formatNumber(row.right)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <table className="param-table">
      <thead>
        <tr>
          <th>Parameter</th>
          <th>Left</th>
          <th>Right</th>
          <th>Delta</th>
          <th>Delta %</th>
        </tr>
      </thead>
      <tbody>
        {values.map((row) => (
          <tr key={row.key}>
            <td>{row.key}</td>
            <td>{formatNumber(row.left)}</td>
            <td>{formatNumber(row.right)}</td>
            <td className={deltaClassName(row.delta.absolute)}>{formatNumber(row.delta.absolute)}</td>
            <td className={deltaClassName(row.delta.absolute)}>{formatPercent(row.delta.percent)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function itemIsUpdated(item: CompareResult, mode: 'single' | 'compare'): boolean {
  return mode === 'single' ? item.changeOriginsInRange.length > 0 : !item.unchanged;
}

function buildAdaptiveHeatmapLayout(
  context: 'compare' | 'single' | 'preview',
  item: CompareResult,
  axisSpec: ReturnType<typeof getAxisSpec>,
  xLabels: string[],
  yLabels: string[]
) {
  const baseLayout = jointLayoutOverrides(item.id);
  return resolveAdaptiveHeatmapLayout({
    context,
    xLabels,
    yLabels,
    xAxisName: axisSpec.joint.xTitle,
    yAxisName: axisSpec.joint.yTitle,
    layout: baseLayout
  });
}

export function CompareCard({ item, mode, inProgressVersions, defaultExpanded = false, presentation = 'card' }: CompareCardProps) {
  const visualizationOnly = presentation === 'visualization';
  const [isExpanded, setIsExpanded] = useState<boolean>(visualizationOnly || defaultExpanded);
  const [isTableOpen, setIsTableOpen] = useState<boolean>(false);
  const [isMoreInfoOpen, setIsMoreInfoOpen] = useState<boolean>(false);

  const updated = itemIsUpdated(item, mode);
  const inProgressVersionSet = useMemo(() => new Set(inProgressVersions), [inProgressVersions]);
  const leftVersionLabel = useMemo(
    () => withInProgressLabel(item.leftVersion, inProgressVersionSet),
    [item.leftVersion, inProgressVersionSet]
  );
  const rightVersionLabel = useMemo(
    () => withInProgressLabel(item.rightVersion, inProgressVersionSet),
    [item.rightVersion, inProgressVersionSet]
  );
  const hasInProgressOrigin = useMemo(
    () => item.changeOriginsInRange.some((origin) => origin.validationStatus === 'in_progress'),
    [item.changeOriginsInRange]
  );
  const axisSpec = useMemo(() => getAxisSpec(item.id), [item.id]);

  const jointRanges = useMemo(() => {
    if (item.visualPayload.type !== 'joint_distribution') {
      return null;
    }

    const leftValues = item.visualPayload.matrix.left.map((cell) => cell.value);
    const rightValues = item.visualPayload.matrix.right.map((cell) => cell.value);
    const deltaValues = item.visualPayload.matrix.delta.map((cell) => cell.value);

    const sharedMin = Math.min(...leftValues, ...rightValues);
    const sharedMax = Math.max(...leftValues, ...rightValues);
    const deltaAbs = Math.max(...deltaValues.map((value) => Math.abs(value)), 0);

    return {
      sharedMin,
      sharedMax,
      deltaMin: -deltaAbs,
      deltaMax: deltaAbs
    };
  }, [item]);

  const tableRows = useMemo(() => {
    if (item.visualPayload.type === 'scalar') {
      return item.visualPayload.values;
    }
    if (item.visualPayload.type === 'binned_distribution') {
      return item.visualPayload.bins.map((bin) => ({
        key: bin.label,
        left: bin.left,
        right: bin.right,
        delta: {
          absolute: bin.delta,
          percent: Math.abs(bin.left) < 1e-12 ? null : (bin.delta / bin.left) * 100
        }
      }));
    }
    if (
      item.visualPayload.type === 'lognormal_pair' ||
      item.visualPayload.type === 'power_law_pair' ||
      item.visualPayload.type === 'gaussian_pair' ||
      item.visualPayload.type === 'hpa_expectation_line' ||
      item.visualPayload.type === 'buy_quad'
    ) {
      return item.visualPayload.parameters;
    }
    return [];
  }, [item]);

  return (
    <article className="compare-card">
      {!visualizationOnly && <header className="compare-card-header">
        <button type="button" className="card-toggle" onClick={() => setIsExpanded((current) => !current)}>
          <span className="card-toggle-indicator">{isExpanded ? '▾' : '▸'}</span>
          <span>
            <p className="group-chip">{item.group}</p>
            <h3>{item.title}</h3>
          </span>
        </button>
        {mode === 'compare' && <div className="card-status-pills">
          {hasInProgressOrigin && <span className="status-pill-in-progress">In progress</span>}
          <span className={`change-pill ${updated ? 'updated' : 'neutral'}`}>{updated ? 'Updated' : 'No change'}</span>
        </div>}
      </header>}

      {isExpanded && (
        <>
          {/*
            Scalar cards hold one to three numbers. A bar chart of three scalars encodes nothing the
            table does not, with fewer significant figures — and it forced mixed units onto a single
            linear axis (e.g. 0.0565, 704.94 and 5.47e-7 under "Value (mixed units)"). The values are
            now the content, shown directly rather than behind a toggle.
          */}
          {item.visualPayload.type === 'scalar' && (
            <div className="card-section">{renderScalarTable(tableRows, mode)}</div>
          )}

          {(item.visualPayload.type === 'binned_distribution' ||
            item.visualPayload.type === 'lognormal_pair' ||
            item.visualPayload.type === 'power_law_pair' ||
            item.visualPayload.type === 'gaussian_pair' ||
            item.visualPayload.type === 'hpa_expectation_line' ||
            item.visualPayload.type === 'buy_quad') && (
            <div className="card-section">
              <button type="button" className="table-toggle" onClick={() => setIsTableOpen((current) => !current)}>
                {isTableOpen ? 'Hide exact parameter values' : 'Exact parameter values'}
              </button>
              {isTableOpen && renderScalarTable(tableRows, mode)}
            </div>
          )}

          {item.visualPayload.type === 'binned_distribution' && (
            <div className="card-section">
              <EChart
                option={
                  mode === 'single'
                    ? binnedSingleOption(item, axisSpec.binned.xTitle, axisSpec.binned.yTitle, rightVersionLabel)
                    : binnedOption(item, axisSpec.binned.xTitle, axisSpec.binned.yTitle, axisSpec.binned.yDeltaTitle, {
                        leftLabel: leftVersionLabel,
                        rightLabel: rightVersionLabel
                      })
                }
                className="chart"
              />
            </div>
          )}

          {item.visualPayload.type === 'joint_distribution' && jointRanges && (
            <div className="card-section">
              {mode === 'single' ? (
                <EChart
                  option={jointHeatmapOption({
                    title: rightVersionLabel,
                    cells: item.visualPayload.matrix.right,
                    xLabels: item.visualPayload.matrix.xAxis.labels,
                    yLabels: item.visualPayload.matrix.yAxis.labels,
                    min: jointRanges.sharedMin,
                    max: jointRanges.sharedMax,
                    colors: ['#eff6ff', '#1d4ed8'],
                    xAxisName: axisSpec.joint.xTitle,
                    yAxisName: axisSpec.joint.yTitle,
                    layout: buildAdaptiveHeatmapLayout(
                      'single',
                      item,
                      axisSpec,
                      item.visualPayload.matrix.xAxis.labels,
                      item.visualPayload.matrix.yAxis.labels
                    )
                  })}
                  className="chart chart-heatmap"
                />
              ) : (
                <div className="heatmap-scroll">
                  <div className="heatmap-grid heatmap-grid-compare">
                    <EChart
                      option={jointHeatmapOption({
                        title: leftVersionLabel,
                        cells: item.visualPayload.matrix.left,
                        xLabels: item.visualPayload.matrix.xAxis.labels,
                        yLabels: item.visualPayload.matrix.yAxis.labels,
                        min: jointRanges.sharedMin,
                        max: jointRanges.sharedMax,
                        colors: ['#eff6ff', '#1d4ed8'],
                        xAxisName: axisSpec.joint.xTitle,
                        yAxisName: axisSpec.joint.yTitle,
                        layout: buildAdaptiveHeatmapLayout(
                          'compare',
                          item,
                          axisSpec,
                          item.visualPayload.matrix.xAxis.labels,
                          item.visualPayload.matrix.yAxis.labels
                        )
                      })}
                      className="chart chart-heatmap"
                    />
                    <EChart
                      option={jointHeatmapOption({
                        title: rightVersionLabel,
                        cells: item.visualPayload.matrix.right,
                        xLabels: item.visualPayload.matrix.xAxis.labels,
                        yLabels: item.visualPayload.matrix.yAxis.labels,
                        min: jointRanges.sharedMin,
                        max: jointRanges.sharedMax,
                        colors: ['#e8f7f6', '#18958b'],
                        xAxisName: axisSpec.joint.xTitle,
                        yAxisName: axisSpec.joint.yTitle,
                        layout: buildAdaptiveHeatmapLayout(
                          'compare',
                          item,
                          axisSpec,
                          item.visualPayload.matrix.xAxis.labels,
                          item.visualPayload.matrix.yAxis.labels
                        )
                      })}
                      className="chart chart-heatmap"
                    />
                    <EChart
                      option={jointHeatmapOption({
                        title: 'Delta',
                        cells: item.visualPayload.matrix.delta,
                        xLabels: item.visualPayload.matrix.xAxis.labels,
                        yLabels: item.visualPayload.matrix.yAxis.labels,
                        min: jointRanges.deltaMin,
                        max: jointRanges.deltaMax,
                        colors: ['#1d4ed8', '#f8fafc', '#18958b'],
                        xAxisName: axisSpec.joint.xTitle,
                        yAxisName: axisSpec.joint.yTitle,
                        layout: buildAdaptiveHeatmapLayout(
                          'compare',
                          item,
                          axisSpec,
                          item.visualPayload.matrix.xAxis.labels,
                          item.visualPayload.matrix.yAxis.labels
                        )
                      })}
                      className="chart chart-heatmap"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {item.visualPayload.type === 'lognormal_pair' && (
            <div className="card-section">
              <EChart
                option={
                  mode === 'single'
                    ? curveSingleOption(
                        rightVersionLabel,
                        item.visualPayload.curveRight,
                        axisSpec.curve.xTitle,
                        axisSpec.curve.yTitle,
                        (value) => formatNumber(value),
                        undefined,
                        undefined,
                        undefined,
                        buildSingleMedianLegendMarkers(item.visualPayload.median.right)
                      )
                    : curveOption(
                        leftVersionLabel,
                        rightVersionLabel,
                        item.visualPayload.curveLeft,
                        item.visualPayload.curveRight,
                        axisSpec.curve.xTitle,
                        axisSpec.curve.yTitle,
                        (value) => formatNumber(value),
                        undefined,
                        undefined,
                        undefined,
                        buildCompareMedianLegendMarkers(
                          item.visualPayload.median.left,
                          item.visualPayload.median.right,
                          leftVersionLabel,
                          rightVersionLabel
                        )
                      )
                }
                className="chart"
              />
            </div>
          )}

          {item.visualPayload.type === 'power_law_pair' && (
            <div className="card-section">
              <EChart
                option={
                  mode === 'single'
                    ? curveSingleOption(
                        rightVersionLabel,
                        item.visualPayload.curveRight,
                        axisSpec.curve.xTitle,
                        axisSpec.curve.yTitle,
                        (value) => formatNumber(value)
                      )
                    : curveOption(
                        leftVersionLabel,
                        rightVersionLabel,
                        item.visualPayload.curveLeft,
                        item.visualPayload.curveRight,
                        axisSpec.curve.xTitle,
                        axisSpec.curve.yTitle,
                        (value) => formatNumber(value)
                      )
                }
                className="chart"
              />
            </div>
          )}

          {item.visualPayload.type === 'gaussian_pair' && (
            <div className="card-section">
              <div className="kpi-inline">
                <p>Log-reduction Gaussian:</p>
              </div>
              <EChart
                option={
                  mode === 'single'
                    ? curveSingleOption(
                        rightVersionLabel,
                        item.visualPayload.logCurveRight,
                        axisSpec.curve.xTitle,
                        axisSpec.curve.yTitle,
                        (value) => formatNumber(value),
                        undefined,
                        undefined,
                        undefined,
                        buildSingleMedianLegendMarkers(item.visualPayload.logMedian.right)
                      )
                    : curveOption(
                        leftVersionLabel,
                        rightVersionLabel,
                        item.visualPayload.logCurveLeft,
                        item.visualPayload.logCurveRight,
                        axisSpec.curve.xTitle,
                        axisSpec.curve.yTitle,
                        (value) => formatNumber(value),
                        undefined,
                        undefined,
                        undefined,
                        buildCompareMedianLegendMarkers(
                          item.visualPayload.logMedian.left,
                          item.visualPayload.logMedian.right,
                          leftVersionLabel,
                          rightVersionLabel
                        )
                      )
                }
                className="chart"
              />
              <div className="kpi-inline">
                <p>Implied percent-reduction density:</p>
              </div>
              <div className="kpi-inline">
                <p>Clipped tail mass at {item.visualPayload.percentCap}% cap:</p>
                {mode === 'single' ? (
                  <strong>{formatProbability(item.visualPayload.percentCapMassRight)}</strong>
                ) : (
                  <strong>
                    {formatProbability(item.visualPayload.percentCapMassLeft)} vs{' '}
                    {formatProbability(item.visualPayload.percentCapMassRight)} ({' '}
                    <span
                      className={deltaClassName(
                        item.visualPayload.percentCapMassRight - item.visualPayload.percentCapMassLeft
                      )}
                    >
                      {formatProbabilityDelta(
                        item.visualPayload.percentCapMassRight - item.visualPayload.percentCapMassLeft
                      )}
                    </span>
                    )
                  </strong>
                )}
              </div>
              <EChart
                option={
                  mode === 'single'
                    ? curveSingleOption(
                        rightVersionLabel,
                        item.visualPayload.percentCurveRight,
                        axisSpec.buyMultiplier.xTitle,
                        axisSpec.buyMultiplier.yTitle,
                        (value) => formatNumber(value),
                        item.visualPayload.percentCap,
                        `${item.visualPayload.percentCap}% cap`,
                        undefined,
                        buildSingleMedianLegendMarkers(
                          item.visualPayload.percentMedian.right,
                          item.visualPayload.percentDomain
                        )
                      )
                    : curveOption(
                        leftVersionLabel,
                        rightVersionLabel,
                        item.visualPayload.percentCurveLeft,
                        item.visualPayload.percentCurveRight,
                        axisSpec.buyMultiplier.xTitle,
                        axisSpec.buyMultiplier.yTitle,
                        (value) => formatNumber(value),
                        item.visualPayload.percentCap,
                        `${item.visualPayload.percentCap}% cap`,
                        undefined,
                        buildCompareMedianLegendMarkers(
                          item.visualPayload.percentMedian.left,
                          item.visualPayload.percentMedian.right,
                          leftVersionLabel,
                          rightVersionLabel,
                          item.visualPayload.percentDomain
                        )
                      )
                }
                className="chart"
              />
            </div>
          )}

          {item.visualPayload.type === 'hpa_expectation_line' && (
            <div className="card-section">
              <div className="kpi-inline">
                <p>Expected annual change line with DT={item.visualPayload.dt}:</p>
              </div>
              <EChart
                option={
                  mode === 'single'
                    ? curveSingleOption(
                        rightVersionLabel,
                        item.visualPayload.curveRight,
                        axisSpec.curve.xTitle,
                        axisSpec.curve.yTitle,
                        (value) => formatNumber(value)
                      )
                    : curveOption(
                        leftVersionLabel,
                        rightVersionLabel,
                        item.visualPayload.curveLeft,
                        item.visualPayload.curveRight,
                        axisSpec.curve.xTitle,
                        axisSpec.curve.yTitle,
                        (value) => formatNumber(value)
                      )
                }
                className="chart"
              />
            </div>
          )}

          {item.visualPayload.type === 'buy_quad' && (
            <div className="card-section">
              <div className="kpi-inline">
                <p>Median lognormal multiplier (exp(mu)):</p>
                {mode === 'single' ? (
                  <strong>{formatNumber(item.visualPayload.medianMultiplier.right)}</strong>
                ) : (
                  <strong>
                    {formatNumber(item.visualPayload.medianMultiplier.left)} vs{' '}
                    {formatNumber(item.visualPayload.medianMultiplier.right)} ({' '}
                    {formatPercent(item.visualPayload.medianMultiplier.delta.percent)})
                  </strong>
                )}
              </div>
              <EChart
                option={
                  mode === 'single'
                    ? curveSingleOption(
                        rightVersionLabel,
                        item.visualPayload.budgetRight,
                        axisSpec.buyBudget.xTitle,
                        axisSpec.buyBudget.yTitle,
                        (value) => formatNumber(value),
                        undefined,
                        undefined,
                        BUY_QUAD_CURVE_LAYOUT_OVERRIDES
                      )
                    : curveOption(
                        leftVersionLabel,
                        rightVersionLabel,
                        item.visualPayload.budgetLeft,
                        item.visualPayload.budgetRight,
                        axisSpec.buyBudget.xTitle,
                        axisSpec.buyBudget.yTitle,
                        (value) => formatNumber(value),
                        undefined,
                        undefined,
                        BUY_QUAD_CURVE_LAYOUT_OVERRIDES
                      )
                }
                className="chart"
              />
              <EChart
                option={
                  mode === 'single'
                    ? curveSingleOption(
                        rightVersionLabel,
                        item.visualPayload.multiplierRight,
                        axisSpec.buyMultiplier.xTitle,
                        axisSpec.buyMultiplier.yTitle,
                        (value) => formatNumber(value),
                        undefined,
                        undefined,
                        BUY_QUAD_CURVE_LAYOUT_OVERRIDES,
                        [
                          {
                            name: 'Median',
                            x: item.visualPayload.medianMultiplier.right,
                            color: '#495057'
                          }
                        ]
                      )
                    : curveOption(
                        leftVersionLabel,
                        rightVersionLabel,
                        item.visualPayload.multiplierLeft,
                        item.visualPayload.multiplierRight,
                        axisSpec.buyMultiplier.xTitle,
                        axisSpec.buyMultiplier.yTitle,
                        (value) => formatNumber(value),
                        undefined,
                        undefined,
                        BUY_QUAD_CURVE_LAYOUT_OVERRIDES,
                        [
                          {
                            x: item.visualPayload.medianMultiplier.left,
                            name: `${leftVersionLabel} median`,
                            color: '#0b7285'
                          },
                          {
                            x: item.visualPayload.medianMultiplier.right,
                            name: `${rightVersionLabel} median`,
                            color: '#18958b'
                          }
                        ]
                      )
                }
                className="chart"
              />
            </div>
          )}

          <div className="card-description">
            <strong>Policy relevance</strong>
            <p>{item.explanation}</p>
          </div>

          {!visualizationOnly && <div className="card-section">
            <button type="button" className="table-toggle" onClick={() => setIsMoreInfoOpen((current) => !current)}>
              {isMoreInfoOpen ? 'Hide provenance & sources' : 'Provenance & sources'}
            </button>
          </div>}

          {!visualizationOnly && isMoreInfoOpen && (
            <div className="card-meta">
              <dl>
                {mode === 'single' ? (
                  <>
                    <dt>Datasets</dt>
                    <dd>
                      {item.sourceInfo.datasetsRight.length === 0 ? (
                        'n/a'
                      ) : (
                        <div className="source-dataset-list">
                          {item.sourceInfo.datasetsRight.map((dataset) => (
                            <div
                              key={`source-right-${dataset.fullName}-${dataset.year}-${dataset.edition ?? ''}`}
                              className="source-dataset-item"
                            >
                              {formatDatasetAttribution(dataset)}
                            </div>
                          ))}
                        </div>
                      )}
                    </dd>
                    <dt>Source Files</dt>
                    <dd>
                      <code>{item.sourceInfo.configPathRight}</code>
                      {item.sourceInfo.dataFilesRight.map((file) => (
                        <div key={file}>
                          <code>{file}</code>
                        </div>
                      ))}
                    </dd>
                    <dt>Config keys</dt>
                    <dd>{item.sourceInfo.configKeys.join(', ')}</dd>
                    <dt>Change provenance</dt>
                    <dd>through {item.rightVersion}</dd>
                  </>
                ) : (
                  <>
                    <dt>Left Datasets</dt>
                    <dd>
                      {item.sourceInfo.datasetsLeft.length === 0 ? (
                        'n/a'
                      ) : (
                        <div className="source-dataset-list">
                          {item.sourceInfo.datasetsLeft.map((dataset) => (
                            <div
                              key={`source-left-${dataset.fullName}-${dataset.year}-${dataset.edition ?? ''}`}
                              className="source-dataset-item"
                            >
                              {formatDatasetAttribution(dataset)}
                            </div>
                          ))}
                        </div>
                      )}
                    </dd>
                    <dt>Left Source Files</dt>
                    <dd>
                      <code>{item.sourceInfo.configPathLeft}</code>
                      {item.sourceInfo.dataFilesLeft.map((file) => (
                        <div key={file}>
                          <code>{file}</code>
                        </div>
                      ))}
                    </dd>
                    <dt>Right Datasets</dt>
                    <dd>
                      {item.sourceInfo.datasetsRight.length === 0 ? (
                        'n/a'
                      ) : (
                        <div className="source-dataset-list">
                          {item.sourceInfo.datasetsRight.map((dataset) => (
                            <div
                              key={`source-right-${dataset.fullName}-${dataset.year}-${dataset.edition ?? ''}`}
                              className="source-dataset-item"
                            >
                              {formatDatasetAttribution(dataset)}
                            </div>
                          ))}
                        </div>
                      )}
                    </dd>
                    <dt>Right Source Files</dt>
                    <dd>
                      <code>{item.sourceInfo.configPathRight}</code>
                      {item.sourceInfo.dataFilesRight.map((file) => (
                        <div key={file}>
                          <code>{file}</code>
                        </div>
                      ))}
                    </dd>
                    <dt>Config keys</dt>
                    <dd>{item.sourceInfo.configKeys.join(', ')}</dd>
                    <dt>Change provenance</dt>
                    <dd>
                      ({item.leftVersion}, {item.rightVersion}]
                    </dd>
                  </>
                )}
              </dl>
              <div className="provenance-block">
                {item.changeOriginsInRange.length === 0 ? (
                  <p className="provenance-empty">No tracked update metadata in selected scope.</p>
                ) : (
                  <ul className="provenance-list">
                    {item.changeOriginsInRange.map((origin) => (
                      <li key={`${item.id}-${origin.versionId}`}>
                        <div className="provenance-head">
                          <strong>{origin.versionId}</strong>
                          <span className={`validation-status ${origin.validationStatus}`}>
                            {validationStatusLabel(origin.validationStatus)}
                          </span>
                        </div>
                        <p>{origin.description}</p>
                        <p>
                          <b>Updated data sources:</b>{' '}
                          {origin.updatedDataSources.length > 0 ? origin.updatedDataSources.join(', ') : 'n/a'}
                        </p>
                        <p>
                          <b>Calibration files:</b> {origin.calibrationFiles.length > 0 ? origin.calibrationFiles.join(', ') : 'n/a'}
                        </p>
                        <p>
                          <b>Config parameters:</b> {origin.configParameters.length > 0 ? origin.configParameters.join(', ') : 'n/a'}
                        </p>
                        <div className="parameter-change-block">
                          <p>
                            <b>Parameter changes:</b>
                          </p>
                          {origin.parameterChanges.length === 0 ? (
                            <p>n/a</p>
                          ) : (
                            <ul className="parameter-change-list">
                              {origin.parameterChanges.map((parameterChange) => (
                                <li key={`${origin.versionId}-${parameterChange.configParameter}`}>
                                  <code>{parameterChange.configParameter}</code> -&gt;{' '}
                                  <code>{parameterChange.datasetSource ?? 'n/a'}</code>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        {origin.methodVariations.length > 0 && (
                          <div className="method-variation-block">
                            <p>
                              <b>Method improvements:</b>
                            </p>
                            <ul>
                              {origin.methodVariations.map((variation, index) => (
                                <li key={`${origin.versionId}-variation-${index}`}>
                                  <p>
                                    <b>Scope:</b> {variation.configParameters.join(', ')}
                                  </p>
                                  <p>
                                    <b>Improvement:</b> {variation.improvementSummary}
                                  </p>
                                  <p>
                                    <b>Why:</b> {variation.whyChanged}
                                  </p>
                                  {variation.methodChosen && (
                                    <p>
                                      <b>Method chosen:</b> {variation.methodChosen}
                                    </p>
                                  )}
                                  {variation.decisionLogic && (
                                    <p>
                                      <b>Decision logic:</b> {variation.decisionLogic}
                                    </p>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </article>
  );
}
