import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MODEL_EVIDENCE_DEMO_LAUNCH_HREF } from '../lib/modelEvidenceDemo';
import { POLICY_EXPERIMENT_DEMO_LAUNCH_HREF } from '../lib/policyExperimentDemo';

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
    to: null
  },
  {
    label: 'Run experiment demo',
    description: 'Learn how to create a policy scenario and a sensitivity analysis.',
    to: POLICY_EXPERIMENT_DEMO_LAUNCH_HREF
  },
  {
    label: 'Run results demo',
    description: 'Learn how to open, read, and compare finished results.',
    to: null
  },
  {
    label: 'Run model evidence demo',
    description: 'Learn how to review calibration and validation evidence.',
    to: MODEL_EVIDENCE_DEMO_LAUNCH_HREF
  }
] as const;

export function HomePage() {
  const navigate = useNavigate();
  const [isDemoChooserOpen, setIsDemoChooserOpen] = useState(false);
  const demoTriggerRef = useRef<HTMLButtonElement>(null);
  const demoDialogRef = useRef<HTMLElement>(null);
  const demoCloseButtonRef = useRef<HTMLButtonElement>(null);

  const closeDemoChooser = useCallback(() => {
    setIsDemoChooserOpen(false);
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
                <h2 id="demo-chooser-title">Choose a demo</h2>
                <p id="demo-chooser-description">
                  Follow the complete walkthrough, or explore one part of the application.
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

            <div className="demo-chooser-options">
              {DEMO_CHOICES.map((choice) => (
                <button
                  type="button"
                  className="demo-chooser-option"
                  key={choice.label}
                  disabled={!choice.to}
                  onClick={choice.to ? () => navigate(choice.to) : undefined}
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
