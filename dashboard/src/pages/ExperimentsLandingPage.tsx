import { Link, useNavigate } from 'react-router-dom';
import { createScenarioDraftId, resumableScenarioDraftId } from '../lib/scenarioDraft';
import { createSensitivityDraftId, resumableSensitivityDraftId } from '../lib/sensitivityDraft';
import type { ExperimentType } from './experiments/types';

const EXPERIMENT_ACTIONS = [
  {
    type: 'manual',
    to: '/scenarios/new',
    label: 'Policy run',
    description: 'Test a specific combination of policy settings and compare the results with a baseline.'
  },
  {
    type: 'sensitivity',
    to: '/sensitivity/new',
    label: 'Sensitivity analysis',
    description: 'Vary one policy instrument across a range to see how model outcomes respond.'
  }
] as const;

/** Shared type navigation stays above the selected experiment's setup workflow. */
export function ExperimentsLandingPage({ activeType }: { activeType?: ExperimentType }) {
  const navigate = useNavigate();
  return (
    <section className="experiment-type-picker" aria-label="Create an experiment">
      <nav className="experiment-type-selector" aria-label="Experiment type">
        {EXPERIMENT_ACTIONS.map((action) => (
          <Link
            className={`experiment-type-choice${activeType === action.type ? ' active' : ''}`}
            to={action.to}
            key={action.type}
            aria-current={activeType === action.type ? 'page' : undefined}
            title={action.description}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              if (activeType === action.type) return;
              // Resolve before navigating so the destination can hydrate its own draft immediately.
              const draftId = action.type === 'manual'
                ? resumableScenarioDraftId() || createScenarioDraftId()
                : resumableSensitivityDraftId() || createSensitivityDraftId();
              navigate(`${action.to}?${new URLSearchParams({ draft: draftId })}`);
            }}
          >
            {action.label}
          </Link>
        ))}
      </nav>
      {!activeType && (
        <p className="experiment-type-guidance">Choose a policy run or sensitivity analysis to begin or resume its setup.</p>
      )}
    </section>
  );
}
