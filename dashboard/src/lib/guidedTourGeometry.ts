export interface GuidedTourRectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GuidedTourSize {
  width: number;
  height: number;
}

export interface GuidedTourPlacement extends GuidedTourRectangle {
  bottomSheet: boolean;
  /** When non-null, scroll the target to this top edge before measuring again. */
  targetTop: number | null;
}

export const GUIDED_TOUR_MARGIN = 16;
export const GUIDED_TOUR_GAP = 18;
export const GUIDED_TOUR_PADDING = 8;
export const GUIDED_TOUR_NARROW_WIDTH = 720;
export const GUIDED_TOUR_TARGET_TIMEOUT_MS = 3000;
export const GUIDED_TOUR_MIN_SIDE_WIDTH = 196;

/** Plan entry alignment before scrolling; later measurements leave visible targets in place. */
export function guidedTourTargetTop(
  target: GuidedTourRectangle,
  viewport: GuidedTourSize,
  entryAlignment?: 'start' | 'center'
): number {
  if (!entryAlignment && target.top >= 0 && target.top + target.height <= viewport.height) return target.top;
  const inset = GUIDED_TOUR_MARGIN + GUIDED_TOUR_PADDING;
  return entryAlignment === 'start' || target.height > viewport.height - inset * 2
    ? inset : Math.max(inset, (viewport.height - target.height) / 2);
}

/** Identify layout changes independently of viewport or nested-container scrolling. */
export function guidedTourTargetLayoutKey(
  target: GuidedTourRectangle,
  scrollOffset: { left: number; top: number }
): string {
  return [target.left + scrollOffset.left, target.top + scrollOffset.top, target.width, target.height]
    .map((value) => Math.round(value * 10) / 10)
    .join(':');
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, Math.max(minimum, maximum)));
}

export function guidedTourIntersection(
  first: GuidedTourRectangle,
  second: GuidedTourRectangle
): GuidedTourRectangle | null {
  const left = Math.max(first.left, second.left);
  const top = Math.max(first.top, second.top);
  const right = Math.min(first.left + first.width, second.left + second.width);
  const bottom = Math.min(first.top + first.height, second.top + second.height);
  return right > left && bottom > top
    ? { left, top, width: right - left, height: bottom - top }
    : null;
}

export function guidedTourSpotlight(
  target: GuidedTourRectangle,
  viewport: GuidedTourSize,
  padding = GUIDED_TOUR_PADDING
): GuidedTourRectangle | null {
  return guidedTourIntersection({
    left: target.left - padding,
    top: target.top - padding,
    width: target.width + padding * 2,
    height: target.height + padding * 2
  }, { left: 0, top: 0, ...viewport });
}

/** Four rectangles for one hole; subtract further holes without exposing the gaps between them. */
export function guidedTourScrims(
  viewport: GuidedTourSize,
  holes: readonly GuidedTourRectangle[]
): GuidedTourRectangle[] {
  let rectangles: GuidedTourRectangle[] = [{ left: 0, top: 0, ...viewport }];
  for (const hole of holes) {
    rectangles = rectangles.flatMap((rectangle) => {
      const overlap = guidedTourIntersection(rectangle, hole);
      if (!overlap) return [rectangle];
      const right = rectangle.left + rectangle.width;
      const bottom = rectangle.top + rectangle.height;
      return [
        { left: rectangle.left, top: rectangle.top, width: rectangle.width, height: overlap.top - rectangle.top },
        { left: rectangle.left, top: overlap.top, width: overlap.left - rectangle.left, height: overlap.height },
        { left: overlap.left + overlap.width, top: overlap.top, width: right - overlap.left - overlap.width, height: overlap.height },
        { left: rectangle.left, top: overlap.top + overlap.height, width: rectangle.width, height: bottom - overlap.top - overlap.height }
      ].filter((part) => part.width > 0 && part.height > 0);
    });
  }
  return rectangles;
}

/** Prefer a free side. Large targets are scrolled below the coach instead of covered by it. */
export function guidedTourCoachPlacement(
  target: GuidedTourRectangle | null,
  viewport: GuidedTourSize,
  measuredCoach: GuidedTourSize,
  additionalRegions: readonly GuidedTourRectangle[] = []
): GuidedTourPlacement {
  const margin = GUIDED_TOUR_MARGIN;
  const gap = GUIDED_TOUR_GAP;
  const bottomSheet = viewport.width <= GUIDED_TOUR_NARROW_WIDTH;
  const width = Math.min(measuredCoach.width || 352, Math.max(1, viewport.width - margin * 2));
  const height = Math.min(measuredCoach.height || 280, Math.max(1, viewport.height - margin * 2));
  const centredLeft = Math.max(margin, (viewport.width - width) / 2);
  if (!target) return {
    left: centredLeft,
    top: bottomSheet ? viewport.height - height - margin : Math.max(margin, (viewport.height - height) / 2),
    width, height, bottomSheet, targetTop: null
  };

  const targetRight = target.left + target.width;
  const targetBottom = target.top + target.height;
  const alignedLeft = clamp(target.left, margin, viewport.width - width - margin);
  const alignedTop = clamp(target.top, margin, viewport.height - height - margin);
  const bottomTop = viewport.height - height - margin;
  const candidates = bottomSheet
    ? [{ left: centredLeft, top: bottomTop }]
    : [
      { left: targetRight + gap, top: alignedTop },
      { left: target.left - width - gap, top: alignedTop },
      { left: alignedLeft, top: targetBottom + gap },
      { left: alignedLeft, top: target.top - height - gap }
    ];
  const obstacles = [target, ...additionalRegions];
  const clear = candidates.find(({ left, top }) =>
    left >= margin && top >= margin && left + width <= viewport.width - margin &&
    top + height <= viewport.height - margin &&
    obstacles.every((region) => !guidedTourIntersection({ left, top, width, height }, region))
  );
  if (clear) return { ...clear, width, height, bottomSheet, targetTop: null };

  // A large report card may fill the vertical viewport while the sidebar gutter
  // remains clear. A narrower coach there lets the user scroll the card freely.
  if (!bottomSheet) {
    const sideCandidates = [
      { left: margin, availableWidth: target.left - gap - margin },
      { left: targetRight + gap, availableWidth: viewport.width - targetRight - gap - margin }
    ].sort((first, second) => second.availableWidth - first.availableWidth);
    for (const side of sideCandidates) {
      const sideWidth = Math.min(width, side.availableWidth);
      const rectangle = { left: side.left, top: alignedTop, width: sideWidth, height };
      if (sideWidth >= GUIDED_TOUR_MIN_SIDE_WIDTH && obstacles.every((region) => !guidedTourIntersection(rectangle, region))) {
        return { ...rectangle, bottomSheet, targetTop: null };
      }
    }
  }

  if (bottomSheet) return {
    left: centredLeft, top: bottomTop, width, height, bottomSheet,
    targetTop: bottomTop - gap - target.height
  };
  return {
    left: centredLeft, top: margin, width, height, bottomSheet,
    targetTop: margin + height + gap
  };
}
