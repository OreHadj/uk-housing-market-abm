import { Link } from 'react-router-dom';

const EXPERIMENT_ACTIONS = [
  {
    to: '/scenarios/new',
    label: 'New policy scenario',
    description: 'Test a specific combination of policy settings and compare the results with a baseline.'
  },
  {
    to: '/sensitivity/new',
    label: 'New sensitivity analysis',
    description: 'Vary one policy instrument across a range to see how model outcomes respond.'
  }
] as const;

/** The top-level Experiments destination is intentionally only a choice of creation flow. */
export function ExperimentsLandingPage() {
  return (
    <section className="wrap experiments-launcher" aria-label="Create an experiment">
      <nav className="experiments-launch-actions" aria-label="Experiment type">
        {EXPERIMENT_ACTIONS.map((action) => (
          <Link className="experiment-launch-action" to={action.to} key={action.to}>
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
