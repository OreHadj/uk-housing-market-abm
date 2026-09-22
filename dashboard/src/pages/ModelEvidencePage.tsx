import { Navigate, useSearchParams } from 'react-router-dom';
import { legacyModelInformationDemoHref } from '../lib/guidedDemos/modelInformation';
import { ComparePage } from './ComparePage';
import { ValidationPage } from './ValidationPage';
import { getModelInformationView } from '../lib/workspaceNavigation';

/** The shared guide owns one short journey across both ordinary evidence pages. */
export function ModelEvidencePage() {
  const [searchParams] = useSearchParams();
  const legacyHref = legacyModelInformationDemoHref(searchParams);
  if (legacyHref) return <Navigate to={legacyHref} replace />;
  const activeView = getModelInformationView(searchParams);
  return (
    <section className="run-exp-layout workspace-page model-evidence-page">
      {activeView === 'calibration' ? <ComparePage /> : <ValidationPage />}
    </section>
  );
}
