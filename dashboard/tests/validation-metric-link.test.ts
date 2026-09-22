import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readValidationMetricLink, validationMetricLinkKey } from '../src/lib/validationMetricLink';

const metrics = ['core_mortgageApprovals', 'core_debtToIncome'];
const query = new URLSearchParams('view=validation&version=v0o7&evidenceYear=2011&metric=core_mortgageApprovals&demo=model-information&step=trace&journey=preserve');
const original = query.toString();
assert.equal(readValidationMetricLink(query, metrics), 'core_mortgageApprovals');
assert.equal(query.toString(), original, 'Reading a metric link preserves guide and evidence parameters');
assert.equal(readValidationMetricLink(new URLSearchParams(), metrics), null);
assert.equal(readValidationMetricLink(new URLSearchParams('metric='), metrics), null);
assert.equal(readValidationMetricLink(new URLSearchParams('metric=missing'), metrics), null);
assert.equal(readValidationMetricLink(query, []), null, 'A metric link waits for the selected evidence to load');
assert.equal(readValidationMetricLink(new URLSearchParams('metric=%20core_debtToIncome%20'), metrics), 'core_debtToIncome');
assert.notEqual(validationMetricLinkKey(metrics[0], 'v0o7', 2011), validationMetricLinkKey(metrics[0], 'v0o7', 2024));
assert.notEqual(validationMetricLinkKey(metrics[0], 'v0o7', 2011), validationMetricLinkKey(metrics[0], 'v0', 2011));
assert.notEqual(validationMetricLinkKey(metrics[0], 'v0o7', 2011), validationMetricLinkKey(metrics[1], 'v0o7', 2011));
assert.equal(validationMetricLinkKey(metrics[0], 'v0o7', 2011), validationMetricLinkKey(metrics[0], 'v0o7', 2011), 'Unrelated query changes do not reopen a closed metric');

const page = fs.readFileSync(new URL('../src/pages/ValidationPage.tsx', import.meta.url), 'utf8');
assert.match(page, /openMetricDiagnostic\(linkedMetricId, \{ openDetails: false \}\)/, 'A metric link only reveals the row; Details is still a real action');
assert.match(page, /setPendingMetricDiagnosticOpenDetails\(options.openDetails \?\? true\)/, 'Existing diagnostic buttons retain automatic Details opening');
assert.match(page, /if \(pendingMetricDiagnosticOpenDetails && trigger.getAttribute\('aria-expanded'\) !== 'true'\) trigger.click\(\)/, 'Reveal-only navigation cannot click Details');
assert.match(page, /if \(appliedMetricLinkRef.current === key\) return;/, 'Closing Details is not undone by the persistent query');
assert.match(page, /summary.version !== selectedVersion \|\| summary.validationTargetYear !== selectedValidationTargetYear/, 'Deep links wait for matching model/evidence data');
assert.match(page, /data-guided-target="validation-metric-details"/);
assert.match(page, /data-guided-metric=\{detail.metric.metricId\}/);
assert.match(page, /data-guided-target=\{`validation-metric-\$\{metric.metricId\}`\}/);
console.log('Validation metric deep-link tests passed.');
