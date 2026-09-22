import type { GuidedDemoDefinition, GuidedDemoStep } from './types';

export const MODEL_INFORMATION_DEMO_ID = 'model-information';

const stop = (id: string, view: 'calibration' | 'validation', title: string, target: string, bullets: readonly string[], extra: Partial<GuidedDemoStep> = {}): GuidedDemoStep => ({
  id, title, target, bullets, body: '', kind: 'info', interactive: false,
  path: '/model-evidence', query: { view, ...(view === 'calibration' ? { mode: 'single' } : {}) },
  unavailableBody: 'This section is unavailable. Go back, continue, or exit to explore the page.',
  ...extra
});

export const MODEL_INFORMATION_DEMO: GuidedDemoDefinition = {
  id: MODEL_INFORMATION_DEMO_ID,
  label: 'Calibration and validation',
  description: 'See how a model is configured and how its outputs fit the evidence.',
  duration: 'Six short stops',
  finishOnLastStep: true,
  requiredRunIds: [],
  requiredExperimentIds: [],
  steps: [
    stop('model-setup', 'calibration', 'Understand the model setup', '[data-calibration-demo-target="calibration-primary-model"]', [
      'Calibration explains how the selected model was configured.',
      'Follow the same model from its inputs to its results.'
    ]),
    stop('fitted-parameters', 'calibration', 'Read the fitted parameters', '[data-calibration-demo-target="calibration-fitted-parameters"]', [
      'These five settings describe behaviours such as renting versus buying.',
      'Each parameter explains what its value means.'
    ]),
    stop('other-assumptions', 'calibration', 'Find the other assumptions', '[data-calibration-demo-target="calibration-other-assumptions"][aria-expanded="true"]', [
      'These entries explain the remaining model inputs and their supporting evidence.',
      'Next, open Validation to check the same model’s outputs against evidence.'
    ], { nextLabel: 'Go to validation', scrollOnEnter: 'start' }),
    stop('validation-comparison', 'validation', 'Now in Validation', '[data-model-information-target="validation-comparison"]', [
      'Validation checks model outputs against the selected year’s evidence.',
      'Choose a Comparison model, or select Next to continue with the primary model.'
    ], { interactive: true }),
    stop('validation-summary', 'validation', 'Check the fit to evidence', '[data-model-information-target="validation-summary"]', [
      'You’ve seen the model’s inputs. Now compare its outputs with the selected year’s evidence.',
      'Fit statuses reflect target gaps and consistency across repeated simulations.'
    ]),
    stop('validation-outcome', 'validation', 'Read one outcome', '[data-model-information-target="validation-outcome"]', [
      'Compare the simulated average with the evidence target and target band.',
      'Seeds in band shows consistency across repeated simulations.',
      'Details contains the supporting sources and scoring notes for this outcome.'
    ], {
      interactive: true,
      additionalInteractiveTargets: ['[data-model-information-target="validation-sources"]']
    })
  ],
  completion: { title: 'Ready to explore model information', body: '', bullets: ['Explore the model settings and their fit to evidence.'] }
};

/** Preserve the primary model while retiring the two long tours and their old step IDs. */
export function legacyModelInformationDemoHref(search: URLSearchParams): string | null {
  if (!['model-evidence', 'validation'].includes(search.get('demo') ?? '')) return null;
  const next = modelInformationDemoSearch(search);
  next.set('demo', MODEL_INFORMATION_DEMO_ID);
  next.set('step', MODEL_INFORMATION_DEMO.steps[0].id);
  next.set('view', 'calibration');
  next.set('mode', 'single');
  for (const key of ['tour', 'journey', 'metric']) next.delete(key);
  return `/model-evidence?${next}`;
}

/** Keep the primary model throughout; an optional comparison follows the Validation stops. */
export function modelInformationDemoSearch(search: URLSearchParams, preserveValidationComparison = false): URLSearchParams {
  const next = new URLSearchParams(search);
  const primary = next.get('version')?.trim() || next.get('right')?.trim();
  if (primary) next.set('version', primary);
  for (const key of ['left', 'right']) next.delete(key);
  const comparison = next.get('comparisonVersion')?.trim();
  if (preserveValidationComparison && comparison && comparison !== primary) next.set('comparisonVersion', comparison);
  else next.delete('comparisonVersion');
  return next;
}
