import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { getCalibrationOverview } from '../server/lib/calibrationOverview.js';
import {
  BehaviouralParameterOriginSection,
  buildCalibrationValidationHref,
  CalibrationValidationGuidance,
  relativeLossImprovement
} from '../src/pages/ComparePage.js';
import type { CalibrationModelOverview } from '../shared/types.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function renderOrigin(model: CalibrationModelOverview): string {
  return renderToStaticMarkup(createElement(
    MemoryRouter,
    { initialEntries: ['/model-evidence?view=calibration'] },
    createElement(BehaviouralParameterOriginSection, {
      model
    })
  ));
}

function renderGuidance(
  primaryVersion: string,
  comparisonVersion = '',
  returnContext?: { source: 'scenario' | 'sensitivity' | ''; draftId: string; returnStep: string }
): string {
  return renderToStaticMarkup(createElement(
    MemoryRouter,
    { initialEntries: ['/model-evidence?view=calibration'] },
    createElement(CalibrationValidationGuidance, { primaryVersion, comparisonVersion, returnContext })
  ));
}

function assertUniversalPresentation(markup: string): void {
  assert.ok(markup.includes('How the behavioural parameters were obtained'));
  assert.ok(markup.includes('Where this model’s five fitted behavioural values came from.'));
  assert.ok(markup.includes('calibration-collapsible is-collapsed calibration-campaign'));
  assert.ok(markup.includes('aria-expanded="false"'));
  assert.ok(!markup.includes('View indicator-level fit'));
  assert.ok(!markup.includes('Calibration campaign'));
  assert.ok(!markup.includes('Why output calibration is necessary'));
  assert.ok(!markup.includes('Not recorded'));
}

const inactiveGuidanceMarkup = renderGuidance('');
assert.ok(inactiveGuidanceMarkup.includes('If you want to see how well the model matches UK evidence, visit the'));
assert.ok(inactiveGuidanceMarkup.includes('<span>validation page</span>'));
assert.ok(!inactiveGuidanceMarkup.includes('<a '), 'Validation guidance should not link before a primary model is selected');

const singleValidationHref = buildCalibrationValidationHref('v5o3');
assert.equal(singleValidationHref, '/model-evidence?view=validation&version=v5o3');
const singleGuidanceMarkup = renderGuidance('v5o3');
assert.match(singleGuidanceMarkup, /visit the <a href="\/model-evidence\?view=validation&amp;version=v5o3">validation page<\/a>\.<\/p>/);
assert.equal(singleGuidanceMarkup.match(/<a /g)?.length, 1, 'Only “validation page” should be linked');
assert.ok(!singleGuidanceMarkup.includes('evidenceYear'));

assert.equal(
  buildCalibrationValidationHref('v5o3', 'v4.26'),
  '/model-evidence?view=validation&version=v5o3&comparisonVersion=v4.26'
);
const comparisonGuidanceMarkup = renderGuidance('v5o3', 'v4.26');
assert.ok(comparisonGuidanceMarkup.includes('version=v5o3&amp;comparisonVersion=v4.26'));

assert.equal(
  buildCalibrationValidationHref('v5o3', '', {
    source: 'scenario',
    draftId: 'scenario draft',
    returnStep: 'model-version'
  }),
  '/model-evidence?view=validation&version=v5o3&from=scenario&draft=scenario+draft&scenarioStep=model-version'
);
assert.equal(
  buildCalibrationValidationHref('v4.26', 'v0', {
    source: 'sensitivity',
    draftId: 'sensitivity-draft',
    returnStep: 'model-baseline'
  }),
  '/model-evidence?view=validation&version=v4.26&comparisonVersion=v0&from=sensitivity&draft=sensitivity-draft&sensitivityStep=model-baseline'
);

const original = getCalibrationOverview(repoRoot, 'v0').primary;
assert.equal(original.campaign.kind, 'original');
if (original.campaign.kind !== 'original') throw new Error('Expected original campaign');
assert.equal(original.campaign.evidenceYear, 2011);
assert.equal(original.campaign.status, 'Original published configuration');
assert.match(original.campaign.method, /simulated method of moments/i);
assert.ok(original.campaign.provenance.length > 0);
assert.equal('baselineLoss' in original.campaign, false);
const originalMarkup = renderOrigin(original);
assertUniversalPresentation(originalMarkup);
assert.ok(originalMarkup.includes('original published') && originalMarkup.includes('Original published configuration'));
assert.ok(originalMarkup.includes('Original calibration method'));
assert.ok(originalMarkup.includes('Available provenance') && originalMarkup.includes('2 source records'));
assert.ok(!originalMarkup.includes('Validation loss') && !originalMarkup.includes('Optimiser configuration'));

const refitted2011 = getCalibrationOverview(repoRoot, 'v0o7').primary;
assert.equal(refitted2011.campaign.kind, 'refitted');
if (refitted2011.campaign.kind !== 'refitted') throw new Error('Expected refitted v0o7 campaign');
assert.equal(refitted2011.campaign.startingVersion, 'v0');
assert.equal(refitted2011.campaign.evidenceYear, 2011);
assert.equal(refitted2011.campaign.tunedParameterCount, 5);
assert.equal(refitted2011.campaign.targetOutcomeCount, 20);
assert.equal(refitted2011.campaign.passedChecks, true);
assert.equal(refitted2011.campaign.selected, true);
const refitted2011Markup = renderOrigin(refitted2011);
assertUniversalPresentation(refitted2011Markup);
assert.ok(refitted2011Markup.includes('0.5652 → 0.5212 · 7.8% lower'));
assert.ok(refitted2011Markup.includes('Selected after passing the house-price guardrail'));
assert.ok(refitted2011Markup.includes('Optimiser settings and provenance'));
assert.ok(refitted2011Markup.includes('Calibration artifact'));
assert.ok(!refitted2011Markup.includes('Credit and lending'), 'Target-theme details should stay on Validation');
assert.ok(!refitted2011Markup.includes('>Seeds<') && !refitted2011Markup.includes('Simulation length'));

const inherited = getCalibrationOverview(repoRoot, 'v4.26').primary;
assert.equal(inherited.campaign.kind, 'inherited');
if (inherited.campaign.kind !== 'inherited') throw new Error('Expected inherited v4.26 record');
assert.equal(inherited.campaign.sourceVersion, 'v0');
assert.equal(inherited.campaign.evidenceYear, 2011);
assert.equal(inherited.campaign.parametersUnchanged, true);
assert.equal('baselineLoss' in inherited.campaign, false);
const inheritedMarkup = renderOrigin(inherited);
assertUniversalPresentation(inheritedMarkup);
assert.ok(inheritedMarkup.includes('No new behavioural calibration was run for this model.'));
assert.ok(inheritedMarkup.includes('inherited unchanged'));
assert.ok(!inheritedMarkup.includes('Validation loss') && !inheritedMarkup.includes('Optimiser configuration'));

const refitted2024 = getCalibrationOverview(repoRoot, 'v5o3').primary;
assert.equal(refitted2024.campaign.kind, 'refitted');
if (refitted2024.campaign.kind !== 'refitted') throw new Error('Expected refitted v5o3 campaign');
assert.equal(refitted2024.campaign.startingVersion, 'v4.26');
assert.equal(refitted2024.campaign.evidenceYear, 2024);
assert.equal(refitted2024.campaign.tunedParameterCount, 5);
assert.equal(refitted2024.campaign.targetOutcomeCount, 20);
assert.equal(refitted2024.campaign.passedChecks, true);
assert.equal(refitted2024.campaign.selected, true);
const refitted2024Markup = renderOrigin(refitted2024);
assertUniversalPresentation(refitted2024Markup);
assert.ok(refitted2024Markup.includes('0.6137 → 0.5864 · 4.4% lower'));
assert.ok(refitted2024Markup.includes('v4.26'));
assert.ok(refitted2024Markup.includes('20 outcome targets'));

const intermediate = getCalibrationOverview(repoRoot, 'v4.19').primary;
assert.equal(intermediate.campaign.kind, 'unavailable');
assert.ok(intermediate.campaign.provenance.includes('v4.19/config.properties'));
const intermediateMarkup = renderOrigin(intermediate);
assertUniversalPresentation(intermediateMarkup);
assert.ok(intermediateMarkup.includes('A detailed behavioural-calibration record is not available for this model version.'));
assert.ok(!intermediateMarkup.includes('campaign-grid'));

const comparison = getCalibrationOverview(repoRoot, 'v5o3', 'v4.26');
assert.equal(comparison.primary.campaign.kind, 'refitted');
assert.equal(comparison.comparison?.campaign.kind, 'inherited');
assert.equal(comparison.sameEvidenceProfile, false);

assert.ok(Math.abs((relativeLossImprovement(0.6137234580996009, 0.5864457551658543) ?? 0) - 4.444624) < 0.000001);
assert.equal(relativeLossImprovement(0, 0), null);
assert.equal(relativeLossImprovement(-1, 0.5), null);
assert.equal(relativeLossImprovement(Number.POSITIVE_INFINITY, 0.5), null);
assert.equal(relativeLossImprovement(1, Number.NaN), null);

const missingArtifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'calibration-overview-missing-'));
try {
  const fixtureDataRoot = path.join(missingArtifactRoot, 'input-data-versions');
  const fixtureVersionRoot = path.join(fixtureDataRoot, 'v5o3');
  fs.mkdirSync(fixtureVersionRoot, { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, 'input-data-versions', 'v5o3', 'config.properties'),
    path.join(fixtureVersionRoot, 'config.properties')
  );
  fs.writeFileSync(path.join(fixtureDataRoot, 'CALIBRATION_PARAMETER_CHANGELOG.md'), 'Fixture provenance only.\n');

  const missingArtifact = getCalibrationOverview(missingArtifactRoot, 'v5o3').primary;
  assert.equal(missingArtifact.campaign.kind, 'unavailable');
  assert.ok(missingArtifact.campaign.provenance.includes('v5o3/config.properties'));
  assert.equal('baselineLoss' in missingArtifact.campaign, false);
  const missingArtifactMarkup = renderOrigin(missingArtifact);
  assertUniversalPresentation(missingArtifactMarkup);
  assert.ok(missingArtifactMarkup.includes('A detailed behavioural-calibration record is not available for this model version.'));
  assert.ok(!missingArtifactMarkup.includes('Validation loss') && !missingArtifactMarkup.includes('Optimiser configuration'));
} finally {
  fs.rmSync(missingArtifactRoot, { recursive: true, force: true });
}

console.log('Calibration overview provenance tests passed.');
