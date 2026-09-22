import { useMemo } from 'react';
import type {
  SensitivityExperimentChartsPayload,
  SensitivityExperimentMetadata,
  SensitivityExperimentResultsPayload
} from '../../../../../shared/types';
import { BASE_POLICY_OPTIONS } from '../../../../../shared/policyCatalogue';
import { EChart } from '../../../../components/EChart';
import { ReportInfo } from '../../../../components/ReportInfo';
import { formatModelOptionLabel } from '../../../../lib/modelAnchors';
import { buildSensitivityReportMeanOption } from '../../../../lib/sensitivityChartOptions';
import { buildSensitivityReport, isReportMetricEligible, type ReportRow } from './reportModel';
import {
  buildCompactReportOutcomes,
  compactReportChange,
  compactReportNumber,
  compactReportValue,
  type CompactReportOutcome
} from './compactReport';

interface SensitivityReportViewProps {
  detail: SensitivityExperimentMetadata;
  results: SensitivityExperimentResultsPayload;
  windowType: SensitivityExperimentChartsPayload['windowType'] | null;
}

function OutcomeCard({ outcome, rows, parameter }: {
  outcome: CompactReportOutcome;
  rows: ReportRow[];
  parameter: SensitivityExperimentMetadata['parameter'];
}) {
  const option = useMemo(() => {
    const chart = buildSensitivityReportMeanOption(outcome, rows, parameter, outcome.focusRow?.point.pointId, outcome.relative);
    const xAxis = Array.isArray(chart.xAxis) ? chart.xAxis[0] : chart.xAxis;
    const yAxis = Array.isArray(chart.yAxis) ? chart.yAxis[0] : chart.yAxis;
    const values = rows.flatMap((row) => row.point.value !== null && Number.isFinite(row.point.value) ? [row.point.value] : []);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return {
      ...chart,
      // Keep the axis inside the tested range; padded endpoints otherwise look like extra settings.
      xAxis: { ...xAxis, ...(max > min ? { min, max, interval: (max - min) / 4 } : {}) },
      yAxis: { ...yAxis, axisLabel: { ...yAxis?.axisLabel, showMinLabel: false, showMaxLabel: false } }
    };
  }, [outcome, rows, parameter]);
  const largest = outcome.largest;
  const mean = outcome.focusRow?.metrics[outcome.id].mean ?? null;
  const headingId = `sensitivity-report-${outcome.id}`;

  return (
    <article className="sensitivity-report__outcome" aria-labelledby={headingId}>
      <div className="sensitivity-report__heading"><h4 id={headingId}>{outcome.title}</h4><ReportInfo label={outcome.title}>{outcome.description} With a usable baseline, this card highlights its largest available change across tested settings. Different cards may highlight different settings.</ReportInfo></div>
      <dl className="sensitivity-report__figures">
        <div>
          <dt>{outcome.focusRow ? `Mean at ${outcome.focusRow.setting}` : 'Mean at tested setting'}</dt>
          <dd>{mean !== null && outcome.units === 'count/month' ? (
            <>{compactReportNumber(mean)}<span className="sensitivity-report__figure-unit">/ month</span></>
          ) : compactReportValue(mean, outcome.units)}</dd>
        </div>
        <div className="sensitivity-report__comparison">
          <dt>Change vs baseline</dt>
          <dd>{largest ? compactReportChange(largest.change, outcome) : 'Unavailable'}</dd>
          <small>Baseline mean {compactReportValue(outcome.baselineMean, outcome.units)}</small>
        </div>
      </dl>
      {largest && largest.change !== 0 && outcome.ties.length > 0 && (
        <p className="sensitivity-report__tie" title={outcome.ties.map((tie) => `${compactReportChange(tie.change, outcome)} at ${tie.row.setting}`).join(', ')}>
          Equally large changes include {outcome.ties.map((tie) => `${compactReportChange(tie.change, outcome)} at ${tie.row.setting}`).join(', ')}
        </p>
      )}
      {!outcome.relative && outcome.available && (
        <p className="sensitivity-report__raw-note">Raw means are shown. A relative comparison is unavailable.</p>
      )}
      {outcome.available ? (
        <div className="sensitivity-report__visual" role="img" aria-label={`${outcome.title}. ${outcome.relative ? 'Percentage differences from baseline' : 'Mean values'} across tested policy settings. The dashed line shows the baseline. The large dot marks the highlighted setting.`}>
          <EChart className="sensitivity-report__chart" option={option} />
        </div>
      ) : (
        <p className="sensitivity-report__chart-empty">No usable tested response is available for this outcome.</p>
      )}
      <p className="sensitivity-report__cue"><strong>What to investigate</strong>{outcome.cue}</p>
    </article>
  );
}

export function SensitivityReportView({ detail, results, windowType }: SensitivityReportViewProps) {
  const report = useMemo(() => buildSensitivityReport(detail, results, windowType), [detail, results, windowType]);
  const outcomes = useMemo(() => buildCompactReportOutcomes(report), [report]);
  const active = detail.status === 'queued' || detail.status === 'running';
  const basePolicy = BASE_POLICY_OPTIONS.find((policy) => policy.id === detail.basePolicy)?.title ?? 'Baseline policy not recorded';
  const tested = report.rows.filter((row) => !row.point.isBaseline && row.point.value !== null && Number.isFinite(row.point.value));
  const testedRange = tested.length > 1 ? `${tested[0].setting}–${tested[tested.length - 1].setting}`
    : tested[0]?.setting ?? 'No scalar settings recorded';
  const hasMissingMeans = report.rows.some((row) => row.complete &&
    outcomes.some((outcome) => !isReportMetricEligible(row, outcome.id)));
  const seedSummary = report.complete
    ? `${report.rows[0].successfulSeeds} / ${report.rows[0].expectedSeeds} seeds per setting`
    : report.coverageKnown ? `${report.successfulSeeds} / ${report.expectedSeeds} seeds succeeded` : 'Seed coverage unverified';

  return (
    <section className="sensitivity-report" aria-label="Sensitivity analysis report">
      <header className="sensitivity-report__header">
        <div>
          <p className="sensitivity-report__eyebrow">Sensitivity analysis</p>
          <div className="sensitivity-report__heading"><h3>{detail.parameter.title}</h3><ReportInfo label="this sensitivity experiment">This saved experiment varies one policy instrument or linked package and compares its tested settings with its own simulated baseline. The recorded window and seed coverage determine which results can be compared.</ReportInfo></div>
          <p className="sensitivity-report__range">Tested <strong>{testedRange}</strong> · Baseline <strong>{report.baselineRow?.setting ?? 'not recorded'}</strong></p>
        </div>
        <span className={`sensitivity-report__badge ${report.complete ? 'sensitivity-report__badge--complete' : ''}`}>
          {active ? 'In progress' : report.complete ? 'Complete' : report.coverageKnown ? 'Incomplete results' : 'Recorded summary'}
          <strong>{seedSummary}</strong>
        </span>
        <p className="sensitivity-report__context">
          <span>{formatModelOptionLabel(detail.baseline)}</span>
          <span>{basePolicy}</span>
          <span>Analysis window {report.windowLabel}</span>
        </p>
      </header>

      {active ? (
        <p className="sensitivity-report__notice" role="status">The report will be available when this analysis finishes. Progress is in the queue above.</p>
      ) : (
        <>
          {(!report.complete || hasMissingMeans) && (
            <p className="sensitivity-report__notice" role="note">
              {!report.coverageKnown ? 'Seed coverage is unverified. ' : !report.complete ? 'Some settings have incomplete results. ' : ''}
              {hasMissingMeans ? 'Some outcome means are missing. ' : ''}
              Incomplete or missing responses remain gaps. Use Detailed for all recorded values and statuses.
            </p>
          )}
          <p className="sensitivity-report__reading-key">Each card highlights its largest available difference from baseline. The dashed line shows the baseline. The large dot marks the highlighted setting.</p>
          <div className="sensitivity-report__outcomes" aria-label="Three headline policy responses">
            {outcomes.map((outcome) => <OutcomeCard key={outcome.id} outcome={outcome} rows={report.rows} parameter={detail.parameter} />)}
          </div>
          <footer className="sensitivity-report__footer">
            <details>
              <summary>How to read this report</summary>
              <p>Means are calculated over the recorded analysis period within each seed, then averaged across successful seeds. They are never averaged across tested policy settings. Seed uncertainty is not shown.</p>
              <p>The highlighted setting has the largest absolute difference among usable tested settings. Its sign is retained. Different cards may highlight different settings. Without a usable baseline, the first available setting supplies the mean instead. A large response alone does not establish statistical significance or a policy problem.</p>
              <p>Graphs show responses across tested policy values, not simulation time. Lines join observed settings. They do not establish the response between them. Relative differences use the baseline mean. Absolute differences of percentage-valued outcomes use percentage points (pp).</p>
              {!report.coverageKnown && <p>For legacy summaries without seed detail, aggregation across seeds cannot be verified.</p>}
              {outcomes.map((outcome) => <p key={outcome.id}><strong>{outcome.title}.</strong> {outcome.description}</p>)}
              <p>Use Detailed for all indicators, tested values, volatility and dispersion. Volatility and dispersion describe variation over time, not uncertainty across seeds.</p>
            </details>
          </footer>
        </>
      )}
    </section>
  );
}
