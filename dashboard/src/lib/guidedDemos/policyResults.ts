import { DEMO_EXAMPLE_FIGURES as figures, DEMO_EXAMPLE_IDS as examples } from '../../../shared/demoExamples';
import { formatKpiValue } from '../manualResultsView';
import type { GuidedDemoDefinition, GuidedDemoStep } from './types';

const money = (value: number) => formatKpiValue(value, 'GBP');
const count = (value: number) => formatKpiValue(value, 'count/month');
// Match the report's two-decimal change labels throughout the walkthrough.
const magnitude = (value: number) => Math.abs(value).toFixed(2);
const noTrend = 'body:not(:has(.trend-modal))';
const resultsOpen = ':has(.manual-results-aggregate-card > .collapsible-section-toggle[aria-expanded="true"])';
const trendTarget = [
  'body:has(.trend-modal) .trend-modal',
  `${noTrend}:not(${resultsOpen}) .manual-results-aggregate-card > .collapsible-section-toggle`,
  `${noTrend}${resultsOpen} #policy-results-credit_access .policy-results-group-toggle[aria-expanded="false"]`,
  `${noTrend}${resultsOpen} #policy-results-credit_access [data-guided-target="policy-mortgage-approvals-trend"]`
].join(', ');
const query = {
  type: 'manual', presentation: 'report', window: 'post500',
  baselineRunId: examples.policyRunId, comparisonRunId: examples.baselineRunId
};
const unavailableBody = 'This part of the report is unavailable. You can continue, go back, or exit and explore the saved example.';
const stop = (step: Omit<GuidedDemoStep, 'path' | 'query' | 'unavailableBody'> & { query?: Record<string, string> }): GuidedDemoStep => ({
  path: '/results', unavailableBody, ...step, query: { ...query, ...step.query }
});

export const POLICY_RESULTS_DEMO: GuidedDemoDefinition = {
  id: 'policy-results', label: 'Explore policy results',
  description: 'Compare a scenario with its baseline and find supporting results.',
  duration: 'About 2 minutes', requiredRunIds: [examples.policyRunId, examples.baselineRunId], requiredExperimentIds: [],
  finishOnLastStep: true,
  steps: [
    stop({ id: 'results-section', title: 'Find policy results', kind: 'info', target: '.sidebar-type-navigation[aria-label="Results type"]',
      body: '', bullets: [
        'Open Results and choose Policy scenarios.',
        'Report summarises results. Detailed contains all indicators and files.',
        'This walkthrough uses two saved example runs.'
      ] }),
    stop({ id: 'choose-runs', title: 'Choose runs to compare', kind: 'info', target: '[data-guided-target="policy-run-selectors"]',
      body: '', bullets: [
        'Selected policy run applies the policy change.',
        'A baseline run shows what happens without that policy change.',
        'Choose it under Comparison baseline to help isolate the policy’s effect.',
        'Match the model, other settings, duration and seeds for a fair comparison.'
      ] }),
    stop({ id: 'saved-example', title: 'A saved Bank Rate example', kind: 'info', target: '[data-guided-target="policy-context"]',
      body: '', bullets: [
        `The scenario raises Bank Rate by ${figures.configuration.policyBankRateRisePp} percentage point.`,
        `The baseline keeps ${figures.configuration.basePolicy} policy unchanged.`,
        'Model, duration and seeds match.',
        'Submitting a scenario does not create a baseline. Select or generate it separately.'
      ] }),
    stop({ id: 'headline', title: 'Read a headline', kind: 'info', target: '[data-guided-target="policy-house-price"]',
      body: '', bullets: [
        `Average house price is ${money(figures.policy.housePrice.selected)} against ${money(figures.policy.housePrice.baseline)}, ${magnitude(figures.policy.housePrice.relativeChange)}% lower.`,
        'Headlines average the Analysis window shown at the top right.',
        `The window starts after month ${figures.configuration.analysisStartMonth} to skip the settling period.`
      ] }),
    stop({ id: 'market', title: 'Follow the market over time', kind: 'action', interactive: true, target: '[data-guided-target="policy-market"]',
      body: '', bullets: [
        'The horizontal axis shows simulation months.',
        'Select Mortgage approvals to compare both runs over time.',
        'The table shows averages for the Analysis window.'
      ],
      actionHint: 'Select Mortgage approvals.',
      completionBullets: [
        `Approvals average ${magnitude(figures.policy.approvals.relativeChange)}% lower.`,
        `Figures average ${figures.configuration.seeds} seeds. Differences between seeds are not shown.`,
        `Small gaps such as transactions (−${magnitude(figures.policy.transactions.relativeChange)}%) may be simulation noise.`
      ],
      completion: { kind: 'query', key: 'indicator', value: 'core_mortgageApprovals' } }),
    stop({ id: 'borrowers', title: 'Who is borrowing?', kind: 'info', target: '[data-guided-target="policy-borrowers"]',
      body: '', bullets: [
        `Buy-to-let mortgage lending falls most, by ${magnitude(figures.policy.buyToLet.relativeChange)}%.`,
        `First-time buyer mortgages average ${count(figures.policy.firstTimeBuyers.selected)} against ${count(figures.policy.firstTimeBuyers.baseline)} per month.`,
        `Home-mover lending rises ${magnitude(figures.policy.homeMovers.relativeChange)}%.`
      ] }),
    stop({ id: 'tenure', title: 'Renting and ownership', kind: 'info', target: '[data-guided-target="policy-rental"]',
      body: '', bullets: [
        'The chart shows household shares in the selected run.',
        `Owner-occupiers are ${formatKpiValue(figures.policy.ownership.selected, '%')}, ${magnitude(figures.policy.ownership.change)} percentage points above baseline.`,
        `Private renters are ${formatKpiValue(figures.policy.privateRenting.selected, '%')}, ${magnitude(figures.policy.privateRenting.change)} percentage points below baseline.`,
        'Other includes active landlords and households in social housing.'
      ] }),
    stop({ id: 'detailed', title: 'Switch to Detailed', kind: 'action', interactive: true, target: '.results-presentation-toggle',
      body: '', bullets: [
        'Report gives an overview.',
        'Detailed contains every indicator, chart controls and run files.',
        'Select Detailed to explore further.'
      ],
      actionHint: 'Select Detailed.', completionBullets: [
        'Detailed is open.',
        'Next, open the mortgage approvals trend in Policy results.'
      ],
      completion: { kind: 'query', key: 'presentation', value: 'detailed' } }),
    stop({ id: 'investigate', title: 'View mortgage approvals', kind: 'action', interactive: true,
      query: { presentation: 'detailed', policyResults: 'closed', policyTrend: '' },
      restoreQueryKeys: ['presentation', 'policyResults', 'policyTrend'],
      target: trendTarget,
      body: '', bullets: [
        'Open Policy results, then Credit access.',
        'Select View trend beside Mortgage approvals.'
      ],
      actionHint: 'Open Policy results, Credit access, then the Mortgage approvals trend.',
      completionBullets: [
        'The horizontal axis shows simulation months.',
        'Dotted lines show each run’s mean.',
        'Next, find Run History below Policy results.'
      ],
      completion: { kind: 'selector', selector: 'body:has(.manual-results-aggregate-card > .collapsible-section-toggle[aria-expanded="true"]) .trend-modal[data-indicator-id="core_mortgageApprovals"]' }
    }),
    stop({ id: 'run-history', title: 'Manage your runs', kind: 'info',
      query: { presentation: 'detailed', policyTrend: '' },
      restoreQueryKeys: ['presentation', 'policyResults'],
      target: '.run-history-card > .collapsible-section-toggle',
      body: '', bullets: [
        'Run History below lists saved runs.',
        'Open it later to revisit results and manage eligible runs.'
      ] })
  ],
  completion: { title: 'Ready to explore policy results', body: '', bullets: [
    'Compare a policy scenario with its baseline.',
    'Use Detailed to find supporting indicators and files.'
  ] }
};
