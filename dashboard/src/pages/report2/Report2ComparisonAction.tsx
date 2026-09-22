import type { ResultsRunSummary } from '../../../shared/types';
import { buildMatchingBaselineScenarioDraft, findMatchedManualBaselineRun, isMatchedManualBaselineRun } from '../../lib/manualResultsView';
import type { ScenarioDraftV1 } from '../../lib/scenarioDraft';

interface Report2ComparisonActionProps {
  primary: ResultsRunSummary;
  comparison: ResultsRunSummary | null;
  runs: ResultsRunSummary[];
  canWrite: boolean;
  onUse: (runId: string) => void;
  onCreate: (draft: ScenarioDraftV1) => void;
}

/** Offer the Detailed view's existing baseline workflow within the policy Report. */
export function Report2ComparisonAction({ primary, comparison, runs, canWrite, onUse, onCreate }: Report2ComparisonActionProps) {
  const candidates = [primary, ...runs.filter((run) => run.runId !== primary.runId)];
  const matched = findMatchedManualBaselineRun(candidates, primary.runId);

  if (matched) {
    if (!comparison || isMatchedManualBaselineRun(primary, comparison)) return null;
    return <aside className="r2-comparison-action" aria-label="Matching baseline">
      <div><strong>A matching baseline is available.</strong><p>{matched.title?.trim() || matched.runId}</p></div>
      <button type="button" onClick={() => onUse(matched.runId)}>Use matching run</button>
    </aside>;
  }

  const draft = buildMatchingBaselineScenarioDraft(primary);
  const unavailable = !draft
    ? 'Saved setup is incomplete, so a matching run cannot be prefilled.'
    : !canWrite ? 'Run creation is unavailable in this session.' : '';

  return <aside className="r2-comparison-action" aria-label="Matching baseline">
    <div>
      <strong>Create a matching baseline?</strong>
      <p>Match the model, duration and seed count using the base policy. Review the setup before starting.</p>
      {unavailable && <p className="r2-comparison-unavailable">{unavailable}</p>}
    </div>
    <button type="button" disabled={Boolean(unavailable)} onClick={() => {
      if (canWrite && draft) onCreate(draft);
    }}>Create matching run</button>
  </aside>;
}
