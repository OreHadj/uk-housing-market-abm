import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MODEL_EVIDENCE_DEMO_LAUNCH_HREF } from '../lib/modelEvidenceDemo';
import {
  EXPERIMENT_DEMO_COMBINED_LAUNCH_HREF,
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
    title: 'Model evidence',
    description: 'How the model was calibrated, and how closely its output matches the evidence.'
  }
] as const;

const DEMO_CHOOSER_ID = 'demo-chooser-dialog';

export const DEMO_CHOICES = [
  {
    label: 'Run full demo',
    description: 'Tour experiments, results, and model evidence from start to finish.',
    to: null,
    opensExperimentChooser: false
  },
  {
    label: 'Run experiment demo',
    description: 'Learn how to create a policy scenario and a sensitivity analysis.',
    to: null,
    opensExperimentChooser: true
  },
  {
    label: 'Run results demo',
    description: 'Learn how to open, read, and compare finished results.',
    to: null,
    opensExperimentChooser: false
  },
  {
    label: 'Run model evidence demo',
    description: 'Learn how to review calibration and validation evidence.',
    to: MODEL_EVIDENCE_DEMO_LAUNCH_HREF,
    opensExperimentChooser: false
  }
] as const;

export const EXPERIMENT_DEMO_CHOICES = [
  {
    label: 'Both — policy then sensitivity',
    description: 'Recommended: complete both creation chapters in sequence.',
    to: EXPERIMENT_DEMO_COMBINED_LAUNCH_HREF
  },
  {
    label: 'Policy scenario demo',
    description: 'Build and audit one edited policy configuration against its reference.',
    to: EXPERIMENT_DEMO_POLICY_LAUNCH_HREF
  },
  {
    label: 'Sensitivity analysis demo',
    description: 'Define and audit one policy-instrument sweep.',
    to: EXPERIMENT_DEMO_SENSITIVITY_LAUNCH_HREF
  }
] as const;

export function HomePage() {
  const navigate = useNavigate();
  const [isDemoChooserOpen, setIsDemoChooserOpen] = useState(false);
  const [demoChooserView, setDemoChooserView] = useState<'main' | 'experiment'>('main');
  const demoTriggerRef = useRef<HTMLButtonElement>(null);
  const demoDialogRef = useRef<HTMLElement>(null);
  const demoCloseButtonRef = useRef<HTMLButtonElement>(null);
  const demoBackButtonRef = useRef<HTMLButtonElement>(null);
  const experimentChoiceRef = useRef<HTMLButtonElement>(null);
  const previousDemoChooserViewRef = useRef<'main' | 'experiment'>('main');

  const closeDemoChooser = useCallback(() => {
    setIsDemoChooserOpen(false);
    setDemoChooserView('main');
  }, []);

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

  useEffect(() => {
    if (!isDemoChooserOpen) {
      previousDemoChooserViewRef.current = 'main';
      return;
    }
    if (previousDemoChooserViewRef.current === demoChooserView) return;
    previousDemoChooserViewRef.current = demoChooserView;
    const frame = window.requestAnimationFrame(() => {
      if (demoChooserView === 'experiment') demoBackButtonRef.current?.focus();
      else experimentChoiceRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [demoChooserView, isDemoChooserOpen]);

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
            <span>Take a guided tour of experiments, results, and model evidence.</span>
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
                  {demoChooserView === 'experiment' ? 'Two ways to test policy' : 'Choose a demo'}
                </h2>
                <p id="demo-chooser-description">
                  {demoChooserView === 'experiment'
                    ? 'A policy scenario tests one chosen set of changes against an unchanged reference. A sensitivity analysis varies one instrument across several values to show how outcomes respond. Both use a calibrated model, repeated seeds, saved drafts, and a final review before any run starts.'
                    : 'Follow the complete walkthrough, or explore one part of the application.'}
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

            {demoChooserView === 'experiment' && (
              <button
                ref={demoBackButtonRef}
                type="button"
                className="demo-chooser-back"
                onClick={() => setDemoChooserView('main')}
              >
                ← Back to demos
              </button>
            )}

            <div className="demo-chooser-options">
              {(demoChooserView === 'experiment' ? EXPERIMENT_DEMO_CHOICES : DEMO_CHOICES).map((choice) => (
                <button
                  ref={'opensExperimentChooser' in choice && choice.opensExperimentChooser
                    ? experimentChoiceRef
                    : undefined}
                  type="button"
                  className="demo-chooser-option"
                  key={choice.label}
                  disabled={!choice.to && !('opensExperimentChooser' in choice && choice.opensExperimentChooser)}
                  onClick={'opensExperimentChooser' in choice && choice.opensExperimentChooser
                    ? () => setDemoChooserView('experiment')
                    : choice.to
                      ? () => navigate(choice.to)
                      : undefined}
                >
                  <strong>{choice.label}</strong>
                  <span>{choice.description}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
