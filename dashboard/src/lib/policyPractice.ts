import type { ModelRunParameterDefinition } from '../../shared/types';
import type { FormValue } from './experimentRunDefaults';

export const POLICY_PRACTICE_SETTINGS = {
  households: 1000,
  months: 600,
  seeds: 1,
  recordFrom: 500
} as const;

/** Initial values for a new practice draft; callers must preserve an existing draft. */
export function applyPolicyPracticeDefaults(
  parameters: readonly ModelRunParameterDefinition[],
  values: Record<string, FormValue>
): Record<string, FormValue> {
  const next = { ...values };
  const preset: Record<string, number> = {
    TARGET_POPULATION: POLICY_PRACTICE_SETTINGS.households,
    N_STEPS: POLICY_PRACTICE_SETTINGS.months,
    N_SIMS: POLICY_PRACTICE_SETTINGS.seeds,
    TIME_TO_START_RECORDING_TRANSACTIONS: POLICY_PRACTICE_SETTINGS.recordFrom
  };
  for (const parameter of parameters) {
    if (parameter.group !== 'General model control') continue;
    if (Object.hasOwn(preset, parameter.key)) next[parameter.key] = String(preset[parameter.key]);
    if (parameter.type === 'boolean' && parameter.key.startsWith('record')) {
      next[parameter.key] = parameter.key === 'recordCoreIndicators' || parameter.key === 'recordTransactions';
    }
  }
  return next;
}

/** Keep the full random identity: a display-name collision must never replace another run. */
export function policyPracticeRunTitle(title: string, journeyOrDraftId: string): string {
  const id = journeyOrDraftId.trim();
  if (!id) throw new Error('A practice journey or draft ID is required.');
  const uuid = id.match(/(?:^|-)([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i)?.[1];
  // Older/non-UUID browser fallbacks retain their complete identity as a filesystem-safe token.
  const fallback = id.replace(/^experiment-demo-(?:policy-v2-|sensitivity-v2-)?/, '');
  const identity = uuid?.toLowerCase() ?? encodeURIComponent(fallback).replace(/[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const suffix = ` [${identity}]`;
  const prefix = 'Practice ';
  const available = 120 - prefix.length - suffix.length;
  if (available < 1) throw new Error('The practice identity is too long for a unique run title.');
  const cleanTitle = title.replace(/[<>:"/\\|?*]/g, ' ')
    // Control characters cannot appear in the run's Windows folder name.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/\.+$/g, '').trim() || 'Policy run';
  return `${prefix}${cleanTitle.slice(0, available).trimEnd()}${suffix}`;
}
