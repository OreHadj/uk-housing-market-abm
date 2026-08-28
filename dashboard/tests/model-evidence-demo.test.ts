import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  clearCombinedModelEvidenceDemoProgress,
  completeModelEvidenceCalibration,
  completeModelEvidenceValidation,
  createModelEvidenceDemoProgress,
  buildModelEvidenceCalibrationUrl,
  buildModelEvidenceValidationUrl,
  isMatchingModelEvidenceCompletion,
  isModelEvidenceDemoRequested,
  MODEL_EVIDENCE_CALIBRATION_COMPLETION_EVENT,
  MODEL_EVIDENCE_CALIBRATION_SESSION_KEY,
  MODEL_EVIDENCE_DEMO_COMPLETION_EVENT,
  MODEL_EVIDENCE_DEMO_LAUNCH_HREF,
  MODEL_EVIDENCE_DEMO_QUERY_VALUE,
  MODEL_EVIDENCE_DEMO_SESSION_KEY,
  MODEL_EVIDENCE_VALIDATION_SESSION_KEY,
  parseModelEvidenceDemoProgress
} from '../src/lib/modelEvidenceDemo.js';
import {
  isValidationDemoRequested,
  VALIDATION_DEMO_QUERY_VALUE,
  VALIDATION_DEMO_SESSION_KEY
} from '../src/components/ValidationDemoPrototype.js';
import { DEMO_CHOICES } from '../src/pages/HomePage.js';
import { buildCalibrationValidationHref } from '../src/pages/ComparePage.js';

assert.equal(MODEL_EVIDENCE_DEMO_QUERY_VALUE, 'model-evidence');
assert.equal(MODEL_EVIDENCE_DEMO_SESSION_KEY, 'model-evidence-demo-progress-v1');
assert.equal(MODEL_EVIDENCE_CALIBRATION_SESSION_KEY, 'model-evidence-calibration-progress-v1');
assert.equal(MODEL_EVIDENCE_VALIDATION_SESSION_KEY, 'model-evidence-validation-progress-v1');
assert.equal(MODEL_EVIDENCE_CALIBRATION_COMPLETION_EVENT, 'model-evidence-calibration:complete');
assert.equal(MODEL_EVIDENCE_DEMO_COMPLETION_EVENT, 'model-evidence-demo:complete');
assert.equal(
  MODEL_EVIDENCE_DEMO_LAUNCH_HREF,
  '/model-evidence?view=calibration&demo=model-evidence&mode=single'
);
assert.equal(
  DEMO_CHOICES.find((choice) => choice.label === 'Run model evidence demo')?.to,
  MODEL_EVIDENCE_DEMO_LAUNCH_HREF
);
assert.equal(DEMO_CHOICES.filter((choice) => choice.to === null).length, 2);
for (const disabledChoice of ['Run full demo', 'Run results demo']) {
  assert.equal(DEMO_CHOICES.find((choice) => choice.label === disabledChoice)?.to, null);
}

assert.equal(
  isModelEvidenceDemoRequested(new URLSearchParams('view=calibration&demo=model-evidence')),
  true
);
assert.equal(isModelEvidenceDemoRequested(new URLSearchParams('demo=validation')), false);
assert.equal(isValidationDemoRequested(new URLSearchParams('demo=validation')), true);
assert.equal(isValidationDemoRequested(new URLSearchParams('demo=model-evidence')), false);
assert.equal(VALIDATION_DEMO_QUERY_VALUE, 'validation');
assert.notEqual(MODEL_EVIDENCE_VALIDATION_SESSION_KEY, VALIDATION_DEMO_SESSION_KEY);

const fresh = createModelEvidenceDemoProgress('journey-1');
assert.deepEqual(fresh, {
  version: 1,
  journeyId: 'journey-1',
  phase: 'calibration',
  calibrationPrimaryVersion: '',
  calibrationComparisonVersion: '',
  calibrationComplete: false,
  validationStarted: false
});
assert.deepEqual(parseModelEvidenceDemoProgress(JSON.stringify(fresh)), fresh);
assert.equal(parseModelEvidenceDemoProgress('{broken'), null);
assert.equal(parseModelEvidenceDemoProgress(JSON.stringify({ ...fresh, version: 2 })), null);
assert.equal(parseModelEvidenceDemoProgress(JSON.stringify({
  ...fresh,
  phase: 'validation',
  validationStarted: true
})), null, 'Validation cannot resume before Calibration has a valid completed pair');
assert.equal(parseModelEvidenceDemoProgress(JSON.stringify({
  ...fresh,
  phase: 'calibration-review',
  calibrationComplete: true,
  calibrationPrimaryVersion: 'v5o3',
  calibrationComparisonVersion: 'v5o3'
})), null, 'A completed Calibration pair must contain two different models');

const calibrationDetail = {
  demo: MODEL_EVIDENCE_DEMO_QUERY_VALUE,
  journeyId: 'journey-1',
  phase: 'calibration' as const,
  primaryVersion: 'v5o3',
  comparisonVersion: 'v4.26'
};
assert.equal(isMatchingModelEvidenceCompletion(fresh, calibrationDetail, 'calibration'), true);
const calibrationComplete = completeModelEvidenceCalibration(fresh, calibrationDetail);
assert.equal(calibrationComplete.phase, 'calibration-review');
assert.equal(calibrationComplete.calibrationComplete, true);
assert.equal(calibrationComplete.calibrationPrimaryVersion, 'v5o3');
assert.equal(calibrationComplete.calibrationComparisonVersion, 'v4.26');
assert.equal(
  completeModelEvidenceCalibration(calibrationComplete, calibrationDetail),
  calibrationComplete,
  'A duplicate Calibration completion event must be ignored'
);
for (const invalidDetail of [
  { ...calibrationDetail, journeyId: 'stale-journey' },
  { ...calibrationDetail, demo: 'validation' },
  { ...calibrationDetail, phase: 'validation' },
  { ...calibrationDetail, comparisonVersion: 'v5o3' }
]) {
  assert.equal(completeModelEvidenceCalibration(fresh, invalidDetail), fresh);
}

const validationActive = {
  ...calibrationComplete,
  phase: 'validation' as const,
  validationStarted: true
};
const validationDetail = {
  demo: MODEL_EVIDENCE_DEMO_QUERY_VALUE,
  journeyId: 'journey-1',
  phase: 'validation' as const
};
assert.equal(isMatchingModelEvidenceCompletion(validationActive, validationDetail, 'validation'), true);
const overallComplete = completeModelEvidenceValidation(validationActive, validationDetail);
assert.equal(overallComplete.phase, 'complete');
assert.equal(completeModelEvidenceValidation(overallComplete, validationDetail), overallComplete);
assert.equal(
  completeModelEvidenceValidation(validationActive, { ...validationDetail, journeyId: 'stale' }),
  validationActive
);

const calibrationUrl = new URL(
  buildModelEvidenceCalibrationUrl('v5o3', 'v4.26'),
  'http://dashboard.local'
);
assert.equal(calibrationUrl.pathname, '/model-evidence');
assert.deepEqual([...calibrationUrl.searchParams.keys()], ['view', 'demo', 'mode', 'right', 'left']);
assert.equal(calibrationUrl.searchParams.get('view'), 'calibration');
assert.equal(calibrationUrl.searchParams.get('demo'), 'model-evidence');
assert.equal(calibrationUrl.searchParams.get('mode'), 'compare');
assert.equal(calibrationUrl.searchParams.get('right'), 'v5o3');
assert.equal(calibrationUrl.searchParams.get('left'), 'v4.26');

const validationUrl = new URL(buildModelEvidenceValidationUrl('v5o3'), 'http://dashboard.local');
assert.deepEqual([...validationUrl.searchParams.keys()], ['view', 'demo', 'version']);
assert.equal(validationUrl.searchParams.get('view'), 'validation');
assert.equal(validationUrl.searchParams.get('demo'), 'model-evidence');
assert.equal(validationUrl.searchParams.get('version'), 'v5o3');
for (const forbidden of ['comparisonVersion', 'mode', 'left', 'right', 'from', 'draft', 'scenarioStep', 'sensitivityStep']) {
  assert.equal(validationUrl.searchParams.has(forbidden), false, `${forbidden} must not leak across phases`);
}

assert.equal(
  buildCalibrationValidationHref('v5o3', 'v4.26'),
  '/model-evidence?view=validation&version=v5o3&comparisonVersion=v4.26',
  'Ordinary Calibration-to-Validation navigation should retain both selected models'
);

const homeSource = fs.readFileSync(new URL('../src/pages/HomePage.tsx', import.meta.url), 'utf8');
const coordinatorSource = fs.readFileSync(new URL('../src/pages/ModelEvidencePage.tsx', import.meta.url), 'utf8');
const validationPageSource = fs.readFileSync(new URL('../src/pages/ValidationPage.tsx', import.meta.url), 'utf8');
const validationDemoSource = fs.readFileSync(new URL('../src/components/ValidationDemoPrototype.tsx', import.meta.url), 'utf8');
assert.ok(homeSource.includes('MODEL_EVIDENCE_DEMO_LAUNCH_HREF'));
assert.ok(coordinatorSource.includes('completeModelEvidenceCalibration'));
assert.ok(coordinatorSource.includes('completeModelEvidenceValidation'));
assert.ok(coordinatorSource.includes('clearModelEvidenceDemoChildProgress(MODEL_EVIDENCE_VALIDATION_SESSION_KEY)'));
assert.ok(coordinatorSource.includes("phase: 'calibration-review' as const"));
assert.ok(coordinatorSource.includes('onPurposeBack: returnToCalibrationReview'));
assert.ok(validationPageSource.includes('Model evidence demo · Validation · Part 2 of 2'));
assert.ok(validationPageSource.includes('Back to Calibration'));
assert.ok(validationPageSource.includes('Finish and inspect Validation'));
assert.ok(validationPageSource.includes('MODEL_EVIDENCE_VALIDATION_SESSION_KEY'));
assert.ok(validationDemoSource.includes('progressStorageKey = VALIDATION_DEMO_SESSION_KEY'));
assert.ok(validationDemoSource.includes('completionEventName = VALIDATION_DEMO_COMPLETION_EVENT'));
assert.ok(validationPageSource.includes('left=${encodeURIComponent(comparisonVersion)}&right=${encodeURIComponent(selectedVersion)}'));
assert.equal(validationPageSource.includes('left=${encodeURIComponent(selectedVersion)}&right=${encodeURIComponent(comparisonVersion)}'), false);

void clearCombinedModelEvidenceDemoProgress;
console.log('Combined Model evidence demo coordinator tests passed.');
