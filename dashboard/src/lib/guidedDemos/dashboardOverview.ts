import type { GuidedDemoDefinition, GuidedDemoStep } from './types';

function stop(id: string, path: string, title: string, bullets: readonly string[]): GuidedDemoStep {
  return {
    id, path, title, query: {}, body: '', bullets,
    kind: 'info', interactive: false,
    target: `[data-guided-target="sidebar-${id}"]`,
    unavailableBody: id === 'settings'
      ? 'This sidebar link is unavailable. Use Back to revisit the guide or Finish to leave.'
      : 'This sidebar link is unavailable. Use Back or Next to continue, or Exit to leave.'
  };
}

export const DASHBOARD_OVERVIEW_DEMO: GuidedDemoDefinition = {
  id: 'dashboard-overview',
  label: 'Explore the dashboard',
  description: 'Find each section and see what you can do there.',
  duration: 'Five short stops',
  startHere: true,
  finishOnLastStep: true,
  requiredRunIds: [],
  requiredExperimentIds: [],
  steps: [
    stop('home', '/', 'Home', [
      'Start here for shortcuts to experiments, results and model information.',
      'Choose a guided demo to learn a task.'
    ]),
    stop('experiments', '/experiments', 'Experiments', [
      'Policy scenarios test one policy configuration.',
      'Sensitivity analyses test a range of values for one policy instrument.'
    ]),
    stop('results', '/results', 'Results', [
      'Compare saved policy runs and explore sensitivity results.',
      'Report summarises outcomes. Detailed adds indicators, charts and files.',
      'Follow submitted jobs here.'
    ]),
    stop('model-information', '/model-evidence', 'Model information', [
      'Understand the model’s assumptions and how closely its outputs match observed housing market data.',
      'Calibration explains the setup. Validation checks the fit to evidence.'
    ]),
    stop('settings', '/settings', 'Settings', [
      'See application information in browser and desktop versions.',
      'Desktop also opens results and logs folders, and exports support bundles.'
    ])
  ],
  completion: {
    title: 'Ready to explore the dashboard',
    body: 'Use the sidebar to choose a section, or return Home for another guided demo.'
  }
};
