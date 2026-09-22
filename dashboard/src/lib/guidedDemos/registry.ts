import { POLICY_RESULTS_DEMO } from './policyResults';
import { SENSITIVITY_RESULTS_DEMO } from './sensitivityResults';
import { DASHBOARD_OVERVIEW_DEMO } from './dashboardOverview';
import { MODEL_INFORMATION_DEMO, modelInformationDemoSearch } from './modelInformation';
import type { GuidedCompletionCheck, GuidedDemoDefinition, GuidedDemoId } from './types';

/** Only approved, implemented demos are registered. */
export const GUIDED_DEMOS: readonly GuidedDemoDefinition[] = [DASHBOARD_OVERVIEW_DEMO, POLICY_RESULTS_DEMO, SENSITIVITY_RESULTS_DEMO, MODEL_INFORMATION_DEMO];
export const GUIDED_COMPLETE_STEP = 'complete';

export function guidedDemoState(search: URLSearchParams) {
  const definition = GUIDED_DEMOS.find((demo) => demo.id === search.get('demo'));
  if (!definition) return null;
  // Resume retired stops at the final remaining step, including its Back action.
  const requestedStep = search.get('step');
  const stepId = definition.id === 'policy-results' && requestedStep === GUIDED_COMPLETE_STEP
    ? definition.steps[definition.steps.length - 1].id
    : definition.id === 'model-information' && requestedStep === 'validation-sources' ? 'validation-outcome' : requestedStep;
  const completed = stepId === GUIDED_COMPLETE_STEP;
  const index = completed ? definition.steps.length : Math.max(0, definition.steps.findIndex((step) => step.id === stepId));
  return { definition, index, completed, step: definition.steps[Math.min(index, definition.steps.length - 1)] };
}

export function buildGuidedDemoHref(id: GuidedDemoId, index = 0, current = new URLSearchParams(), restore = false): string {
  const definition = GUIDED_DEMOS.find((demo) => demo.id === id);
  if (!definition) throw new Error(`Demo is not available: ${id}`);
  const clamped = Math.max(0, Math.min(index, definition.steps.length));
  const step = definition.steps[Math.min(clamped, definition.steps.length - 1)];
  const next = id === 'model-information'
    ? modelInformationDemoSearch(current, step.query.view === 'validation' && current.get('demo') === id)
    : new URLSearchParams(current);
  for (const key of ['tour', 'mode', 'segment', 'draft', 'draftId', 'jobRef', 'queue']) next.delete(key);
  for (const [key, value] of Object.entries(step.query)) {
    // Page controls survive reload/history restoration, including a completed action.
    if (restore && (step.restoreQueryKeys ?? ['indicator', 'outcome', 'setting', 'presentation', 'measure', 'sensitivityResults']).includes(key) && next.has(key)) continue;
    next.set(key, value);
  }
  next.set('demo', id);
  next.set('step', clamped === definition.steps.length ? GUIDED_COMPLETE_STEP : step.id);
  return `${step.path}?${next}`;
}

export function guidedDemoExitHref(pathname: string, search: URLSearchParams): string {
  const next = new URLSearchParams(search);
  if (search.get('demo') === 'policy-results') next.delete('policyTrend');
  for (const key of ['demo', 'step', 'tour', 'from', 'journey']) next.delete(key);
  return `${pathname}${next.size ? `?${next}` : ''}`;
}

export function isGuidedActionComplete(check: GuidedCompletionCheck | undefined, search: URLSearchParams, root?: Pick<Document, 'querySelector'>): boolean {
  if (!check) return false;
  return check.kind === 'query' ? search.get(check.key) === check.value : Boolean(root?.querySelector(check.selector));
}

export function hasGuidedDemoExamples(definition: GuidedDemoDefinition, runIds: readonly string[], experimentIds: readonly string[]): boolean {
  return definition.requiredRunIds.every((id) => runIds.includes(id)) && definition.requiredExperimentIds.every((id) => experimentIds.includes(id));
}
