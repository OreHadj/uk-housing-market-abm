import { useLayoutEffect } from 'react';
import { Link } from 'react-router-dom';
import { buildResultsTypeHref } from '../lib/workspaceNavigation';

const RESULTS_ACTIONS = [
  {
    type: 'manual',
    label: 'Policy scenario results',
    description: 'Open saved scenarios and compare them with a baseline.'
  },
  {
    type: 'sensitivity',
    label: 'Sensitivity analysis results',
    description: 'Explore results across tested policy settings.'
  }
] as const;

export function ResultsLandingPage({ resultsSearch = '' }: { resultsSearch?: string }) {
  const search = new URLSearchParams(resultsSearch);
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, []);
  return (
    <section className="wrap experiments-launcher results-launcher" aria-label="Explore results">
      <nav className="experiments-launch-actions" aria-label="Results type">
        {RESULTS_ACTIONS.map((action) => (
          <Link className="experiment-launch-action" to={buildResultsTypeHref(search, action.type)} key={action.type}>
            <span className="experiment-launch-copy">
              <strong>{action.label}</strong>
              <span>{action.description}</span>
            </span>
          </Link>
        ))}
      </nav>
    </section>
  );
}
