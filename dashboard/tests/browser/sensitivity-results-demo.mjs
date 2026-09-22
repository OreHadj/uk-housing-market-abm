// Run against an existing dev server. Playwright and Chromium may be supplied through CLI options.
// Application writes are blocked or answered by isolated submission mocks.
/* global document, innerWidth, console */
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
  output: { type: 'string', default: '../output/sensitivity-results-walkthrough' },
  widths: { type: 'string', default: '1440,800,390' },
  checks: { type: 'string', default: 'all' }
} });
const { chromium } = createRequire(import.meta.url)(values.playwright);
const browser = await chromium.launch({ headless: true, executablePath: values.executable });
const experimentId = 'sensitivity-20260921T215211Z-f1c9432c';
const savedExperiment = JSON.parse(await fs.readFile(new URL(`../../demo-examples/sensitivity/${experimentId}/metadata.json`, import.meta.url), 'utf8'));
const base = values.base;
const steps = [
  ['results-section', '.sidebar-type-navigation[aria-label="Results type"]'],
  ['baseline', '[data-guided-target="sensitivity-context"]'],
  ['response', '[data-guided-target="sensitivity-response"]'],
  ['pairing', '[data-guided-target="sensitivity-pairing"]'],
  ['outcome', '[data-guided-target="sensitivity-outcome"]'],
  ['setting', '[data-guided-target="sensitivity-setting"]'],
  ['detailed', '.results-presentation-toggle'],
  ['tested-values', '#sensitivity-tested-values']
];
await fs.mkdir(values.output, { recursive: true });
const records = [];

async function guardedPage(width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const errors = [], writes = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => {
    if (!['GET', 'HEAD'].includes(route.request().method())) {
      writes.push(`${route.request().method()} ${route.request().url()}`);
      return route.abort();
    }
    return route.continue();
  });
  return { page, errors, writes };
}

async function keyboardActivate(page, target) {
  for (let index = 0; index < 40; index++) {
    if (await target.evaluate((element) => element === document.activeElement)) {
      await page.keyboard.press('Enter');
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`Keyboard cannot reach ${await target.innerText()}`);
}

async function inspect(page, width, step, suffix = '') {
  const [id, selector] = step;
  await page.locator(`[data-guided-tour-step="${id}"][data-guided-tour-target-state="ready"]`).waitFor();
  await page.waitForTimeout(250);
  const coach = page.locator('.guided-tour-coach');
  assert.match(await coach.innerText(), /of 8/i);
  assert.equal(await coach.locator('.guided-tour-body p').count(), 0);
  assert.ok(await coach.locator('.guided-tour-body li').count() >= 2);
  assert.doesNotMatch(await coach.locator('.guided-tour-body').innerText(), /[;:→←↔]/);
  const layout = await page.evaluate((targetSelector) => {
    const rect = (element) => {
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    const target = rect(document.querySelector(targetSelector));
    const coach = rect(document.querySelector('.guided-tour-coach'));
    const spotlight = rect(document.querySelector('.guided-tour-spotlight'));
    const overlap = Math.max(0, Math.min(target.right, coach.right) - Math.max(target.left, coach.left))
      * Math.max(0, Math.min(target.bottom, coach.bottom) - Math.max(target.top, coach.top));
    return { target, coach, spotlight, overlap, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      overflowing: [...document.querySelectorAll('main *')].map((element) => ({ tag: element.tagName, class: element.className, ...rect(element) })).filter((box) => box.right > innerWidth + 1).slice(0, 15) };
  }, selector);
  if (layout.overflow) {
    await page.screenshot({ path: path.join(values.output, `${width}-${id}-overflow.png`) });
    console.log(JSON.stringify(layout));
  }
  assert.equal(layout.overflow, false, `${width} ${id} has page overflow`);
  assert.ok(layout.coach.top >= 0 && layout.coach.bottom <= 901, `${width} ${id} coach leaves the viewport`);
  if (width >= 800) assert.equal(layout.overlap, 0, `${width} ${id} coach covers target`);
  assert.ok(Math.abs(layout.spotlight.left - Math.max(0, layout.target.left - 8)) < 2);
  assert.ok(Math.abs(layout.spotlight.top - Math.max(0, layout.target.top - 8)) < 2);
  if (['baseline', 'pairing', 'outcome', 'setting', 'tested-values'].includes(id)) {
    await page.screenshot({ path: path.join(values.output, `${width}-${id}${suffix}.png`) });
  }
  records.push({ width, id, suffix, ...layout });
}

try {
  for (const width of (values.checks === 'edges' ? [] : values.widths.split(',').map(Number))) {
    const { page, errors, writes } = await guardedPage(width);
    const coach = page.locator('.guided-tour-coach');
    const next = coach.locator('.primary-button');
    const state = () => new URL(page.url()).searchParams;
    await page.goto(`${base}/results?type=sensitivity&presentation=detailed&experimentId=${experimentId}`, { waitUntil: 'networkidle' });
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    const launcher = page.getByRole('button', { name: /Run demo/ });
    await launcher.click();
    const chooser = page.getByRole('dialog', { name: 'Choose a demo' });
    for (const title of ['Getting started', 'Creating experiments', 'Exploring results', 'Model information']) assert.equal(await chooser.getByRole('heading', { name: title, exact: true }).count(), 1);
    assert.equal(await chooser.getByRole('button', { name: /Explore sensitivity results/ }).count(), 1);
    assert.equal(await chooser.getByText('Coming soon', { exact: true }).count(), 0);
    const close = chooser.getByRole('button', { name: 'Close demo chooser' });
    await close.focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await chooser.evaluate((element) => element.contains(document.activeElement)), true);
    await page.keyboard.press('Tab');
    assert.equal(await close.evaluate((element) => element === document.activeElement), true);
    const closeTop = (await close.boundingBox()).y;
    await chooser.locator('.demo-chooser-body').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    assert.equal((await close.boundingBox()).y, closeTop, 'Chooser close stays visible while scrolling');
    await page.keyboard.press('Escape');
    assert.equal(await chooser.count(), 0);
    assert.equal(await launcher.evaluate((element) => element === document.activeElement), true);
    await launcher.click();
    await chooser.getByRole('button', { name: /Explore sensitivity results/ }).click();
    assert.equal(state().get('presentation'), 'report');
    assert.equal(state().get('experimentId'), experimentId);
    for (const [index, step] of steps.entries()) {
      const [id] = step;
      await inspect(page, width, step);
      assert.equal(state().get('step'), id);
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator(`[data-guided-tour-step="${id}"][data-guided-tour-target-state="ready"]`).waitFor();
      assert.equal(state().get('step'), id);
      assert.equal(state().get('experimentId'), experimentId);
      if (id === 'baseline') {
        assert.match(await coach.innerText(), /simulated reference.*compare policy settings/s);
        assert.match(await coach.innerText(), /4.5× income/);
      }
      if (id === 'pairing') {
        if (width === 1440) {
          await page.setViewportSize({ width: 800, height: 900 });
          await inspect(page, 800, step, '-resized');
          await page.setViewportSize({ width, height: 900 });
          await inspect(page, width, step, '-resized');
        }
        const actual = await page.locator('[data-guided-target="sensitivity-selected"]').innerText();
        for (const value of ['51,251.16', '51,451.25', '+200.09', '+0.39%', '4 of 8', '-787.8', '+1,138.05']) assert.ok(actual.includes(value), `Report is missing ${value}`);
        assert.match(await coach.innerText(), /0.39% higher/);
        assert.match(await coach.innerText(), /8 matched seeds, 4 are higher and 4 lower/);
        await next.click();
        await page.goBack();
        assert.equal(state().get('step'), 'pairing');
        await page.goForward();
        assert.equal(state().get('step'), 'outcome');
        await coach.getByRole('button', { name: 'Back', exact: true }).click();
        assert.equal(state().get('step'), 'pairing');
      }
      if (id === 'outcome') {
        const outcome = page.getByLabel('Response outcome', { exact: true });
        assert.equal(await next.isDisabled(), true);
        await outcome.focus();
        await outcome.selectOption('core_debtToIncome');
        assert.equal(await outcome.evaluate((element) => element === document.activeElement), true);
        assert.equal(await next.isEnabled(), true, 'Outcome immediately enables Next while focused');
        assert.equal(state().get('step'), 'outcome');
        assert.equal(state().get('setting'), 'point-4');
        assert.match(await coach.innerText(), /2.5 percentage points lower/);
        assert.match(await page.locator('[data-guided-target="sensitivity-selected"]').innerText(), /-2.5 pp/);
        assert.match(await page.locator('[data-guided-target="sensitivity-pairing"]').innerText(), /8 of 8 matched seeds moved lower/);
        await inspect(page, width, step, '-complete');
        // Every allowed alternative hides the fixed debt feedback and leaves the setting pinned.
        for (const value of await outcome.locator('option').evaluateAll((options) => options.map((option) => option.value))) {
          await outcome.selectOption(value);
          assert.equal(await next.isEnabled(), value === 'core_debtToIncome');
          assert.equal((await coach.innerText()).includes('2.5 percentage points lower'), value === 'core_debtToIncome');
          assert.equal(state().get('setting'), 'point-4');
        }
        await outcome.selectOption('core_debtToIncome');
        await page.reload({ waitUntil: 'networkidle' });
        await page.locator('[data-guided-tour-target-state="ready"]').waitFor();
        assert.equal(await next.isEnabled(), true);
      }
      if (id === 'setting') {
        const selected = page.getByLabel('Selected sensitivity setting', { exact: true });
        assert.equal(await next.isDisabled(), true);
        await selected.focus();
        await selected.selectOption('point-5');
        assert.equal(await selected.evaluate((element) => element === document.activeElement), true);
        assert.equal(await next.isEnabled(), true, 'Setting immediately enables Next while focused');
        assert.equal(state().get('step'), 'setting');
        assert.match(await coach.innerText(), /1.51 percentage points higher/);
        assert.match(await page.locator('[data-guided-target="sensitivity-selected"]').innerText(), /92.18%/);
        assert.match(await page.locator('[data-guided-target="sensitivity-selected"]').innerText(), /\+1.51 pp/);
        assert.match(await page.locator('[data-guided-target="sensitivity-pairing"]').innerText(), /7 of 8 matched seeds moved higher/);
        await inspect(page, width, step, '-complete');
        for (const value of ['point-4', 'point-4.25', 'point-4.5', 'point-4.75', 'point-5']) {
          await selected.selectOption(value);
          assert.equal(await next.isEnabled(), value === 'point-5');
          assert.equal((await coach.innerText()).includes('1.51 percentage points higher'), value === 'point-5');
          assert.equal(state().get('outcome'), 'core_debtToIncome');
        }
        await page.reload({ waitUntil: 'networkidle' });
        await page.locator('[data-guided-tour-target-state="ready"]').waitFor();
        assert.equal(await selected.inputValue(), 'point-5');
        assert.equal(await next.isEnabled(), true);
      }
      if (id === 'detailed') {
        assert.equal(await next.isDisabled(), true);
        await keyboardActivate(page, page.getByRole('button', { name: 'Detailed', exact: true }));
        await page.locator('#sensitivity-tested-values').waitFor();
        assert.equal(state().get('experimentId'), experimentId);
        assert.equal(state().get('indicator'), 'core_debtToIncome');
        assert.equal(state().get('measure'), 'mean');
        assert.equal(state().get('setting'), 'point-5');
        assert.equal(state().get('step'), id);
        assert.equal(await next.isEnabled(), true);
        await page.reload({ waitUntil: 'networkidle' });
        await page.locator('#sensitivity-tested-values').waitFor();
        assert.equal(state().get('presentation'), 'detailed');
        assert.equal(await next.isEnabled(), true);
      }
      if (id === 'tested-values') {
        const section = page.locator('#sensitivity-tested-values');
        const opener = section.locator(':scope > button');
        assert.equal(await next.innerText(), 'Finish');
        assert.equal(await next.isDisabled(), true);
        assert.equal(await coach.getByRole('button', { name: 'Exit', exact: true }).count(), 0);
        await keyboardActivate(page, opener);
        assert.equal(await next.isEnabled(), true, 'Opening the real section immediately enables Finish');
        assert.equal(state().get('step'), id);
        await inspect(page, width, step, '-open');
        const indicator = section.getByLabel('Indicator', { exact: true });
        const measure = section.getByLabel('Outcome measure', { exact: true });
        assert.equal(await indicator.inputValue(), 'core_debtToIncome');
        assert.equal(await measure.inputValue(), 'mean');
        assert.match(await section.locator('.sensitivity-point-table').innerText(), /92.181907/);
        assert.match(await section.locator('.sensitivity-point-table').innerText(), /\+1.667402%/);
        await indicator.selectOption('core_mortgageApprovals');
        assert.match(await section.locator('.sensitivity-point-table').innerText(), /51,451.249375/);
        assert.match(await section.locator('.sensitivity-point-table').innerText(), /\+0.390411%/);
        await measure.selectOption('cv');
        await page.reload({ waitUntil: 'networkidle' });
        await page.locator('[data-guided-tour-target-state="ready"]').waitFor();
        assert.equal(await indicator.inputValue(), 'core_mortgageApprovals');
        assert.equal(await measure.inputValue(), 'cv');
        assert.equal(await opener.getAttribute('aria-expanded'), 'true');
        assert.equal(await next.isEnabled(), true);
        await measure.selectOption('range');
        await measure.selectOption('mean');
        await section.locator('.sensitivity-point-table').scrollIntoViewIfNeeded();
        await inspect(page, width, step, '-table');
        const tableScroller = section.getByRole('region', { name: 'Results by tested value table' });
        if (await tableScroller.evaluate((element) => element.scrollWidth > element.clientWidth)) {
          await tableScroller.focus();
          await page.keyboard.press('ArrowRight');
          await page.waitForFunction(() => document.querySelector('.sensitivity-table-wrap').scrollLeft > 0);
        }
        await page.screenshot({ path: path.join(values.output, `${width}-detailed-table.png`) });
        await coach.getByRole('button', { name: 'Back', exact: true }).click();
        assert.equal(state().get('step'), 'detailed');
        assert.equal(state().get('presentation'), 'report');
        await page.goBack();
        await page.locator('#sensitivity-tested-values').waitFor();
        assert.equal(state().get('step'), 'tested-values');
        assert.equal(await opener.getAttribute('aria-expanded'), 'true');
        assert.equal(await indicator.inputValue(), 'core_mortgageApprovals');
        await page.goForward();
        assert.equal(state().get('step'), 'detailed');
        await page.getByRole('button', { name: 'Detailed', exact: true }).click();
        await next.click();
        await page.locator('#sensitivity-tested-values').waitFor();
        assert.equal(await opener.getAttribute('aria-expanded'), 'false', 'New step entry offers its opening action');
        await keyboardActivate(page, opener);
      }
      assert.equal(await next.isEnabled(), true, `${id} can advance after its action`);
      if (width === 800 || index === 7) await keyboardActivate(page, next);
      else await next.click();
    }
    await page.locator('.guided-tour-layer').waitFor({ state: 'detached' });
    assert.equal(state().has('demo'), false);
    assert.equal(state().has('step'), false);
    assert.equal(state().get('presentation'), 'detailed');
    assert.equal(state().get('experimentId'), experimentId);
    assert.equal(state().get('sensitivityResults'), 'open');
    assert.equal(await page.locator('#main-workspace').evaluate((element) => element === document.activeElement), true);
    const escapeUrl = new URL(page.url());
    escapeUrl.searchParams.set('demo', 'sensitivity-results');
    escapeUrl.searchParams.set('step', 'tested-values');
    await page.goto(escapeUrl.href, { waitUntil: 'networkidle' });
    await page.locator('[data-guided-tour-target-state="ready"]').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.guided-tour-layer').waitFor({ state: 'detached' });
    assert.equal(state().get('presentation'), 'detailed');
    assert.equal(state().get('sensitivityResults'), 'open');
    assert.equal(await page.locator('#main-workspace').evaluate((element) => element === document.activeElement), true, 'Escape returns focus to the workspace');
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    console.log(`Sensitivity ${width}×900 passed with figures, every control alternative, reload, Back, history, keyboard, Finish and Escape.`);
    await page.close();
  }
  if (values.checks !== 'journey') {
    const guideUrl = (step, extra = {}) => `${base}/results?${new URLSearchParams({
      type: 'sensitivity', experimentId, demo: 'sensitivity-results', step, ...extra
    })}`;
    for (const availability of ['missing', 'unmarked', 'failed']) {
      const { page, errors, writes } = await guardedPage(800);
      await page.route(/\/api\/experiments\/sensitivity(?:\?.*)?$/, async (route) => {
        if (availability === 'failed') return route.fulfill({ status: 503, json: { error: 'Isolated unavailable fixture' } });
        const payload = { experiments: availability === 'missing' ? [] : [{ ...savedExperiment, isExample: false }] };
        return route.fulfill({ json: payload });
      });
      await page.goto(`${base}/?chooseDemo=1`, { waitUntil: 'networkidle' });
      const card = page.getByRole('button', { name: /Explore sensitivity results/ });
      await card.getByText("This example isn't available on this installation", { exact: true }).waitFor();
      assert.equal(await card.isDisabled(), true);
      assert.match(await card.innerText(), /isn't available/);
      await page.goto(guideUrl('outcome'), { waitUntil: 'networkidle' });
      const coach = page.locator('.guided-tour-coach');
      await coach.getByRole('heading', { name: "This example isn't available on this installation" }).waitFor();
      assert.equal((await coach.innerText()).includes('2.5'), false);
      await coach.getByRole('button', { name: 'Choose another demo', exact: true }).click();
      await page.getByRole('dialog', { name: 'Choose a demo' }).waitFor();
      assert.deepEqual(errors, []);
      assert.deepEqual(writes, []);
      await page.close();
      console.log(`Sensitivity availability ${availability} passed.`);
    }
    for (const failure of ['delayed', 'failed', 'missing-target']) {
      const { page, errors, writes } = await guardedPage(800);
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      if (failure !== 'missing-target') await page.route(`**/api/experiments/sensitivity/${experimentId}/results`, async (route) => {
        if (failure === 'failed') return route.fulfill({ status: 500, json: { error: 'Isolated results failure' } });
        await gate;
        return route.continue();
      });
      await page.goto(guideUrl('outcome'), { waitUntil: failure === 'delayed' ? 'domcontentloaded' : 'networkidle' });
      const coach = page.locator('.guided-tour-coach');
      if (failure === 'missing-target') {
        await page.locator('[data-guided-tour-target-state="ready"]').waitFor();
        await page.locator('[data-guided-target="sensitivity-outcome"]').evaluate((element) => element.remove());
      }
      await page.locator('[data-guided-tour-target-state="missing"]').waitFor({ timeout: 15000 });
      assert.match(await coach.innerText(), /section is unavailable/);
      assert.equal(await coach.getByRole('button', { name: 'Next', exact: true }).isEnabled(), true);
      assert.equal(new URL(page.url()).searchParams.get('experimentId'), experimentId);
      if (failure === 'delayed') {
        release();
        await page.locator('[data-guided-tour-target-state="ready"]').waitFor();
        const outcome = page.getByLabel('Response outcome', { exact: true });
        await outcome.selectOption('core_debtToIncome');
        assert.equal(await coach.getByRole('button', { name: 'Next', exact: true }).isEnabled(), true);
      }
      await page.keyboard.press('Escape');
      await page.locator('.guided-tour-layer').waitFor({ state: 'detached' });
      assert.deepEqual(errors, []);
      assert.deepEqual(writes, []);
      await page.close();
      console.log(`Sensitivity recovery ${failure} passed.`);
    }
    // Both result types retain Report defaults after an explicit Detailed visit.
    {
      const { page, errors, writes } = await guardedPage(800);
      const selections = { experimentId, baselineRunId: 'Example Bank Rate raised by 1 pp v0o7', comparisonRunId: 'Example 2024 policy, unchanged v0o7' };
      for (const type of ['sensitivity', 'manual']) {
        await page.goto(`${base}/results?${new URLSearchParams({ type, presentation: 'detailed', ...selections })}`, { waitUntil: 'networkidle' });
        await page.locator('[data-guided-target="sidebar-results"]').click();
        const landing = page.locator('.results-launcher');
        assert.equal(await landing.locator('a').count(), 2);
        await landing.getByRole('link', { name: type === 'manual' ? /Policy scenario results/ : /Sensitivity analysis results/ }).click();
        assert.equal(await page.getByRole('button', { name: 'Report', exact: true }).getAttribute('aria-pressed'), 'true');
        for (const [key, value] of Object.entries(selections)) assert.equal(new URL(page.url()).searchParams.get(key), value);
        await page.getByRole('button', { name: 'Detailed', exact: true }).click();
        const other = type === 'manual' ? 'Sensitivity analysis' : 'Policy scenarios';
        await page.locator('#sidebar-result-types').getByRole('link', { name: other, exact: true }).click();
        assert.equal(await page.getByRole('button', { name: 'Report', exact: true }).getAttribute('aria-pressed'), 'true');
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(writes, []);
      await page.close();
      console.log('Results landing and both Report navigation defaults passed.');
    }
    // Accepted fixture IDs deliberately differ from the saved examples. No simulation is sent.
    for (const practice of [true, false]) for (const type of ['policy', 'sensitivity']) {
      const { page, errors, writes } = await guardedPage(800);
      const runType = type === 'policy' ? 'manual' : 'sensitivity';
      const id = `walkthrough-browser-${type}-${practice ? 'practice' : 'ordinary'}`;
      const jobRef = `${runType}:${id}`;
      const selectionKey = type === 'policy' ? 'baselineRunId' : 'experimentId';
      const posts = [];
      await page.route(type === 'policy' ? '**/api/model-runs' : /\/api\/experiments\/sensitivity(?:\?.*)?$/, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        posts.push(route.request().postDataJSON());
        return route.fulfill({ json: type === 'policy'
          ? { accepted: true, warnings: [], job: { jobId: id, runId: id, baseline: 'v0o7', status: 'queued', createdAt: '2026-09-22T17:00:00Z', outputPath: '/isolated/not-created', configPath: '/isolated/not-created' } }
          : { accepted: true, warnings: [], experiment: { experimentId: id, status: 'queued' } }
        });
      });
      await page.route('**/api/experiments/jobs', (route) => route.fulfill({ json: {
        jobs: posts.length ? [{ type: runType, id, runId: type === 'policy' ? id : undefined, jobRef, title: posts[0].title, status: 'queued', createdAt: '2026-09-22T17:00:00Z' }] : [],
        locks: { manualSubmissionLocked: false, sensitivitySubmissionLocked: false, activeManualJobRef: null, activeSensitivityJobRef: null }
      } }));
      const setup = type === 'policy' ? 'scenarios' : 'sensitivity';
      await page.goto(`${base}/${setup}/new${practice ? `?demo=experiment&mode=${type}` : ''}`, { waitUntil: 'networkidle' });
      const name = page.getByRole('textbox', { name: type === 'policy' ? 'Scenario name' : 'Experiment name', exact: true });
      if (practice) {
        const coach = page.locator('.guided-tour-coach');
        for (let index = 0; index < 15; index++) {
          const layer = page.locator('.guided-tour-layer');
          await layer.waitFor();
          const step = await layer.getAttribute('data-guided-tour-step');
          if (step === `${type}-submit`) break;
          if (step === `${type}-name`) {
            await page.locator(`[data-guided-tour-step="${step}"][data-guided-tour-target-state="ready"]`).waitFor();
            await name.fill(`Isolated ${type} invitation fixture`);
            assert.equal(await name.evaluate((element) => element === document.activeElement), true);
            assert.equal(await coach.getByRole('button', { name: 'Next', exact: true }).isEnabled(), true, 'Creation name action still enables Next while focused');
          }
          if (step === 'policy-change-bank-rate') {
            await page.locator(`[data-guided-tour-step="${step}"][data-guided-tour-target-state="ready"]`).waitFor();
            const input = page.locator('[data-experiment-demo-target="policy-bank-rate-input"]');
            await input.fill('6.11');
            assert.equal(await input.evaluate((element) => element === document.activeElement), true);
            assert.equal(await coach.getByRole('button', { name: 'Next', exact: true }).isEnabled(), true, 'Bank Rate action still enables Next while focused');
          }
          await coach.getByRole('button', { name: 'Next', exact: true }).click();
          await page.waitForFunction((old) => document.querySelector('.guided-tour-layer')?.dataset.guidedTourStep !== old, step);
        }
        await page.locator(`[data-experiment-demo-target="${type}-start-boundary"]`).click();
      } else {
        await name.fill(`Isolated ${type} invitation fixture`);
        await page.locator('.scenario-stepper').getByRole('button', { name: /Review and start/ }).click();
        await page.getByRole('button', { name: type === 'policy' ? 'Start policy scenario' : 'Start sensitivity analysis', exact: true }).click();
      }
      await page.waitForURL((url) => url.pathname === '/results');
      const progress = page.locator('[data-guided-target="submitted-report-progress"]');
      await progress.waitFor();
      assert.equal(posts.length, 1);
      assert.equal(new URL(page.url()).searchParams.get('presentation'), 'report');
      assert.equal(new URL(page.url()).searchParams.get(selectionKey), id);
      assert.equal(new URL(page.url()).searchParams.get('jobRef'), jobRef);
      const submittedUrl = page.url();
      if (practice) {
        const invitation = page.locator('[data-guided-target="results-demo-invitation"]');
        await invitation.getByRole('button', { name: 'No', exact: true }).click();
        assert.equal(await invitation.count(), 0);
        assert.equal(new URL(page.url()).searchParams.get(selectionKey), id);
        assert.equal(new URL(page.url()).searchParams.get('jobRef'), jobRef);
        await page.reload({ waitUntil: 'networkidle' });
        await progress.waitFor();
        assert.equal(await invitation.count(), 0);
        assert.match(await progress.innerText(), /Isolated/);
        await page.goto(submittedUrl, { waitUntil: 'networkidle' });
        await invitation.getByText('The walkthrough uses saved example results.', { exact: true }).waitFor();
        await invitation.getByRole('button', { name: 'Yes', exact: true }).click();
        await page.locator('[data-guided-tour-step="results-section"][data-guided-tour-target-state="ready"]').waitFor();
        assert.equal(new URL(page.url()).searchParams.get('demo'), `${type}-results`);
        assert.equal(new URL(page.url()).searchParams.get('jobRef'), null);
        assert.equal(new URL(page.url()).searchParams.get(selectionKey), type === 'policy' ? 'Example Bank Rate raised by 1 pp v0o7' : experimentId);
        assert.equal(await progress.count(), 0, 'The pending practice run does not block the saved-example guide');
        assert.equal((await page.locator('main').innerText()).includes('Isolated'), false, 'The submitted title never labels saved example figures');
        assert.equal(await page.getByRole('button', { name: 'Finish practice', exact: true }).count(), 0);
        await page.keyboard.press('Escape');
      } else {
        await page.reload({ waitUntil: 'networkidle' });
        await progress.waitFor();
        assert.equal(new URL(page.url()).searchParams.get(selectionKey), id);
        assert.equal(await page.getByRole('button', { name: 'Report', exact: true }).getAttribute('aria-pressed'), 'true');
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(writes, []);
      await page.close();
      console.log(`${type} ${practice ? 'practice invitation Yes and No' : 'ordinary queue'} passed with one mocked submission and its own Report identity.`);
    }
  }
} finally {
  if (records.length) await fs.writeFile(path.join(values.output, 'layout-checks.json'), JSON.stringify(records, null, 2));
  await browser.close();
}
