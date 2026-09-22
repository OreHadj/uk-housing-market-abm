import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  buildResultsTypeHref,
  getExperimentSetupPath,
  getExperimentType,
  getResultsType,
  isResultsLanding,
  resolveExperimentSetupHref
} from '../lib/workspaceNavigation';

const WORKSPACE_TYPES = [
  {
    type: 'manual',
    label: 'Policy scenarios',
    experimentDescription: 'Test a specific combination of policy settings and compare the results with a baseline.',
    resultsDescription: 'Follow a submitted policy scenario, or open and compare finished runs.'
  },
  {
    type: 'sensitivity',
    label: 'Sensitivity analysis',
    experimentDescription: 'Vary one policy instrument across a range to see how model outcomes respond.',
    resultsDescription: 'Follow a submitted analysis, or read the results across its tested range.'
  }
] as const;

export function WorkspaceTypeNavigation({ area, resultsSearch = '' }: { area: 'experiments' | 'results'; resultsSearch?: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentSearch = new URLSearchParams(location.search);
  const isResultsView = location.pathname === '/results' && !isResultsLanding(currentSearch);
  const search = area === 'results' && !isResultsView ? new URLSearchParams(resultsSearch) : currentSearch;
  const activeType = area === 'experiments'
    ? getExperimentType(location.pathname)
    : isResultsView ? getResultsType(search) : null;

  return (
    <div
      className="sidebar-type-navigation"
      role="group"
      aria-label={area === 'experiments' ? 'Experiment type' : 'Results type'}
    >
      {WORKSPACE_TYPES.map((item) => {
        const setupPath = getExperimentSetupPath(item.type);
        return (
          <Link
            key={item.type}
            className={`sidebar-type-link${activeType === item.type ? ' active' : ''}`}
            aria-current={activeType === item.type ? 'page' : undefined}
            title={area === 'experiments' ? item.experimentDescription : item.resultsDescription}
            to={area === 'experiments' ? setupPath : buildResultsTypeHref(search, item.type)}
            replace={area === 'results' && isResultsView}
            onClick={area === 'experiments' ? (event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              if (location.pathname === setupPath) return;
              navigate(resolveExperimentSetupHref(item.type));
            } : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
