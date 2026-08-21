import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { AuthStatusPayload } from '../../shared/types';
import { loginWriteAccess } from '../lib/api';

interface LoginPageProps {
  authStatus: AuthStatusPayload;
  onLoginSuccess: (token: string | null) => Promise<void>;
}

const DEFAULT_EXPERIMENTS_RUN_PATH = '/experiments';

export function LoginPage({ authStatus, onLoginSuccess }: LoginPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const nextPath = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const raw = params.get('next')?.trim() ?? '';
    if (!raw || !raw.startsWith('/')) {
      return DEFAULT_EXPERIMENTS_RUN_PATH;
    }
    return raw;
  }, [location.search]);

  useEffect(() => {
    if ((!authStatus.authEnabled || authStatus.canWrite) && !authStatus.authMisconfigured) {
      navigate(nextPath, { replace: true });
    }
  }, [authStatus.authEnabled, authStatus.authMisconfigured, authStatus.canWrite, navigate, nextPath]);

  if ((!authStatus.authEnabled || authStatus.canWrite) && !authStatus.authMisconfigured) {
    return <Navigate to={nextPath} replace />;
  }

  if (authStatus.authMisconfigured) {
    return (
      <section className="login-layout">
        <article className="results-card login-card">
          <h2>Write Access Unavailable</h2>
          <p>
            This environment is misconfigured: model runs are enabled, but dashboard write credentials are not set on the
            API.
          </p>
          <p>Set `DASHBOARD_WRITE_USERNAME` and `DASHBOARD_WRITE_PASSWORD` in the API environment, then reload.</p>
        </article>
      </section>
    );
  }

  const submit = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      const response = await loginWriteAccess({
        username,
        password
      });
      if (!response.ok || !response.canWrite) {
        throw new Error('Invalid username or password.');
      }
      await onLoginSuccess(response.token ?? null);
      navigate(nextPath, { replace: true });
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  return (
    <section className="login-layout">
      <article className="results-card login-card">
        <h2>Write Access Login</h2>
        <p>Enter the dashboard write credentials to run experiments and manage runs.</p>
        <form onSubmit={handleSubmit}>
          {error && <p className="error-banner">{error}</p>}
          <label className="login-field">
            Username
            <input type="text" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </label>
          <label className="login-field">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button type="submit" className="primary-button" disabled={isSubmitting}>
            {isSubmitting ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </article>
    </section>
  );
}
