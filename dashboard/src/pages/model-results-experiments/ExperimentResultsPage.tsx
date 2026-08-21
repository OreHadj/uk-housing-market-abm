import { Navigate } from 'react-router-dom';

export function ExperimentResultsPage() {
  return <Navigate to="/results?type=sensitivity&mode=view" replace />;
}
