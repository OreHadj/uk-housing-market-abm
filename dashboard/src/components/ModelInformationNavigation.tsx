import { Link, useLocation } from 'react-router-dom';
import {
  MODEL_INFORMATION_VIEWS,
  buildModelInformationViewHref,
  getModelInformationView
} from '../lib/workspaceNavigation';

export function ModelInformationNavigation({ modelInformationSearch = '' }: { modelInformationSearch?: string }) {
  const location = useLocation();
  const onModelInformation = location.pathname === '/model-evidence';
  const search = new URLSearchParams(onModelInformation ? location.search : modelInformationSearch);
  const activeView = onModelInformation ? getModelInformationView(search) : null;

  return (
    <div className="sidebar-type-navigation" role="group" aria-label="Model information sections">
      {MODEL_INFORMATION_VIEWS.map((view) => (
        <Link
          key={view.id}
          className={`sidebar-type-link${activeView === view.id ? ' active' : ''}`}
          aria-current={activeView === view.id ? 'page' : undefined}
          title={view.description}
          to={buildModelInformationViewHref(search, view.id)}
          replace={onModelInformation}
        >
          {view.label}
        </Link>
      ))}
    </div>
  );
}
