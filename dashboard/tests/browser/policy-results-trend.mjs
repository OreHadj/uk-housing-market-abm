// Verify against an existing dev server with bundled examples. No application writes are allowed.
/* global document, innerWidth */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { URL, URLSearchParams } from 'node:url';

const { values } = parseArgs({ options: {
  base: { type: 'string', default: 'http://127.0.0.1:5421' },
  playwright: { type: 'string', default: 'playwright' },
  executable: { type: 'string' },
  output: { type: 'string', default: '../output/policy-results-trend' },
  widths: { type: 'string', default: '1440,800,390' }
} });
const { chromium } = createRequire(import.meta.url)(values.playwright);
const browser = await chromium.launch({ headless: true, executablePath: values.executable });
await fs.mkdir(values.output, { recursive: true });
const params = new URLSearchParams({
  demo: 'policy-results', step: 'investigate', type: 'manual', presentation: 'detailed',
  baselineRunId: 'Example Bank Rate raised by 1 pp v0o7',
  comparisonRunId: 'Example 2024 policy, unchanged v0o7'
});
const results = '.manual-results-aggregate-card';
const resultsToggle = `${results} > .collapsible-section-toggle`;
const creditToggle = '#policy-results-credit_access .policy-results-group-toggle';
const mortgageTrend = '#policy-results-credit_access [data-guided-target="policy-mortgage-approvals-trend"]';
const history = '.run-history-card > .collapsible-section-toggle';

async function keyboardActivate(page, control) {
  for (let index = 0; index < 60; index++) {
    if (await control.evaluate((element) => element === document.activeElement)) {
      await page.keyboard.press('Enter');
      return;
    }
    await page.keyboard.press('Tab');
  }
  assert.fail('The highlighted control must be reachable by keyboard');
}

async function inspect(page, width, stage, target, step = 'investigate') {
  await page.locator(`[data-guided-tour-step="${step}"][data-guided-tour-target-state="ready"]`).waitFor();
  await page.waitForTimeout(500);
  const coach = page.locator('.guided-tour-coach');
  assert.match(await coach.innerText(), step === 'run-history' ? /10 of 10/i : /9 of 10/i);
  assert.ok(await coach.locator('.guided-tour-body li').count() >= 2);
  assert.doesNotMatch(await coach.locator('.guided-tour-body').innerText(), /[;:→←↔]/);
  const geometry = await page.evaluate((selector) => {
    const coach = document.querySelector('.guided-tour-coach').getBoundingClientRect();
    const target = document.querySelector(selector).getBoundingClientRect();
    return {
      top: coach.top, bottom: coach.bottom,
      overlap: Math.max(0, Math.min(target.right, coach.right) - Math.max(target.left, coach.left))
        * Math.max(0, Math.min(target.bottom, coach.bottom) - Math.max(target.top, coach.top)),
      overflow: document.documentElement.scrollWidth > innerWidth + 1
    };
  }, target);
  await page.screenshot({ path: path.join(values.output, `${width}-${stage}.png`) });
  assert.equal(geometry.overflow, false, `${stage} fits the page width`);
  assert.ok(geometry.top >= 0 && geometry.bottom <= 901, `${stage} coach fits the viewport`);
  if (width >= 800) assert.equal(geometry.overlap, 0, `${stage} coach leaves its target visible`);
  if (target === '.trend-modal') {
    const chart = await page.locator('.trend-modal-chart').boundingBox();
    const modal = await page.locator('.trend-modal').boundingBox();
    assert.ok(chart && modal, 'The actual trend is available');
    assert.ok(chart.y >= modal.y && chart.y + chart.height <= modal.y + modal.height, 'The full plot and its axes fit inside the visible modal');
    assert.ok(chart.y + chart.height <= geometry.top || chart.y >= geometry.bottom, 'Instructions leave the whole plot visible');
  }
}

try {
  for (const width of values.widths.split(',').map(Number)) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const errors = [], writes = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', (route) => {
      if (['GET', 'HEAD'].includes(route.request().method())) return route.continue();
      writes.push(route.request().url());
      return route.abort();
    });
    const state = () => new URL(page.url()).searchParams;
    const coach = page.locator('.guided-tour-coach');
    const next = coach.getByRole('button', { name: 'Next', exact: true });
    const finish = coach.getByRole('button', { name: 'Finish', exact: true });
    await page.goto(`${values.base}/results?${params}`, { waitUntil: 'networkidle' });
    await inspect(page, width, 'policy-results-closed', resultsToggle);
    assert.equal(await next.isDisabled(), true);
    assert.equal(await coach.getByRole('button', { name: 'Exit', exact: true }).count(), 0);
    assert.match(await coach.innerText(), /Open Policy results, then Credit access/);
    await keyboardActivate(page, page.locator(resultsToggle));
    await inspect(page, width, 'policy-results-open', creditToggle);
    await page.reload({ waitUntil: 'networkidle' });
    await inspect(page, width, 'policy-results-restored', creditToggle);
    assert.equal(state().get('policyResults'), 'open');
    await keyboardActivate(page, page.locator(creditToggle));
    await inspect(page, width, 'credit-access-open', mortgageTrend);
    assert.equal(await page.locator(creditToggle).getAttribute('aria-expanded'), 'true');
    assert.equal(await next.isDisabled(), true);
    await keyboardActivate(page, page.locator(mortgageTrend));
    await inspect(page, width, 'trend', '.trend-modal');
    const indicator = state().get('policyTrend');
    const title = await page.locator('#trend-modal-title').innerText();
    assert.equal(indicator, 'core_mortgageApprovals');
    assert.match(title, /Mortgage approvals/i);
    assert.equal(await next.isEnabled(), true);
    assert.match(await coach.innerText(), /Next, find Run History below Policy results/);
    await page.reload({ waitUntil: 'networkidle' });
    await inspect(page, width, 'trend-restored', '.trend-modal');
    assert.equal(state().get('policyTrend'), indicator);
    assert.equal(await page.locator('#trend-modal-title').innerText(), title);
    assert.equal(await page.locator('.trend-modal-chart canvas').count(), 1, 'The restored indicator renders its actual trend');
    assert.equal(await next.isEnabled(), true);
    await keyboardActivate(page, page.getByRole('button', { name: 'Close trend chart', exact: true }));
    await inspect(page, width, 'trend-closed', creditToggle);
    assert.equal(await next.isDisabled(), true);
    assert.equal(state().has('policyTrend'), false);
    await keyboardActivate(page, page.locator(creditToggle));
    await keyboardActivate(page, page.locator(mortgageTrend));
    await inspect(page, width, 'trend-reopened', '.trend-modal');
    await keyboardActivate(page, next);
    await inspect(page, width, 'run-history', history, 'run-history');
    assert.equal(state().get('policyTrend'), '');
    assert.equal(await page.locator('.trend-modal').count(), 0, 'The trend closes before Run History is shown');
    assert.match(await coach.innerText(), /Open it later to revisit results and manage eligible runs/);
    assert.equal(await page.locator(history).getAttribute('aria-expanded'), 'false', 'The final lesson does not open Run History');
    assert.equal(await finish.isEnabled(), true);
    await keyboardActivate(page, finish);
    await coach.waitFor({ state: 'detached' });
    assert.equal(state().has('demo'), false);
    assert.equal(state().has('policyTrend'), false);
    assert.equal(state().get('presentation'), 'detailed');
    assert.equal(await page.locator(history).count(), 1, 'Run History remains below the results');
    assert.equal(await page.locator(resultsToggle).getAttribute('aria-expanded'), 'true');

    // Escape exits the guide once and leaves the restored chart ready to explore.
    const resumed = new URLSearchParams(params);
    resumed.set('policyResults', 'open');
    resumed.set('policyTrend', indicator);
    await page.goto(`${values.base}/results?${resumed}`, { waitUntil: 'networkidle' });
    await inspect(page, width, 'resumed-trend', '.trend-modal');
    await page.keyboard.press('Escape');
    await coach.waitFor({ state: 'detached' });
    assert.equal(state().has('demo'), false);
    assert.equal(await page.locator('.trend-modal-close').evaluate((element) => element === document.activeElement), true);
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    await page.close();
  }
} finally {
  await browser.close();
}
