import { Navigate } from 'react-router-dom';

export function RunExperimentsPage() {
  return <Navigate to="/results?type=manual&mode=run" replace />;
}
