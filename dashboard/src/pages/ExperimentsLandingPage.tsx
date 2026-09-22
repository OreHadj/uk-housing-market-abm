import { Link, useNavigate } from 'react-router-dom';
import { getExperimentSetupPath, resolveExperimentSetupHref } from '../lib/workspaceNavigation';

const EXPERIMENT_ACTIONS = [
  {
    type: 'manual',
    label: 'Policy scenario',
    description: 'Test a specific combination of policy settings and compare the results with a baseline.'
  },
  {
    type: 'sensitivity',
    label: 'Sensitivity analysis',
    description: 'Vary policy settings across a range to see how model outcomes respond.'
  }
] as const;

export function ExperimentsLandingPage() {
  const navigate = useNavigate();
  return (
    <section className="wrap experiments-launcher" aria-label="Create an experiment">
      <nav className="experiments-launch-actions" aria-label="Experiment type">
        {EXPERIMENT_ACTIONS.map((action) => (
          <Link
            className="experiment-launch-action"
            to={getExperimentSetupPath(action.type)}
            key={action.type}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              navigate(resolveExperimentSetupHref(action.type));
            }}
          >
            <span className="experiment-launch-copy">
              <strong>{action.label}</strong>
              <span>{action.description}</span>
            </span>
            <span className="experiment-launch-arrow" aria-hidden="true">→</span>
          </Link>
        ))}
      </nav>
    </section>
  );
}
