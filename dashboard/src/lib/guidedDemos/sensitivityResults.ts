import { DEMO_EXAMPLE_FIGURES as figures, DEMO_EXAMPLE_IDS as examples } from '../../../shared/demoExamples';
import { formatReport2Number } from '../../pages/sensitivity-report2/sensitivityReport2Model';
import type { GuidedDemoDefinition, GuidedDemoStep } from './types';

// The lesson contrasts a clear response (debt to income, every seed agrees) with an absent one
// (approvals, seeds split). tests/demo-example-figures.test.ts verifies each claim against the bundle.
const { configuration, sensitivity } = figures;
const tight = sensitivity.rows.find((row) => row.settingId === sensitivity.initialSettingId)!;
const loose = sensitivity.rows[sensitivity.rows.length - 1];
const baseline = sensitivity.rows.find((row) => row.approvals.total === 0)!;
const setting = (value: number) => `${formatReport2Number(value)}×`;
const points = (value: number) => `${formatReport2Number(Math.abs(value))} percentage points`;
const query = {
  type: 'sensitivity', presentation: 'report', experimentId: examples.sensitivityExperimentId,
  outcome: 'core_debtToIncome', setting: tight.settingId
};
const stop = (step: Omit<GuidedDemoStep, 'path' | 'query' | 'unavailableBody'> & { query?: Record<string, string> }): GuidedDemoStep => ({
  path: '/results',
  unavailableBody: 'This section is unavailable. Continue, go back or exit to retry the saved example.',
  // Only this lesson's controls can change. Fixed numerical contexts cannot drift on reload.
  restoreQueryKeys: [],
  ...step, query: { ...query, ...step.query }
});

export const SENSITIVITY_RESULTS_DEMO: GuidedDemoDefinition = {
  id: 'sensitivity-results', label: 'Explore sensitivity results',
  description: 'Learn which outcomes respond to a policy lever, and whether each response is real.',
  duration: 'About 4 minutes', requiredRunIds: [], requiredExperimentIds: [examples.sensitivityExperimentId],
  finishOnLastStep: true,
  steps: [
    stop({ id: 'results-section', title: 'What sensitivity analysis answers', kind: 'info',
      target: '.sidebar-type-navigation[aria-label="Results type"]', body: '', bullets: [
        'Sensitivity analysis moves one policy lever across a range, holding everything else fixed.',
        'It shows which outcomes respond, by how much, and whether each response is real or simulation noise.',
        'Open it from Results. This walkthrough uses a saved example.'
      ] }),
    stop({ id: 'baseline', title: 'Check the setup first', kind: 'info',
      target: '[data-guided-target="sensitivity-context"]', body: '', bullets: [
        `This example moves the first-time-buyer and home-mover LTI threshold from ${setting(tight.value)} to ${setting(loose.value)} income.`,
        `The baseline, ${setting(baseline.value)} income, is the ${configuration.basePolicy} policy setting. Nothing else changes.`,
        `Before reading results, check that all ${sensitivity.successfulSeeds} seed runs completed.`
      ] }),
    stop({ id: 'response', title: 'Read the shape across settings', kind: 'info',
      target: '[data-guided-target="sensitivity-response"]', body: '', bullets: [
        `Each point averages ${configuration.seeds} seeds at one tested setting. The dashed line marks the baseline.`,
        `Mortgage debt to income rises at every step from ${setting(tight.value)} to ${setting(loose.value)}.`,
        'A steady trend suggests a real response. A zigzag often means noise.'
      ] }),
    stop({ id: 'pairing', title: 'Check whether it is real', kind: 'info',
      target: '[data-guided-target="sensitivity-pairing"]', body: '', bullets: [
        `Each seed at ${setting(tight.value)} is matched with the same seed at baseline.`,
        `Mortgage debt to income is lower in all ${tight.debtToIncome.total} seeds, by ${formatReport2Number(Math.abs(tight.debtToIncome.max))} to ${points(tight.debtToIncome.min)}.`,
        'Agreement across seeds signals a clear response, not statistical significance.'
      ] }),
    stop({ id: 'setting', title: 'Test the opposite direction', kind: 'action', interactive: true,
      target: '[data-guided-target="sensitivity-setting"]', restoreQueryKeys: ['setting'], body: '', bullets: [
        `${setting(tight.value)} is tighter than the baseline. Check whether loosening has the opposite effect.`,
        'The table and every panel below use the selected setting.'
      ], actionHint: `Select ${setting(loose.value)} in Selected setting.`, completionBullets: [
        `At ${setting(loose.value)}, mortgage debt to income is ${points(loose.debtToIncome.change)} higher, in ${loose.debtToIncome.higher} of ${loose.debtToIncome.total} matched seeds.`,
        'Nearly all seeds agree and the trend is steady, so leverage responds in both directions.'
      ], completion: { kind: 'query', key: 'setting', value: loose.settingId } }),
    stop({ id: 'outcome', title: 'Find an outcome that does not respond', kind: 'action', interactive: true,
      target: '[data-guided-target="sensitivity-outcome"]', query: { setting: loose.settingId },
      restoreQueryKeys: ['outcome'], body: '', bullets: [
        'An average can differ from the baseline even when the policy has no real effect.',
        'Check Mortgage Approvals at the same setting.'
      ], actionHint: 'Select Mortgage Approvals in Outcome.', completionBullets: [
        `At ${setting(loose.value)}, approvals average ${formatReport2Number(loose.approvals.relativeChange)}% higher, but only ${loose.approvals.higher} of ${loose.approvals.total} seeds are higher.`,
        'Across settings, the averages zigzag instead of following a trend.',
        'Read this as no detectable effect, not a rise.'
      ], completion: { kind: 'query', key: 'outcome', value: 'core_mortgageApprovals' } }),
    stop({ id: 'table', title: 'Read the table as averages', kind: 'info',
      target: '[data-guided-target="sensitivity-selected"] .sr2-table-wrap',
      query: { outcome: 'core_mortgageApprovals', setting: loose.settingId }, body: '', bullets: [
        'The table shows averages, not seed agreement.',
        `At ${setting(loose.value)}, only mortgage debt to income moves consistently. Approvals, price to income and first-time-buyer lending split across seeds.`,
        'Choose an outcome under Outcome to check its seeds before quoting it.'
      ] }),
    stop({ id: 'finding', title: 'State the finding', kind: 'info',
      target: '[data-guided-target="sensitivity-response"]', body: '', bullets: [
        `Tightening to ${setting(tight.value)} lowers mortgage debt to income by ${points(tight.debtToIncome.change)}, in every seed.`,
        'Approvals and first-time-buyer lending show no consistent response. That is a finding too.',
        `Quote changes, not levels. Levels reflect ${configuration.evidenceYear} data and are not forecasts.`
      ] }),
    stop({ id: 'detailed', title: 'Switch to Detailed', kind: 'action', interactive: true,
      target: '.results-presentation-toggle', restoreQueryKeys: ['presentation'], body: '', bullets: [
        'Detailed ranks every saved outcome by the size of its response.',
        'Use it to find other outcomes worth checking.'
      ], actionHint: 'Select Detailed.', completionBullets: [
        'Detailed shows the same experiment and outcome.',
        'Next, open the ranking and the values at each setting.'
      ], completion: { kind: 'query', key: 'presentation', value: 'detailed' } }),
    stop({ id: 'tested-values', title: 'Rank, then check', kind: 'action', interactive: true,
      target: '#sensitivity-tested-values', query: {
        presentation: 'detailed', indicator: 'core_debtToIncome', measure: 'mean', sensitivityResults: 'closed'
      }, restoreQueryKeys: ['indicator', 'measure', 'sensitivityResults'], body: '', bullets: [
        'Open Outcome responses and results by tested value.',
        'Largest outcome responses ranks outcomes by their biggest change from the baseline.'
      ], actionHint: 'Open the highlighted section.', completionBullets: [
        'The ranking shows size, not reliability. A large bar can still be noise.',
        'Before quoting an outcome, check its seeds in Report.',
        'Results by tested value lists the exact values.',
        'Next, find Run History below.'
      ], completion: { kind: 'selector', selector: '#sensitivity-tested-values > button[aria-expanded="true"]' } }),
    stop({ id: 'run-history', title: 'Manage your runs', kind: 'info',
      target: '.sensitivity-run-history-card > .collapsible-section-toggle',
      // Run History exists only in Detailed, so this stop keeps Detailed even on a stale link.
      query: { presentation: 'detailed' }, body: '', bullets: [
        'Run History below lists saved sensitivity analyses.',
        'Open it later to revisit results and manage eligible runs.',
        'Each analysis simulates its own baseline, so read changes within one analysis.'
      ] })
  ],
  completion: { title: 'Ready to read sensitivity results', body: '', bullets: ['Check seed agreement before quoting any response.'] }
};
