import assert from 'node:assert/strict';
import {
  loadModelInformationValidationContext,
  modelInformationCalibrationVersion
} from '../src/lib/guidedDemos/modelInformationCalibration.js';

assert.equal(modelInformationCalibrationVersion('v0', ['v0', 'v0o7'], 'v0o7'), 'v0');
assert.equal(modelInformationCalibrationVersion('', ['v0', 'v0o7'], 'v0o7'), 'v0o7');
assert.throws(() => modelInformationCalibrationVersion('missing', ['v0', 'v0o7'], 'v0o7'), /unavailable for missing/);

function overview(version: string, year: number, years: Record<string, number[]>) {
  return {
    selectedVersion: version,
    selectedValidationTargetYear: year,
    selectedSummary: { version, validationTargetYear: year },
    availableValidationTargetYearsByVersion: years
  };
}

const exactCalls: [string, number | undefined][] = [];
assert.deepEqual(await loadModelInformationValidationContext('v0', 2011, async (version, year) => {
  exactCalls.push([version, year]);
  return overview('v0', 2011, { v0: [2024, 2011] });
}), { version: 'v0', evidenceYear: 2011 });
assert.deepEqual(exactCalls, [['v0', 2011]]);

const fallbackCalls: [string, number | undefined][] = [];
assert.deepEqual(await loadModelInformationValidationContext('v0', undefined, async (version, year) => {
  fallbackCalls.push([version, year]);
  return year === undefined
    ? overview('v0o7', 2024, { v0: [2011], v0o7: [2024] })
    : overview('v0', 2011, { v0: [2011], v0o7: [2024] });
}), { version: 'v0', evidenceYear: 2011 });
assert.deepEqual(fallbackCalls, [['v0', undefined], ['v0', 2011]]);

let failedDefaultRequests = 0;
await assert.rejects(loadModelInformationValidationContext('v0', undefined, async () => {
  failedDefaultRequests += 1;
  return overview('v0o7', 2024, { v0: [2011], v0o7: [2024] });
}), /unavailable for v0/);
assert.equal(failedDefaultRequests, 2, 'A backend model mismatch allows only one explicit retry.');

let explicitYearRequests = 0;
await assert.rejects(loadModelInformationValidationContext('v0', 2024, async () => {
  explicitYearRequests += 1;
  return overview('v0', 2011, { v0: [2011] });
}), /unavailable for v0 in 2024/);
assert.equal(explicitYearRequests, 1, 'An explicit year cannot silently use different evidence.');

await assert.rejects(loadModelInformationValidationContext('v0', 2011, async () =>
  overview('v0o7', 2011, { v0: [2011], v0o7: [2011] })
), /unavailable for v0 in 2011/);
await assert.rejects(loadModelInformationValidationContext('v0', undefined, async () =>
  overview('v0o7', 2024, { v0o7: [2024] })
), /unavailable for v0/);
await assert.rejects(loadModelInformationValidationContext('v0', 2011, async () => ({
  ...overview('v0', 2011, { v0: [2011] }), selectedSummary: { version: 'v0o7', validationTargetYear: 2011 }
})), /unavailable for v0/);
await assert.rejects(loadModelInformationValidationContext('v0', Number.NaN, async () => {
  assert.fail('Invalid years must be rejected before an API request.');
}), /evidence year is invalid/);

console.log('Model information calibration context checks passed.');
