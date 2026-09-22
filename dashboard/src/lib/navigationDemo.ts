export const NAVIGATION_DEMO_QUERY_VALUE = 'navigation';
export type NavigationDemoMode = 'full' | 'results' | 'model-information';

export interface NavigationDemoStep {
  id: string;
  section: string;
  title: string;
  body: string;
  path: string;
  query?: Record<string, string>;
  targetSelector?: string;
  unavailableBody?: string;
}

const policyQuery = { type: 'manual', presentation: 'report' };
const sensitivityQuery = { type: 'sensitivity', presentation: 'report' };
const missingPolicyReport = 'The report is still loading, or no saved output is available. Select a completed run at the top of Results to see its charts. You can continue the tour and return here later.';

const resultsSteps: readonly NavigationDemoStep[] = [
  {
    id: 'policy-runs', section: 'Results · Policy scenarios', title: 'Open a saved run',
    body: 'Results opens an available saved run. “Selected policy run” chooses the scenario; “Comparison baseline” chooses the reference it is measured against. Use runs with matching model and run settings to isolate a policy change. Any comparison warnings explain differences that need attention.',
    path: '/results', query: policyQuery, targetSelector: '.r2-run-controls'
  },
  {
    id: 'analysis-window', section: 'Results · Policy scenarios', title: 'Choose the months you are reading',
    body: 'Analysis window controls which simulated months feed the report. “After month 500” leaves out the initial settling period. The headline cards below summarise that window; changes are relative to the comparison baseline. These are model months, not calendar dates.',
    path: '/results', query: policyQuery, targetSelector: '.r2-page-heading'
  },
  {
    id: 'market', section: 'Results · Policy scenarios', title: 'Move from headlines to charts',
    body: 'Market activity switches between house prices, mortgage approvals and transactions. The lines show how each run changes over time; the table gives window averages. Use the legend to show or hide a run, and hover over the chart for monthly values.',
    path: '/results', query: policyQuery, targetSelector: '.r2-market', unavailableBody: missingPolicyReport
  },
  {
    id: 'households', section: 'Results · Policy scenarios', title: 'See who is affected',
    body: 'Continue down the report for buyer groups, lending risk, and renting and ownership. Here, LTV means loan-to-value and LTI means loan-to-income. Switch between them to inspect high-ratio borrowing. “Transaction coverage” explains which recorded loans support the figures.',
    path: '/results', query: policyQuery, targetSelector: '.r2-risk', unavailableBody: missingPolicyReport
  },
  {
    id: 'detailed', section: 'Results · Detailed', title: 'Find exact values and saved files',
    body: 'Detailed opens the fuller result tables. Expand Policy results, then use View trend beside an indicator. Below, Run History lists saved runs and File Manifest lists their files. Pending jobs appear in Queue when present. Switch back to Report for the overview.',
    path: '/results', query: { type: 'manual', presentation: 'detailed' }, targetSelector: '.manual-results-aggregate-card'
  },
  {
    id: 'sensitivity-runs', section: 'Results · Sensitivity analysis', title: 'Open a sensitivity analysis',
    body: 'Choose a saved analysis at the top of Results. Sensitivity analysis varies one policy instrument or linked package across tested settings. This context lists the instrument, simulated baseline, sampled range and seed coverage. Seeds are repeated simulations with different random draws.',
    path: '/results', query: sensitivityQuery, targetSelector: '.sr2-context',
    unavailableBody: 'The report is still loading, or no saved sensitivity results are available. Choose a completed analysis at the top of Results when available. You can continue the tour and return here later.'
  },
  {
    id: 'sensitivity-response', section: 'Results · Sensitivity analysis', title: 'Read the response across policy settings',
    body: 'Choose an outcome to see its response across tested policy values, not time. The dashed line marks the baseline. Select a point to update the shared setting comparison, borrower activity and growth variation. Follow-up observations suggest further investigation; Detailed retains the full indicator tables.',
    path: '/results', query: sensitivityQuery, targetSelector: '.sr2-response',
    unavailableBody: 'Saved sensitivity outcomes are needed for this response chart. Choose a completed analysis in the selector above when available. Use Detailed to follow running analyses in Queue. You can continue the tour while results are unavailable.'
  }
];

const modelSteps: readonly NavigationDemoStep[] = [
  {
    id: 'calibration', section: 'Model information · Calibration', title: 'Find what went into the model',
    body: 'Model information has Calibration and Validation tabs. Calibration documents the inputs and fitted behaviour. Choose a model version, or enable Compare to inspect two versions. Below the selector, expand Five fitted behavioural parameters or Other model assumptions for values and their supporting evidence.',
    path: '/model-evidence', query: { view: 'calibration' }, targetSelector: '[aria-label="Calibration model selection"]'
  },
  {
    id: 'validation', section: 'Model information · Validation', title: 'Check how the model matches evidence',
    body: 'Validation compares saved model outputs with UK evidence. Choose a model above, then open Summary card for overall fit: lower validation loss means closer agreement. Outcome comparisons groups the metrics into themes; Details shows sources. These saved checks are separate from your selected experiment results.',
    path: '/model-evidence', query: { view: 'validation' }, targetSelector: '.validation-summary-card',
    unavailableBody: 'Validation holds saved checks against UK evidence. Choose an available model above to load its Summary card and outcome comparisons. Lower validation loss means closer agreement. These checks are separate from your experiment results; you can return when the evidence has loaded.'
  }
];

const finish: NavigationDemoStep = {
  id: 'finish', section: 'Ready to explore', title: 'You know where to go next',
  body: 'Use Results to revisit saved runs, Experiments to set up new work, and Model information to check the evidence. Finish leaves you on this page. For help creating a run, return to Home → Run demo → Run experiment demo.',
  path: '/model-evidence', query: { view: 'validation' }
};

export const NAVIGATION_DEMO_STEPS: Record<NavigationDemoMode, readonly NavigationDemoStep[]> = {
  full: [
    {
      id: 'welcome', section: 'Quick navigation demo', title: 'Find your way around in about three minutes',
      body: 'Results holds saved runs. Experiments is where you create new work; Model information explains the assumptions and checks behind it. Settings contains application and support options. Next visits the real pages using available saved results. Back revisits a stop; Exit leaves the tour.',
      path: '/', targetSelector: 'nav[aria-label="Main"]'
    },
    ...resultsSteps,
    {
      id: 'experiments', section: 'Experiments', title: 'Know where new work begins',
      body: 'Under Experiments, Policy scenarios opens one policy setup; Sensitivity analysis opens a range of values to test. Each leads through model choice, settings and review before launch. The separate Run experiment demo on Home walks through creation when you are ready.',
      path: '/experiments', targetSelector: '[aria-label="Experiment type"]'
    },
    ...modelSteps,
    finish
  ],
  results: [...resultsSteps, { ...finish, path: '/results', query: sensitivityQuery }],
  'model-information': [...modelSteps, finish]
};

export function navigationDemoState(search: URLSearchParams) {
  if (search.get('demo') !== NAVIGATION_DEMO_QUERY_VALUE) return null;
  const requestedMode = search.get('tour');
  const mode: NavigationDemoMode = requestedMode === 'results' || requestedMode === 'model-information'
    ? requestedMode : 'full';
  const steps = NAVIGATION_DEMO_STEPS[mode];
  const index = Math.max(0, steps.findIndex((step) => step.id === search.get('step')));
  return { mode, steps, index, step: steps[index] };
}

// Carry selections between stops and presentations without carrying a creation draft or old demo.
const SELECTION_KEYS = ['baselineRunId', 'runId', 'comparisonRunId', 'experimentId', 'window', 'version', 'left', 'right', 'evidenceYear', 'comparisonVersion'] as const;

export function buildNavigationDemoHref(mode: NavigationDemoMode, index = 0, currentSearch = new URLSearchParams()): string {
  const steps = NAVIGATION_DEMO_STEPS[mode];
  const step = steps[Math.max(0, Math.min(index, steps.length - 1))];
  const next = new URLSearchParams();
  for (const key of SELECTION_KEYS) {
    const value = currentSearch.get(key);
    if (value) next.set(key, value);
  }
  const calibrationMode = currentSearch.get('mode');
  if (calibrationMode === 'single' || calibrationMode === 'compare') next.set('mode', calibrationMode);
  for (const [key, value] of Object.entries(step.query ?? {})) next.set(key, value);
  next.set('demo', NAVIGATION_DEMO_QUERY_VALUE);
  next.set('tour', mode);
  next.set('step', step.id);
  return `${step.path}?${next}`;
}

export function navigationDemoExitHref(pathname: string, search: URLSearchParams): string {
  const next = new URLSearchParams(search);
  for (const key of ['demo', 'tour', 'step']) next.delete(key);
  return `${pathname}${next.size ? `?${next}` : ''}`;
}

export const NAVIGATION_DEMO_LAUNCH_HREF = buildNavigationDemoHref('full');
export const RESULTS_NAVIGATION_DEMO_LAUNCH_HREF = buildNavigationDemoHref('results');
export const MODEL_NAVIGATION_DEMO_LAUNCH_HREF = buildNavigationDemoHref('model-information');
