import { useEffect, useRef, useState } from 'react';
import type { ExperimentDemoStepProgressEvent } from '../lib/experimentDemo';
import type { CreationDemoStep, GuidedCreationDemoProps } from '../lib/guidedDemos/creation';
import type { GuidedTourOverlayProps } from '../lib/guidedDemos/types';
import { GuidedTourOverlay } from './GuidedTourOverlay';

export function resolveCreationDemoStep<StepId extends string>(
  steps: readonly CreationDemoStep<StepId>[], savedStepId: string
): { step: CreationDemoStep<StepId>; index: number } | null {
  if (!steps.length) return null;
  const found = steps.findIndex((step) => step.id === savedStepId);
  const index = found < 0 ? 0 : found;
  return { step: steps[index], index };
}

interface CreationDemoLifecycle {
  restoredEntry: string | null;
  completedEntry: string | null;
  progressKey: string | null;
}

export function createCreationDemoLifecycle(): CreationDemoLifecycle {
  return { restoredEntry: null, completedEntry: null, progressKey: null };
}

function entryKey<StepId extends string>(props: GuidedCreationDemoProps<StepId>, stepId: string): string {
  return JSON.stringify([props.journeyId, props.chapter, props.draftId, stepId]);
}

function progressEvent<StepId extends string>(props: GuidedCreationDemoProps<StepId>, stepId: string): ExperimentDemoStepProgressEvent {
  return { journeyId: props.journeyId, chapter: props.chapter, draftId: props.draftId, stepId, fingerprint: props.fingerprint };
}

function persistProgress<StepId extends string>(
  props: GuidedCreationDemoProps<StepId>, stepId: string, lifecycle: CreationDemoLifecycle
): void {
  const event = progressEvent(props, stepId);
  const key = JSON.stringify(event);
  if (lifecycle.progressKey === key) return;
  // Set the guard before invoking a callback which may synchronously update the parent.
  lifecycle.progressKey = key;
  props.onProgress(event);
}

/** Entry and persistence effects are independent of changing callbacks, targets and draft values. */
export function synchronizeCreationDemo<StepId extends string>(
  props: GuidedCreationDemoProps<StepId>, lifecycle: CreationDemoLifecycle
): boolean {
  if (!props.active || props.paused) {
    lifecycle.restoredEntry = null;
    return false;
  }
  const resolved = resolveCreationDemoStep(props.steps, props.savedStepId);
  if (!resolved || !props.ready || props.loading || props.error) return false;
  const key = entryKey(props, resolved.step.id);
  const entering = lifecycle.restoredEntry !== key;
  if (entering) {
    lifecycle.restoredEntry = key;
    props.onRestoreStep(resolved.step);
  }
  persistProgress(props, resolved.step.id, lifecycle);
  if (resolved.step.id !== props.completionStepId) {
    lifecycle.completedEntry = null;
  } else if (lifecycle.completedEntry !== key) {
    lifecycle.completedEntry = key;
    props.onChapterComplete({ journeyId: props.journeyId, chapter: props.chapter, draftId: props.draftId });
  }
  return entering;
}

function targetSelector(targetId: string): string {
  // Attribute string escaping also works in SSR, without requiring window.CSS.escape.
  const escaped = targetId.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\f]/g, '\\a ');
  return `[data-experiment-demo-target="${escaped}"]`;
}

/** The same adapter supplies rendered controls and their explicit-transition callbacks. */
export function creationDemoOverlayProps<StepId extends string>(
  props: GuidedCreationDemoProps<StepId>, lifecycle: CreationDemoLifecycle,
  blocked = false, onBlockedChange: (blocked: boolean) => void = () => {}
): GuidedTourOverlayProps {
  const resolved = resolveCreationDemoStep(props.steps, props.savedStepId);
  const current = resolved?.step;
  const index = resolved?.index ?? 0;
  const ready = Boolean(current && props.ready && !props.loading && !props.error);
  const chapterName = props.chapter === 'policy' ? 'policy scenario' : 'sensitivity analysis';
  const transition = (direction: -1 | 1) => {
    if (!props.active || props.paused || !current || (direction > 0 && !ready)) return;
    const next = props.steps[index + direction];
    if (!next) return;
    if (direction > 0 && props.onBeforeAdvance?.(next) === false) {
      onBlockedChange(true);
      return;
    }
    onBlockedChange(false);
    // The overlay owns action gating, including its navigable missing-target fallback.
    persistProgress(props, next.id, lifecycle);
  };
  const isCompletion = current?.id === props.completionStepId;
  const teachingCount = Math.max(1, props.steps.filter((step) => step.id !== props.completionStepId).length);
  return {
    active: props.active && !props.paused,
    demoLabel: props.label,
    step: {
      id: current?.id ?? `${props.chapter}-unavailable`,
      title: current?.title ?? 'Practice guide unavailable',
      body: current?.body ?? 'Exit this guide and start it again from Home.',
      bullets: current?.bullets,
      kind: current?.kind ?? 'info',
      target: current?.targetId ? targetSelector(current.targetId) : null,
      additionalInteractiveTargets: current?.additionalTargetIds?.map(targetSelector),
      interactive: current?.kind === 'action' || current?.interactive === true,
      actionHint: current?.actionHint,
      completionNote: current?.completionNote,
      unavailableBody: 'This part of the builder is unavailable. You can go back, continue to the next stop, or exit the guide.'
    },
    stepIndex: Math.min(index, teachingCount - 1),
    stepCount: teachingCount,
    isComplete: ready && current?.kind === 'action' && props.isStepComplete(current),
    onBack: () => transition(-1),
    onNext: () => transition(1),
    onExit: props.onExit,
    availability: ready ? 'ready' : 'loading',
    loadingTitle: props.error ? `Could not load the ${chapterName}` : current ? `Loading the ${chapterName}` : 'Practice guide unavailable',
    loadingBody: props.error || (current ? 'The practice builder is loading. Your guide will continue when it is ready.' : 'Exit this guide and start it again from Home.'),
    feedback: ready ? props.feedback || (blocked ? 'Check the highlighted fields before continuing.' : undefined) : undefined,
    completionActions: props.error
      ? [{ id: 'retry', label: 'Retry', onClick: props.onRetryLoad, primary: true }]
      : ready && isCompletion ? [
        { id: 'finish', label: 'Finish', onClick: props.onFinish, primary: true },
        ...(props.onViewSubmittedRun ? [{ id: 'view-run', label: 'View your run', onClick: props.onViewSubmittedRun }] : []),
        ...(props.onExploreResults ? [{ id: 'explore-results', label: 'Explore example policy results', onClick: props.onExploreResults }] : []),
        { id: 'return-to-editing', label: 'Return to editing', onClick: props.onPause }
      ] : undefined
  };
}

/** Progress belongs to the practice coordinator; only explicit Back/Next emits a new stop. */
export function GuidedCreationDemo<StepId extends string>(props: GuidedCreationDemoProps<StepId>) {
  const lifecycle = useRef(createCreationDemoLifecycle());
  const current = useRef(props);
  current.current = props;
  const [blocked, setBlocked] = useState(false);
  const stepId = resolveCreationDemoStep(props.steps, props.savedStepId)?.step.id ?? '';
  const key = entryKey(props, stepId);
  useEffect(() => {
    if (synchronizeCreationDemo(current.current, lifecycle.current)) setBlocked(false);
  }, [key, props.active, props.paused, props.ready, props.loading, props.error, props.fingerprint, props.completionStepId]);
  return <GuidedTourOverlay {...creationDemoOverlayProps(props, lifecycle.current, blocked, setBlocked)} />;
}
