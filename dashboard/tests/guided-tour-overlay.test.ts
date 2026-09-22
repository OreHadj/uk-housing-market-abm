import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  GuidedTourOverlay,
  guidedTourCanAdvance,
  guidedTourNextFocusIndex
} from '../src/components/GuidedTourOverlay.js';
import type { GuidedTourOverlayProps } from '../src/lib/guidedDemos/types.js';
import {
  GUIDED_TOUR_TARGET_TIMEOUT_MS,
  guidedTourCoachPlacement,
  guidedTourIntersection,
  guidedTourScrims,
  guidedTourSpotlight,
  guidedTourTargetLayoutKey,
  guidedTourTargetTop,
  type GuidedTourRectangle
} from '../src/lib/guidedTourGeometry.js';

const noop = () => {};
const props: GuidedTourOverlayProps = {
  demoLabel: 'Explore policy results',
  step: {
    id: 'market', title: 'Follow the market over time', body: 'Select Mortgage approvals.',
    kind: 'action', target: '[data-guided-target="policy-market"]', interactive: true,
    actionHint: 'Select Mortgage approvals.', completionNote: 'The chart now shows mortgage approvals.',
    unavailableBody: 'The market chart is unavailable. Continue to the next stop.'
  },
  stepIndex: 2, stepCount: 7, isComplete: false, onBack: noop, onNext: noop, onExit: noop
};
const render = (overrides: Partial<GuidedTourOverlayProps> = {}) => renderToStaticMarkup(createElement(GuidedTourOverlay, { ...props, ...overrides }));

const incomplete = render();
assert.match(incomplete, /<button[^>]*disabled=""[^>]*>Next<\/button>/);
assert.ok(incomplete.includes('Explore policy results · 3 of 7'));
assert.ok(incomplete.includes('role="dialog"'));
assert.ok(incomplete.includes('aria-live="polite"'));
assert.equal(incomplete.includes('aria-modal'), false, 'Interactive controls must remain outside an aria-modal boundary');
assert.ok(incomplete.includes('>Back</button>') && incomplete.includes('>Exit</button>'));
assert.equal(incomplete.includes('Pause'), false);
const completed = render({ isComplete: true });
assert.match(completed, /<button[^>]*class="primary-button"[^>]*>Next<\/button>/);
assert.ok(completed.includes('The chart now shows mortgage approvals.'));
assert.equal(completed.includes('Select Mortgage approvals.'), false, 'Completion replaces the lesson body and action hint');
assert.equal(render({ active: false }), '');
const info = render({ stepIndex: 0, step: { ...props.step, kind: 'info', interactive: false } });
assert.ok(info.includes('aria-modal="true"'));
assert.match(info, /<button[^>]*disabled=""[^>]*>Back<\/button>/);
assert.match(info, /<button[^>]*class="primary-button"[^>]*>Next<\/button>/);

const missing = render({ availability: 'missing' });
assert.ok(missing.includes('This example isn&#x27;t available on this installation'));
assert.ok(missing.includes('>Choose another demo</button>'));
assert.ok(missing.includes('>Exit</button>'));
assert.equal(missing.includes('>Next</button>'), false);
assert.equal(missing.includes('Select Mortgage approvals.'), false);
const missingEvidence = render({
  availability: 'missing',
  unavailableTitle: 'Model evidence is unavailable',
  unavailableBody: 'Evidence for the selected model and year is unavailable.'
});
assert.ok(missingEvidence.includes('Model evidence is unavailable'));
assert.ok(missingEvidence.includes('Evidence for the selected model and year is unavailable.'));
assert.equal(missingEvidence.includes('This example isn&#x27;t available'), false,
  'Model information failures must not claim that a bundled example is missing');
const loading = render({ availability: 'loading' });
assert.ok(loading.includes('aria-busy="true"'));
assert.match(loading, /<button[^>]*disabled=""[^>]*>Next<\/button>/);
const bulletStep = { ...props.step, bullets: ['Choose a section.', 'The current section is highlighted.'] };
const bulletMarkup = render({ step: bulletStep });
assert.ok(bulletMarkup.includes('<ul class="guided-tour-bullets"><li>Choose a section.</li><li>The current section is highlighted.</li></ul>'));
for (const replacement of [{ isComplete: true }, { availability: 'loading' as const }, { availability: 'missing' as const }]) {
  assert.equal(render({ step: bulletStep, ...replacement }).includes('guided-tour-bullets'), false, 'Replacement messages must not retain lesson bullets');
}
const completedBulletStep = { ...bulletStep, body: '', completionNote: undefined, completionBullets: ['Mortgage approvals are selected.', 'Compare the two runs over time.'] };
const completedBulletMarkup = render({ step: completedBulletStep, isComplete: true });
assert.ok(completedBulletMarkup.includes('<ul class="guided-tour-bullets"><li>Mortgage approvals are selected.</li><li>Compare the two runs over time.</li></ul>'));
assert.equal(completedBulletMarkup.includes('Choose a section.'), false, 'Completion bullets replace lesson bullets');
assert.equal(render({ step: completedBulletStep }).includes('Mortgage approvals are selected.'), false, 'Do not show completion feedback before the action');
for (const availability of ['loading', 'missing'] as const) {
  const markup = render({ step: completedBulletStep, isComplete: true, availability });
  assert.equal(markup.includes('Mortgage approvals are selected.'), false, 'Availability messages replace completion bullets');
  assert.ok(markup.includes('guided-tour-bullets'), 'Bullet lessons also use bullets for recovery messages');
}
assert.match(render({ step: completedBulletStep }), /guided-tour-action-state is-waiting[^>]*><ul[^>]*><li>Select Mortgage approvals\./, 'Action hints retain the bullet format');
assert.ok(render({ step: { ...bulletStep, kind: 'info' }, isComplete: true }).includes('guided-tour-bullets'), 'The final information step retains its bullets');
const completion = render({
  step: { ...props.step, kind: 'info', target: null },
  completionActions: [{ id: 'finish', label: 'Finish', onClick: noop, primary: true }]
});
assert.ok(completion.includes('>Finish</button>'));
assert.equal(completion.includes('>Next</button>'), false);

assert.equal(GUIDED_TOUR_TARGET_TIMEOUT_MS, 3000);
assert.equal(guidedTourCanAdvance('info', false, 'ready', 'ready'), true);
assert.equal(guidedTourCanAdvance('action', false, 'ready', 'ready'), false);
assert.equal(guidedTourCanAdvance('action', true, 'ready', 'ready'), true);
assert.equal(guidedTourCanAdvance('action', false, 'ready', 'missing'), true, 'Missing targets must never strand the guide');
assert.equal(guidedTourCanAdvance('action', true, 'loading', 'missing'), false);
assert.equal(guidedTourCanAdvance('info', true, 'missing', 'ready'), false);
assert.equal(guidedTourNextFocusIndex(4, 3, false), 0);
assert.equal(guidedTourNextFocusIndex(4, 0, true), 3);
assert.equal(guidedTourNextFocusIndex(4, -1, false), 0);
assert.equal(guidedTourNextFocusIndex(4, -1, true), 3);
assert.equal(guidedTourNextFocusIndex(0, -1, false), -1);

const area = (rectangle: GuidedTourRectangle) => rectangle.width * rectangle.height;
const viewport = { width: 1440, height: 900 };
const lowHeading = { left: 254, top: 720, width: 900, height: 70 };
assert.equal(guidedTourTargetTop(lowHeading, viewport), 720, 'Visible targets stay put during later measurements');
assert.equal(guidedTourTargetTop(lowHeading, viewport, 'center'), 415, 'Step entry can bring a low heading into the centre');
assert.equal(guidedTourTargetTop(lowHeading, viewport, 'start'), 24, 'Top alignment scrolls down farther to leave room for the section contents');
assert.equal(guidedTourTargetTop({ ...lowHeading, top: 1000 }, viewport), 415, 'Off-screen headings use the same planned destination');
assert.equal(guidedTourTargetTop({ ...lowHeading, height: 1200 }, viewport), 24, 'Tall sections retain their heading instead of centring their middle');
assert.equal(guidedTourTargetTop({ ...lowHeading, top: 415 }, viewport), 415, 'Scroll frames do not request another move');
assert.equal(guidedTourTargetTop({ ...lowHeading, top: 520 }, viewport), 520, 'Manual scrolling after entry is respected');
const target = { left: 500, top: 250, width: 400, height: 220 };
const spotlight = guidedTourSpotlight(target, viewport)!;
assert.deepEqual(spotlight, { left: 492, top: 242, width: 416, height: 236 });
const scrims = guidedTourScrims(viewport, [spotlight]);
assert.equal(scrims.length, 4);
assert.equal(scrims.reduce((sum, rectangle) => sum + area(rectangle), 0) + area(spotlight), viewport.width * viewport.height);
assert.ok(scrims.every((rectangle) => !guidedTourIntersection(rectangle, spotlight)));
assert.deepEqual(guidedTourSpotlight({ left: -10, top: -20, width: 50, height: 80 }, viewport), { left: 0, top: 0, width: 48, height: 68 });
assert.equal(guidedTourSpotlight({ left: 1500, top: 0, width: 20, height: 20 }, viewport), null);

const extra = { left: 1020, top: 300, width: 250, height: 180 };
const twoHoles = guidedTourScrims(viewport, [spotlight, extra]);
assert.ok(twoHoles.every((rectangle) => !guidedTourIntersection(rectangle, spotlight) && !guidedTourIntersection(rectangle, extra)));
assert.equal(twoHoles.reduce((sum, rectangle) => sum + area(rectangle), 0) + area(spotlight) + area(extra), viewport.width * viewport.height);
assert.ok(twoHoles.some((rectangle) => guidedTourIntersection(rectangle, { left: 920, top: 310, width: 80, height: 30 })), 'The gap between allowed regions remains dimmed and blocked');
const overlapping = { left: 700, top: 300, width: 350, height: 200 };
const overlappingHoles = guidedTourScrims(viewport, [spotlight, overlapping]);
const unionArea = area(spotlight) + area(overlapping) - area(guidedTourIntersection(spotlight, overlapping)!);
assert.equal(overlappingHoles.reduce((sum, rectangle) => sum + area(rectangle), 0) + unionArea, viewport.width * viewport.height);

for (const width of [1440, 800]) {
  const screen = { width, height: 900 };
  for (const rectangle of [
    { left: 210, top: 300, width: width - 250, height: 140 },
    { left: 210, top: 50, width: Math.min(350, width - 250), height: 600 },
    { left: 210, top: 0, width: width - 250, height: 880 }
  ]) {
    const placement = guidedTourCoachPlacement(rectangle, screen, { width: 352, height: 260 });
    assert.equal(placement.bottomSheet, false);
    const moved = placement.targetTop === null ? rectangle : { ...rectangle, top: placement.targetTop };
    assert.equal(guidedTourIntersection(placement, moved), null, `${width}px coach must leave the target clear after requested scrolling`);
    assert.ok(placement.left >= 0 && placement.left + placement.width <= width);
    assert.ok(placement.top >= 0 && placement.top + placement.height <= screen.height);
  }
}
const mobileTarget = { left: 16, top: 500, width: 688, height: 160 };
const mobile = guidedTourCoachPlacement(mobileTarget, { width: 720, height: 900 }, { width: 688, height: 280 });
assert.equal(mobile.bottomSheet, true);
assert.equal(mobile.top + mobile.height, 884);
assert.notEqual(mobile.targetTop, null);
assert.equal(guidedTourIntersection(mobile, { ...mobileTarget, top: mobile.targetTop! }), null);
const avoidingExtra = guidedTourCoachPlacement(target, viewport, { width: 352, height: 260 }, [extra]);
assert.equal(guidedTourIntersection(avoidingExtra, extra), null);

// Delayed report data can change layout after the first spotlight measurement.
// Re-reserve room for that change, without treating our own scroll frames as new layout.
const loadedContext = { left: 254, top: 168.0156, width: 522, height: 429.8125 };
const contextLayout = guidedTourTargetLayoutKey(loadedContext, { left: 0, top: 250 });
assert.notEqual(contextLayout, guidedTourTargetLayoutKey({ ...loadedContext, height: 180 }, { left: 0, top: 250 }));
assert.notEqual(contextLayout, guidedTourTargetLayoutKey({ ...loadedContext, top: 130 }, { left: 0, top: 250 }));
const contextPlacement = guidedTourCoachPlacement(guidedTourSpotlight(loadedContext, { width: 800, height: 900 }), { width: 800, height: 900 }, { width: 440, height: 331.75 });
assert.equal(contextPlacement.targetTop, null, 'The available sidebar gutter avoids a corrective scroll');
assert.equal(contextPlacement.width, 212);
assert.equal(guidedTourIntersection(contextPlacement, loadedContext), null);
const clearedContext = { ...loadedContext, top: 400 };
const scrollChange = loadedContext.top - clearedContext.top;
assert.equal(contextLayout, guidedTourTargetLayoutKey(clearedContext, { left: 0, top: 250 + scrollChange }), 'Clearance scrolling must not request another layout correction');
const tallMarket = { left: 254, top: -100, width: 522, height: 1200 };
const tallPlacement = guidedTourCoachPlacement(guidedTourSpotlight(tallMarket, { width: 800, height: 900 }), { width: 800, height: 900 }, { width: 440, height: 340 });
assert.equal(tallPlacement.targetTop, null);
assert.equal(guidedTourIntersection(tallPlacement, tallMarket), null, 'The side coach leaves every visible part of a tall panel clear');
const noGutterMarket = { ...tallMarket, left: 180, width: 600 };
const noGutterPlacement = guidedTourCoachPlacement(guidedTourSpotlight(noGutterMarket, { width: 800, height: 900 }), { width: 800, height: 900 }, { width: 440, height: 340 });
assert.notEqual(noGutterPlacement.targetTop, null);
assert.ok(noGutterPlacement.targetTop! >= noGutterPlacement.top + noGutterPlacement.height, 'Without a usable gutter, reserve space above the panel');
assert.ok(noGutterPlacement.targetTop! + 100 < 900, 'The header and first controls fit in the remaining viewport');

// A real wheel scroll must not move the page back merely to uncover the coach.
const scrolledMarket = { left: 254, top: 158.203, width: 522, height: 732 };
const sidePlacement = guidedTourCoachPlacement(guidedTourSpotlight(scrolledMarket, { width: 800, height: 900 }), { width: 800, height: 900 }, { width: 440, height: 366.14 });
assert.equal(sidePlacement.width, 212);
assert.equal(sidePlacement.targetTop, null);
assert.equal(guidedTourIntersection(sidePlacement, scrolledMarket), null);
for (const top of [-400, -100, 0, 158.203, 300, 550]) {
  const scrolled = { ...scrolledMarket, top };
  const measuredNarrow = guidedTourCoachPlacement(guidedTourSpotlight(scrolled, { width: 800, height: 900 }), { width: 800, height: 900 }, { width: 212, height: 720 });
  assert.equal(measuredNarrow.targetTop, null, `Scrolling to ${top}px keeps the gutter available`);
  assert.equal(guidedTourIntersection(measuredNarrow, scrolled), null);
  assert.ok(measuredNarrow.top + measuredNarrow.height <= 900);
}
const restoredWidth = guidedTourCoachPlacement({ ...scrolledMarket, top: 450, height: 140 }, { width: 800, height: 900 }, { width: 440, height: 366.14 });
assert.equal(restoredWidth.width, 440, 'Restore normal width when there is room above the target');

const source = readFileSync(new URL('../src/components/GuidedTourOverlay.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/components/GuidedTourOverlay.css', import.meta.url), 'utf8');
assert.ok(source.includes('MutationObserver') && source.includes('ResizeObserver'));
assert.ok(source.includes("window.addEventListener('scroll', scrolled, true)"));
assert.ok(source.includes("window.matchMedia('(prefers-reduced-motion: reduce)')"));
assert.ok(source.includes('currentRef.current.onExit()'));
assert.equal(source.includes('focusableElements(target)[0]'), false, 'Step entry must not autofocus a page control that can open help or a menu');
assert.equal(source.includes('onNext()'), false, 'Only the Next button may invoke the supplied advance callback');
assert.equal(source.includes('validation-demo-'), false);
assert.equal(css.includes('.validation-demo-'), false);
assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
assert.ok(css.includes('@media (max-width: 720px)'));

console.log('Guided tour overlay rendering, action gating, focus cycling, scrim regions and viewport geometry checks passed.');
