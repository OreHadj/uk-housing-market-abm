type StartQueuedExperiment = () => void;

interface QueuedExperiment {
  jobRef: string;
  start: StartQueuedExperiment;
  deferStart: boolean;
}

const pendingExperiments: QueuedExperiment[] = [];
let activeJobRef: string | null = null;

function startNextExperiment(): void {
  if (activeJobRef || pendingExperiments.length === 0) {
    return;
  }

  const next = pendingExperiments.shift();
  if (!next) {
    return;
  }

  activeJobRef = next.jobRef;
  const start = () => {
    if (activeJobRef !== next.jobRef) {
      return;
    }
    try {
      next.start();
    } catch {
      finishLocalExperiment(next.jobRef);
    }
  };
  if (next.deferStart) {
    queueMicrotask(start);
  } else {
    start();
  }
}

/**
 * Manual scenarios and sensitivity analyses share the same model runtime. Keep one FIFO queue so
 * either kind can be submitted while another is active without competing for the same resources.
 */
export function enqueueLocalExperiment(
  jobRef: string,
  start: StartQueuedExperiment,
  options: { deferStart?: boolean } = {}
): void {
  if (activeJobRef === jobRef || pendingExperiments.some((entry) => entry.jobRef === jobRef)) {
    throw new Error(`Experiment is already queued: ${jobRef}`);
  }
  pendingExperiments.push({ jobRef, start, deferStart: options.deferStart ?? false });
  startNextExperiment();
}

export function finishLocalExperiment(jobRef: string): void {
  if (activeJobRef === jobRef) {
    activeJobRef = null;
  } else {
    const index = pendingExperiments.findIndex((entry) => entry.jobRef === jobRef);
    if (index >= 0) {
      pendingExperiments.splice(index, 1);
    }
  }
  startNextExperiment();
}

export function cancelQueuedLocalExperiment(jobRef: string): void {
  const index = pendingExperiments.findIndex((entry) => entry.jobRef === jobRef);
  if (index >= 0) {
    pendingExperiments.splice(index, 1);
  }
}

export function resetLocalExperimentQueueForTests(jobRefPrefix: string): void {
  for (let index = pendingExperiments.length - 1; index >= 0; index -= 1) {
    if (pendingExperiments[index]?.jobRef.startsWith(jobRefPrefix)) {
      pendingExperiments.splice(index, 1);
    }
  }
  if (activeJobRef?.startsWith(jobRefPrefix)) {
    activeJobRef = null;
  }
  startNextExperiment();
}
