import { useEffect, useMemo, useState } from 'react';
import type {
  LendingBorrowerType,
  LendingDistributionPayload,
  LendingMetricId,
  ResultsCompareWindow
} from '../../../../shared/types';
import { CollapsibleSection } from '../../../components/CollapsibleSection';
import { EChart } from '../../../components/EChart';
import { LoadingSkeleton } from '../../../components/LoadingSkeleton';
import { jointHeatmapOption } from '../../../lib/jointHeatmapOption';
import { pooledOwnerOccupierLending } from '../../../lib/manualResultsView';
import {
  borrowerTypeLabel,
  buildLendingDistributionOption,
  buildLendingTailBandOption,
  capRuleLabel,
  findCap,
  LENDING_BORROWER_TYPES,
  LENDING_DISTRIBUTION_METRICS,
  metricAxisTitle,
  toJointHeatmapData
} from '../../../lib/lendingChartOptions';

export type LendingView = 'distribution' | 'tails' | 'byPrice' | 'joint';

const VIEW_PILLS: Array<{ id: LendingView; label: string }> = [
  { id: 'distribution', label: 'Distribution' },
  { id: 'tails', label: 'Risk tails' },
  { id: 'byPrice', label: 'By house price' },
  { id: 'joint', label: 'Joint LTV × LTI' }
];

const WINDOW_LABELS: Record<ResultsCompareWindow, string> = {
  post500: 'from month 500',
  post200: 'from month 200',
  post1000: 'from month 1,000',
  post1500: 'from month 1,500',
  post2000: 'from month 2,000',
  tail120: 'last 120 months',
  full: 'all recorded months'
};

interface NewLendingCardProps {
  baseline: LendingDistributionPayload | null;
  comparison: LendingDistributionPayload | null;
  isLoading: boolean;
  error: string;
  activeView: LendingView;
  onViewChange: (view: LendingView) => void;
  activeMetric: LendingMetricId;
  onMetricChange: (metric: LendingMetricId) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatCount(value: number): string {
  return value.toLocaleString('en-GB');
}

function formatShare(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatPriceBound(value: number | null): string {
  return value === null ? '—' : `£${Math.round(value).toLocaleString('en-GB')}`;
}

function formatRatio(value: number | null, decimals: number): string {
  return value === null ? '—' : value.toFixed(decimals);
}

/** Primary-run minus comparison-run percentage-point change. */
function formatDelta(primaryValue: number, comparisonValue: number): string {
  const delta = primaryValue - comparisonValue;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)} pp`;
}

function deltaClassName(primaryValue: number, comparisonValue: number): string {
  const delta = primaryValue - comparisonValue;
  if (Math.abs(delta) < 0.05) {
    return 'lending-delta-flat';
  }
  return delta > 0 ? 'lending-delta-up' : 'lending-delta-down';
}

/** States the window actually used, which is not always the one the analysis window asked for. */
function describeWindow(payload: LendingDistributionPayload): string {
  const { window } = payload;
  const range =
    window.startModelTime !== null && window.endModelTime !== null
      ? `Months ${window.startModelTime}–${window.endModelTime}`
      : 'No recorded months';
  if (!window.clamped) {
    return `${range} (${WINDOW_LABELS[window.effective]})`;
  }
  return `${range} · ${WINDOW_LABELS[window.requested]} was requested, but recording starts at month ${
    window.recordingStartModelTime ?? window.dataStartModelTime ?? '?'
  }`;
}

/** Exported so the results table can state the same reason on the loan-level rows it gates. */
export function unavailableMessage(payload: LendingDistributionPayload): string {
  if (payload.unavailableReason === 'recording_disabled') {
    return 'This run was created with transaction recording switched off, so no loan-level file was written. Enable "recordTransactions" when setting up a run to chart its lending distributions.';
  }
  if (payload.unavailableReason === 'no_rows_in_window') {
    return 'No mortgaged transactions fall inside the selected analysis window.';
  }
  if (payload.unavailableReason === 'no_transaction_file') {
    return 'This run folder has no SaleTransactions-run1.csv. Runs created before loan-level recording was enabled will not have one.';
  }
  return payload.note ?? 'New-lending distributions are not available for this run.';
}

export function NewLendingCard({
  baseline,
  comparison,
  isLoading,
  error,
  activeView,
  onViewChange,
  activeMetric,
  onMetricChange,
  open,
  onOpenChange
}: NewLendingCardProps): JSX.Element {
  const [borrowerType, setBorrowerType] = useState<LendingBorrowerType>('FTB');

  // LTI and DSTI caps only exist for owner-occupiers; keep the selection on a type the metric has.
  useEffect(() => {
    if (activeMetric !== 'ltv' && borrowerType === 'BTL') {
      setBorrowerType('FTB');
    }
  }, [activeMetric, borrowerType]);

  const distributionOption = useMemo(
    () => buildLendingDistributionOption(baseline, comparison, activeMetric, borrowerType),
    [baseline, comparison, activeMetric, borrowerType]
  );

  const cap = baseline ? findCap(baseline.caps, borrowerType, activeMetric) : null;

  const tailGroup = baseline?.bandGroups.find((group) => group.metric === (activeMetric === 'lti' ? 'lti' : 'ltv'));
  const comparisonTailGroup =
    comparison?.bandGroups.find((group) => group.metric === (activeMetric === 'lti' ? 'lti' : 'ltv')) ?? null;

  const jointData = useMemo(
    () => (baseline?.joint ? toJointHeatmapData(baseline.joint, borrowerType) : null),
    [baseline, borrowerType]
  );

  const lendingSectionProps = {
    id: 'new-lending-card',
    className: 'results-card manual-results-lending-card',
    title: 'New lending',
    description:
      'The shape of the loan-level distribution behind the monthly means above. A flow limit acts on the tail, not the average.',
    open,
    onOpenChange
  } as const;

  if (isLoading) {
    return (
      <CollapsibleSection {...lendingSectionProps}>
        <LoadingSkeleton className="lending-chart-skeleton" ariaLabel="Loading new-lending distributions" />
      </CollapsibleSection>
    );
  }

  if (error) {
    return (
      <CollapsibleSection {...lendingSectionProps}>
        <p className="error-banner">{error}</p>
      </CollapsibleSection>
    );
  }

  if (!baseline || !baseline.available) {
    return (
      <CollapsibleSection {...lendingSectionProps}>
        <p className="info-banner">{baseline ? unavailableMessage(baseline) : 'Select a run to see its new lending.'}</p>
      </CollapsibleSection>
    );
  }

  // The paper's Table 3 reports owner-occupiers as one line; neither buyer type alone reproduces it.
  const pooledOwnerOccupiers = pooledOwnerOccupierLending(baseline);

  const seedSummary =
    baseline.seedCount > 1
      ? `pooled over ${baseline.seedCount} seeds`
      : `${baseline.seedCount} transaction file`;

  return (
    <CollapsibleSection {...lendingSectionProps}>
      <dl className="lending-provenance">
        <div>
          <dt>Mortgaged transactions</dt>
          <dd>{formatCount(baseline.counts.mortgaged)}</dd>
        </div>
        <div>
          <dt>Cash purchases excluded</dt>
          <dd>{formatCount(baseline.counts.cashExcluded)}</dd>
        </div>
        <div>
          <dt>Analysis window</dt>
          <dd>{describeWindow(baseline)}</dd>
        </div>
        <div>
          <dt>Seeds</dt>
          <dd>{seedSummary}</dd>
        </div>
      </dl>

      <p className="lending-caption lending-scale-note">
        Every figure in this card is a count of model transactions, not a UK-scaled one. The results
        table above scales its counts to UK households; these are the sample behind the shape.
      </p>

      <div className="table-scroll">
        <table className="data-table lending-summary-table">
          <caption>New lending, loan level</caption>
          <thead>
            <tr>
              <th scope="col">Borrower</th>
              <th scope="col">Loans</th>
              <th scope="col">Mean LTV</th>
              <th scope="col">Mean LTI</th>
              <th scope="col">Price to income</th>
            </tr>
          </thead>
          <tbody>
            {baseline.summaryByBorrowerType.map((summary) => (
              <tr key={summary.borrowerType}>
                <th scope="row">{borrowerTypeLabel(summary.borrowerType)}</th>
                <td>{formatCount(summary.count)}</td>
                <td>{summary.meanLtv === null ? '—' : `${summary.meanLtv.toFixed(2)}%`}</td>
                <td>{formatRatio(summary.meanLti, 3)}</td>
                <td>{formatRatio(summary.meanPriceToIncome, 2)}</td>
              </tr>
            ))}
            {pooledOwnerOccupiers && (
              <tr className="lending-summary-pooled-row">
                <th scope="row">All owner-occupiers</th>
                <td>{formatCount(pooledOwnerOccupiers.count)}</td>
                <td>
                  {pooledOwnerOccupiers.meanLtv === null
                    ? '—'
                    : `${pooledOwnerOccupiers.meanLtv.toFixed(2)}%`}
                </td>
                <td>{formatRatio(pooledOwnerOccupiers.meanLti, 3)}</td>
                <td>{formatRatio(pooledOwnerOccupiers.meanPriceToIncome, 2)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="lending-caption">
        Price to income here is transaction price over annual gross employment income, averaged over
        new lending — the loan-level measure the paper reports as 4.4. The results table&apos;s
        price-to-income row is a different statistic: an aggregate across every household, against net
        total income.
      </p>

      {comparison && !comparison.available && (
        <p className="info-banner">Comparison run: {unavailableMessage(comparison)}</p>
      )}

      <div className="manual-manifest-switcher lending-view-switcher" role="tablist" aria-label="New lending views">
        {VIEW_PILLS.map((pill) => (
          <button
            key={pill.id}
            type="button"
            role="tab"
            aria-selected={activeView === pill.id}
            className={`filter-pill ${activeView === pill.id ? 'active' : ''}`}
            onClick={() => onViewChange(pill.id)}
          >
            {pill.label}
          </button>
        ))}
      </div>

      {activeView === 'distribution' && (
        <div className="lending-view">
          <div className="lending-controls">
            <div className="lending-control-group">
              <span className="lending-control-label">Metric</span>
              <div className="manual-manifest-switcher">
                {LENDING_DISTRIBUTION_METRICS.map((metric) => (
                  <button
                    key={metric.id}
                    type="button"
                    className={`filter-pill ${activeMetric === metric.id ? 'active' : ''}`}
                    onClick={() => onMetricChange(metric.id)}
                  >
                    {metric.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="lending-control-group">
              <span className="lending-control-label">Borrower</span>
              <div className="manual-manifest-switcher">
                {LENDING_BORROWER_TYPES.map((entry) => {
                  const unavailable = activeMetric !== 'ltv' && entry.id === 'BTL';
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={`filter-pill ${borrowerType === entry.id ? 'active' : ''}`}
                      onClick={() => setBorrowerType(entry.id)}
                      disabled={unavailable}
                      title={unavailable ? 'Buy-to-let lending is assessed on rental cover, not income' : undefined}
                    >
                      {entry.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {distributionOption ? (
            <EChart option={distributionOption} className="lending-chart" />
          ) : (
            <p className="info-banner">No {metricAxisTitle(activeMetric)} data for this run.</p>
          )}

          <p className="lending-caption">
            {cap
              ? `The vertical rule is the ${capRuleLabel(cap)} for ${borrowerTypeLabel(borrowerType)} — the limit that binds is the tighter of the Central Bank and lender limits.`
              : `No ${activeMetric.toUpperCase()} limit applies to ${borrowerTypeLabel(borrowerType)} in this run.`}
          </p>
        </div>
      )}

      {activeView === 'tails' && tailGroup && (
        <div className="lending-view">
          <div className="lending-controls">
            <div className="lending-control-group">
              <span className="lending-control-label">Metric</span>
              <div className="manual-manifest-switcher">
                {LENDING_DISTRIBUTION_METRICS.filter((metric) => metric.id !== 'dsti').map((metric) => (
                  <button
                    key={metric.id}
                    type="button"
                    className={`filter-pill ${activeMetric === metric.id ? 'active' : ''}`}
                    onClick={() => onMetricChange(metric.id)}
                  >
                    {metric.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <EChart
            option={buildLendingTailBandOption(tailGroup, comparisonTailGroup)}
            className="lending-chart"
          />
          <p className="lending-caption">
            Share of each borrower type&apos;s own new lending falling in each risk band.
            {comparisonTailGroup ? ' Outlined bars are the comparison run.' : ''}
          </p>
        </div>
      )}

      {activeView === 'byPrice' && baseline.quintiles && (
        <div className="lending-view">
          <div className="table-scroll">
            <table className="data-table lending-quintile-table">
              <thead>
                <tr>
                  <th scope="col">House price quintile</th>
                  <th scope="col">Upper bound (£)</th>
                  <th scope="col">
                    {comparison?.quintiles ? 'Primary run − Comparison run, high-LTV share (pp)' : 'Share of all high-LTV lending (%)'}
                  </th>
                  <th scope="col">
                    {comparison?.quintiles ? 'Primary run − Comparison run, high-LTI share (pp)' : 'Share of all high-LTI lending (%)'}
                  </th>
                  <th scope="col">High-LTV loans, FTB / HM (count)</th>
                </tr>
              </thead>
              <tbody>
                {baseline.quintiles.quintiles.map((row, index) => {
                  const comparisonRow = comparison?.quintiles?.quintiles[index] ?? null;
                  const ftb = row.byBorrowerType.find((cell) => cell.borrowerType === 'FTB')?.highLtvCount ?? 0;
                  const hm = row.byBorrowerType.find((cell) => cell.borrowerType === 'HM')?.highLtvCount ?? 0;
                  return (
                    <tr key={row.quintile}>
                      <th scope="row">Q{row.quintile}</th>
                      <td>
                        {index === baseline.quintiles!.quintiles.length - 1
                          ? `above ${formatPriceBound(baseline.quintiles!.cutPoints[index - 1] ?? null)}`
                          : formatPriceBound(baseline.quintiles!.cutPoints[index] ?? null)}
                      </td>
                      <td className={comparisonRow ? deltaClassName(row.highLtvShareOfAll, comparisonRow.highLtvShareOfAll) : ''}>
                        {comparisonRow
                          ? formatDelta(row.highLtvShareOfAll, comparisonRow.highLtvShareOfAll)
                          : formatShare(row.highLtvShareOfAll)}
                      </td>
                      <td className={comparisonRow ? deltaClassName(row.highLtiShareOfAll, comparisonRow.highLtiShareOfAll) : ''}>
                        {comparisonRow
                          ? formatDelta(row.highLtiShareOfAll, comparisonRow.highLtiShareOfAll)
                          : formatShare(row.highLtiShareOfAll)}
                      </td>
                      <td>
                        {formatCount(ftb)} / {formatCount(hm)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="lending-caption">
            Quintiles of transaction price over the {formatCount(baseline.quintiles.poolCount)} owner-occupier
            mortgaged purchases in this window. High-LTV is at or above {baseline.quintiles.highLtvThreshold}%;
            high-LTI is above {baseline.quintiles.highLtiThreshold}.
          </p>
        </div>
      )}

      {activeView === 'joint' && jointData && (
        <div className="lending-view">
          <div className="lending-controls">
            <div className="lending-control-group">
              <span className="lending-control-label">Borrower</span>
              <div className="manual-manifest-switcher">
                {LENDING_BORROWER_TYPES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`filter-pill ${borrowerType === entry.id ? 'active' : ''}`}
                    onClick={() => setBorrowerType(entry.id)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <EChart
            option={jointHeatmapOption({
              cells: jointData.cells,
              xLabels: jointData.xLabels,
              yLabels: jointData.yLabels,
              min: 0,
              max: jointData.max,
              colors: ['#eff6ff', '#1d4ed8'],
              xAxisName: 'Loan-to-value (%)',
              yAxisName: 'Loan-to-income (ratio)',
              valueFormatter: (value) => `${value.toFixed(2)}% of ${borrowerTypeLabel(borrowerType)} lending`
            })}
            className="lending-chart lending-chart-heatmap"
          />
          <p className="lending-caption">
            Where {borrowerTypeLabel(borrowerType).toLowerCase()} lending sits on both risk measures at once. A
            limit aimed at one axis moves the distribution along the other.
          </p>
        </div>
      )}
    </CollapsibleSection>
  );
}
