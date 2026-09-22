import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchResultsRuns, fetchSensitivityExperiments } from '../lib/api';
import { buildGuidedDemoHref, GUIDED_DEMOS, hasGuidedDemoExamples } from '../lib/guidedDemos/registry';
import { getResultsType } from '../lib/workspaceNavigation';

/** A creation handoff offers the implemented results tour without starting it automatically. */
export function ResultsDemoInvitation() {
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const requested = search.get('resultsDemo');
  const expected = getResultsType(search) === 'sensitivity' ? 'sensitivity-results' : 'policy-results';
  const definition = requested === expected ? GUIDED_DEMOS.find((demo) => demo.id === requested) : undefined;
  const [availability, setAvailability] = useState<'loading' | 'ready' | 'missing'>('loading');
  const needsExamples = Boolean(definition?.requiredRunIds.length || definition?.requiredExperimentIds.length);
  useEffect(() => {
    if (!definition || !needsExamples) return;
    let cancelled = false;
    setAvailability('loading');
    void Promise.allSettled([fetchResultsRuns(true), fetchSensitivityExperiments(true)]).then(([runs, experiments]) => {
      const runIds = runs.status === 'fulfilled' ? runs.value.filter((run) => run.isExample).map((run) => run.runId) : [];
      const experimentIds = experiments.status === 'fulfilled' ? experiments.value.experiments.filter((run) => run.isExample).map((run) => run.experimentId) : [];
      if (!cancelled) setAvailability(hasGuidedDemoExamples(definition, runIds, experimentIds) ? 'ready' : 'missing');
    });
    return () => { cancelled = true; };
  }, [definition, needsExamples]);
  if (requested !== expected || search.has('demo')) return null;
  const ready = Boolean(definition) && (!needsExamples || availability === 'ready');
  const dismiss = () => {
    const next = new URLSearchParams(search);
    next.delete('resultsDemo');
    setSearch(next, { replace: true });
  };
  return <div className="info-banner" data-guided-target="results-demo-invitation" role="region" aria-label="Results walkthrough">
    <p>Would you like a walkthrough of {expected === 'policy-results' ? 'policy run' : 'sensitivity analysis'} results?</p>
    {!definition && <p>This walkthrough is coming soon.</p>}
    {needsExamples && <p>{availability === 'loading' ? 'Checking bundled examples…' : ready ? 'The walkthrough uses saved example results.' : "This example isn't available on this installation."}</p>}
    <button className="primary-button" type="button" disabled={!ready} onClick={() => { if (definition) navigate(buildGuidedDemoHref(definition.id)); }}>Yes</button>{' '}
    <button className="secondary-button" type="button" onClick={dismiss}>No</button>
  </div>;
}
