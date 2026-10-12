import { useLayoutEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { buildRunHistoryTypeHref, getRunHistoryType } from '../../lib/workspaceNavigation';
import { PolicyRunHistory } from './PolicyRunHistory';
import { SensitivityRunHistory } from './SensitivityRunHistory';

const RUN_HISTORY_ACTIONS = [
  {
    type: 'manual',
    label: 'Policy scenario runs',
    description: 'Search, rename and delete saved policy scenarios.'
  },
  {
    type: 'sensitivity',
    label: 'Sensitivity analysis runs',
    description: 'Search, rename and delete saved sensitivity analyses.'
  }
] as const;

/**
 * Managing saved runs. Bare Run History opens a chooser like Results; each kind then lists its runs,
 * and "View results" opens a run's Report.
 */
export function RunHistoryPage({ canWrite, canDeleteResults, deleteKeyRequired }: {
  canWrite: boolean;
  canDeleteResults: boolean;
  deleteKeyRequired: boolean;
}) {
  const [searchParams] = useSearchParams();
  const type = getRunHistoryType(searchParams);
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [type]);

  if (!type) {
    return (
      <section className="wrap experiments-launcher results-launcher" aria-label="Run History">
        <nav className="experiments-launch-actions" aria-label="Run History type">
          {RUN_HISTORY_ACTIONS.map((action) => (
            <Link className="experiment-launch-action" to={buildRunHistoryTypeHref(action.type)} key={action.type}>
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

  return (
    <section className="run-exp-layout workspace-page">
      <section className="results-layout run-history-layout">
        {type === 'manual'
          ? <PolicyRunHistory key="manual" canWrite={canWrite} canDeleteResults={canDeleteResults} deleteKeyRequired={deleteKeyRequired} />
          : <SensitivityRunHistory key="sensitivity" canWrite={canWrite} canDeleteResults={canDeleteResults} deleteKeyRequired={deleteKeyRequired} />}
      </section>
    </section>
  );
}
