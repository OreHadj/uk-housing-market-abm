import { Navigate } from 'react-router-dom';

export function ModelResultsPage() {
  return <Navigate to="/results?type=manual&mode=view" replace />;
}
