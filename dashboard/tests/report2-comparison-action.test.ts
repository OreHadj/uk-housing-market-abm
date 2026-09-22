import assert from 'node:assert/strict';
import { Children, isValidElement, type ButtonHTMLAttributes, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ResultsRunSummary } from '../shared/types';
import { getBasePolicyOption } from '../shared/policyCatalogue';
import type { ScenarioDraftV1 } from '../src/lib/scenarioDraft';
import { Report2ComparisonAction } from '../src/pages/report2/Report2ComparisonAction';

function run(runId: string, policyChanged = false, steps = 2_000): ResultsRunSummary {
  return {
    runId, title: runId, path: runId, createdAt: '2026-09-22T12:00:00Z', modifiedAt: '2026-09-22T12:00:00Z',
    sizeBytes: 1, fileCount: 1, status: 'complete', configAvailable: true,
    parseCoverage: { requiredCount: 1, supportedCount: 1, emptyCount: 0, errorCount: 0 },
    policySettings: Object.entries(getBasePolicyOption('2024').values).map(([key, value]) => ({
      key, value: policyChanged && key === 'CENTRAL_BANK_INITIAL_BASE_RATE' ? value + 0.01 : value
    })),
    configuration: { modelVersion: 'v0o7', basePolicy: '2024', maxWorkers: 1, parameterValues: { N_STEPS: steps, N_SIMS: 8 } },
    provenance: { ukHouseholds: 28_400_000, ukDwellings: 30_000_000, dwellingsPerHousehold: 30 / 28.4,
      targetPopulation: 10_000, meanModelHouseholds: 10_000, meanScaleFactor: 2_840,
      nSteps: steps, seeds: [1, 2, 3, 4, 5, 6, 7, 8], seedSource: 'manifest' }
  };
}

function button(node: ReactNode): ReactElement<ButtonHTMLAttributes<HTMLButtonElement>> | null {
  if (!isValidElement<{ children?: ReactNode }>(node)) return null;
  if (node.type === 'button') return node as ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
  return Children.toArray(node.props.children).map(button).find((element) => element !== null) ?? null;
}

const primary = run('Selected policy', true);
const mismatched = run('Shorter baseline', false, 1_000);
const matched = run('Matching baseline');
const drafts: ScenarioDraftV1[] = [];
const selections: string[] = [];
const props = { primary, comparison: mismatched, runs: [mismatched], canWrite: true,
  onUse: (runId: string) => selections.push(runId), onCreate: (draft: ScenarioDraftV1) => drafts.push(draft) };
const original = structuredClone({ primary, mismatched, matched });
const click = (node: ReactNode) => {
  const action = button(node);
  assert.ok(action);
  action.props.onClick?.({} as MouseEvent<HTMLButtonElement>);
};

const create = Report2ComparisonAction(props);
assert.ok(create);
assert.match(renderToStaticMarkup(create), /Create matching run/);
assert.equal(drafts.length, 0, 'Viewing the offer must not create a draft');
click(create);
assert.equal(drafts.length, 1);
assert.equal(drafts[0].calibratedModel, 'v0o7');
assert.equal(drafts[0].basePolicy, '2024');
assert.deepEqual(drafts[0].formValues, { N_STEPS: '2000', N_SIMS: '8' }, 'Copy the selected policy setup, not the mismatched comparison');
assert.deepEqual(drafts[0].lockedParameterKeys, ['N_STEPS', 'N_SIMS']);

const readOnly = Report2ComparisonAction({ ...props, canWrite: false });
assert.equal(button(readOnly)?.props.disabled, true);
click(readOnly);
assert.equal(drafts.length, 1, 'Read-only sessions cannot invoke draft creation');

const legacy = Report2ComparisonAction({ ...props, primary: { ...primary, configuration: undefined } });
assert.equal(button(legacy)?.props.disabled, true);
assert.match(renderToStaticMarkup(legacy!), /Saved setup is incomplete/);
click(legacy);
assert.equal(drafts.length, 1, 'Missing setup must not be guessed');

const useExisting = Report2ComparisonAction({ ...props, runs: [mismatched, matched], canWrite: false });
assert.ok(useExisting);
assert.match(renderToStaticMarkup(useExisting), /Use matching run/);
assert.doesNotMatch(renderToStaticMarkup(useExisting), /Create matching run/);
assert.notEqual(button(useExisting)?.props.disabled, true, 'Reading an existing run needs no write permission');
click(useExisting);
assert.deepEqual(selections, [matched.runId]);
assert.equal(drafts.length, 1, 'Use an existing match without creating another run');

assert.equal(Report2ComparisonAction({ ...props, comparison: matched, runs: [matched] }), null, 'A matched comparison needs no prompt');
assert.equal(Report2ComparisonAction({ ...props, comparison: null, runs: [matched] }), null, 'Respect an explicit choice of no comparison');
assert.ok(Report2ComparisonAction({ ...props, comparison: null }), 'A missing baseline can also be prepared before selecting a comparison');
assert.deepEqual({ primary, mismatched, matched }, original, 'Report actions preserve saved run metadata');

console.log('Policy Report matching-run action checks passed.');
