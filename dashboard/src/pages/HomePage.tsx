import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { buildGuidedDemoHref, GUIDED_DEMOS, hasGuidedDemoExamples } from '../lib/guidedDemos/registry';
import { fetchResultsRuns, fetchSensitivityExperiments } from '../lib/api';
import { MODEL_INFORMATION_DEMO } from '../lib/guidedDemos/modelInformation';
import type { GuidedDemoId } from '../lib/guidedDemos/types';
import {
  EXPERIMENT_DEMO_POLICY_LAUNCH_HREF,
  EXPERIMENT_DEMO_SENSITIVITY_LAUNCH_HREF
} from '../lib/experimentDemo';

/**
 * These deliberately describe user goals rather than repeat the destination labels in the nav.
 */
const DESTINATIONS = [
  {
    to: '/experiments',
    title: 'Experiments',
    description: 'Set up a policy scenario, or sweep one instrument across a range of values.'
  },
  {
    to: '/results',
    title: 'Results',
    description: 'Open a finished scenario or sweep, and compare it against another run.'
  },
  {
    to: '/model-evidence',
    title: 'Model information',
    description: 'How the model was calibrated, and how closely its output matches the evidence.'
  }
] as const;

const DEMO_CHOOSER_ID = 'demo-chooser-dialog';

export const DEMO_SECTIONS = [
  { id: 'getting-started', label: 'Getting started' },
  { id: 'creating-experiments', label: 'Creating experiments' },
  { id: 'exploring-results', label: 'Exploring results' },
  { id: 'model-information', label: 'Model information' }
] as const;

interface DemoChoice {
  label: string;
  description: string;
  to: string;
  section: typeof DEMO_SECTIONS[number]['id'];
  startHere: boolean;
  requiresExamples: boolean;
  guidedDemoId?: GuidedDemoId;
  unavailableReason?: string;
}

export const DEMO_CHOICES: readonly DemoChoice[] = [
  {
    section: 'getting-started',
    label: 'Explore the dashboard',
    description: 'A brief introduction to each page and what you can do there.',
    to: buildGuidedDemoHref('dashboard-overview'),
    startHere: true,
    requiresExamples: false
  },
  {
    section: 'creating-experiments',
    label: 'Create a policy scenario',
    description: 'Prepare a policy change, submit a short run and follow its results.',
    to: EXPERIMENT_DEMO_POLICY_LAUNCH_HREF,
    startHere: false,
    requiresExamples: false
  },
  {
    section: 'creating-experiments',
    label: 'Create a sensitivity analysis',
    description: 'Test a range of policy settings, submit a short analysis and open its report.',
    to: EXPERIMENT_DEMO_SENSITIVITY_LAUNCH_HREF,
    startHere: false,
    requiresExamples: false
  },
  // New results walkthroughs become accessible as soon as their implementations are registered.
  ...GUIDED_DEMOS.filter((demo) => demo.id.endsWith('-results')).map((demo): DemoChoice => ({
    section: 'exploring-results',
    label: demo.label,
    description: demo.description,
    to: buildGuidedDemoHref(demo.id),
    guidedDemoId: demo.id,
    startHere: false,
    requiresExamples: Boolean(demo.requiredRunIds.length || demo.requiredExperimentIds.length)
  })),
  {
    section: 'model-information',
    label: MODEL_INFORMATION_DEMO.label,
    description: MODEL_INFORMATION_DEMO.description,
    to: buildGuidedDemoHref('model-information'),
    startHere: false,
    requiresExamples: false
  }
];

export function HomePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isDemoChooserOpen, setIsDemoChooserOpen] = useState(searchParams.get('chooseDemo') === '1');
  const [exampleAvailability, setExampleAvailability] = useState<Partial<Record<GuidedDemoId, 'ready' | 'missing'>>>({});
  const demoTriggerRef = useRef<HTMLButtonElement>(null);
  const demoDialogRef = useRef<HTMLElement>(null);
  const demoCloseButtonRef = useRef<HTMLButtonElement>(null);

  const closeDemoChooser = useCallback(() => {
    setIsDemoChooserOpen(false);
  }, []);

  useEffect(() => {
    if (searchParams.get('chooseDemo') !== '1') return;
    setIsDemoChooserOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('chooseDemo');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!isDemoChooserOpen) return;
    let cancelled = false;
    setExampleAvailability({});
    void Promise.allSettled([fetchResultsRuns(true), fetchSensitivityExperiments(true)]).then(([runs, experiments]) => {
      const runIds = runs.status === 'fulfilled' ? runs.value.filter((run) => run.isExample).map((run) => run.runId) : [];
      const experimentIds = experiments.status === 'fulfilled' ? experiments.value.experiments.filter((experiment) => experiment.isExample).map((experiment) => experiment.experimentId) : [];
      if (!cancelled) setExampleAvailability(Object.fromEntries(GUIDED_DEMOS.map((demo) => [
        demo.id, hasGuidedDemoExamples(demo, runIds, experimentIds) ? 'ready' : 'missing'
      ])));
    });
    return () => { cancelled = true; };
  }, [isDemoChooserOpen]);

  useEffect(() => {
    if (!isDemoChooserOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const dialog = demoDialogRef.current;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDemoChooser();
        return;
      }

      if (event.key !== 'Tab' || !dialog) {
        return;
      }

      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );

      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === firstElement || !dialog.contains(activeElement))) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && (activeElement === lastElement || !dialog.contains(activeElement))) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.body.style.overflow = 'hidden';
    demoCloseButtonRef.current?.focus();
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      demoTriggerRef.current?.focus();
    };
  }, [closeDemoChooser, isDemoChooserOpen]);

  return (
    <div className="wrap home-launcher">
      <h2 className="home-title">
        See what a mortgage-policy change <em>does</em> to the UK housing market.
      </h2>

      <div className="home-actions">
        {DESTINATIONS.map((destination) => (
          <Link className="home-action" to={destination.to} key={destination.to}>
            <span className="home-action-text">
              <strong>{destination.title}</strong>
              <span>{destination.description}</span>
            </span>
            <span className="home-action-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        ))}

        <button
          ref={demoTriggerRef}
          type="button"
          className="home-action"
          aria-haspopup="dialog"
          aria-expanded={isDemoChooserOpen}
          aria-controls={DEMO_CHOOSER_ID}
          onClick={() => setIsDemoChooserOpen(true)}
        >
          <span className="home-action-text">
            <strong>Run demo</strong>
            <span>Find your way around, practise creating an experiment, or explore saved results.</span>
          </span>
          <span className="home-action-arrow" aria-hidden="true">
            →
          </span>
        </button>
      </div>

      {isDemoChooserOpen && (
        <div
          className="demo-chooser-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeDemoChooser();
            }
          }}
        >
          <section
            ref={demoDialogRef}
            id={DEMO_CHOOSER_ID}
            className="demo-chooser-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-chooser-title"
            aria-describedby="demo-chooser-description"
          >
            <div className="demo-chooser-header">
              <div>
                <h2 id="demo-chooser-title">
                  Choose a demo
                </h2>
                <p id="demo-chooser-description">
                  Find your way around, create experiments, explore results, or understand the model.
                </p>
              </div>
              <button
                ref={demoCloseButtonRef}
                type="button"
                className="demo-chooser-close"
                aria-label="Close demo chooser"
                onClick={closeDemoChooser}
              >
                ×
              </button>
            </div>

            <div className="demo-chooser-body">
              {DEMO_SECTIONS.map((section) => <section className="demo-chooser-section" key={section.id} aria-labelledby={`demo-section-${section.id}`}>
                <h3 id={`demo-section-${section.id}`}>{section.label}</h3>
                <div className="demo-chooser-options">
              {DEMO_CHOICES.filter((choice) => choice.section === section.id).map((choice) => {
                const availability = choice.guidedDemoId ? exampleAvailability[choice.guidedDemoId] ?? 'loading' : 'ready';
                return (
                <button
                  type="button"
                  className="demo-chooser-option"
                  key={choice.label}
                  disabled={Boolean(choice.unavailableReason) || (choice.requiresExamples && availability !== 'ready')}
                  onClick={() => { closeDemoChooser(); navigate(choice.to); }}
                >
                  <strong>{choice.label}{'startHere' in choice && choice.startHere && <span className="example-badge">Start here</span>}</strong>
                  <span>{choice.description}</span>
                  {choice.unavailableReason && <span>{choice.unavailableReason}</span>}
                  {choice.requiresExamples && availability !== 'ready' && <span>{availability === 'loading' ? 'Checking bundled examples…' : "This example isn't available on this installation"}</span>}
                </button>
                );
              })}
                </div>
              </section>)}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
