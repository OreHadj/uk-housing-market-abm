import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { AuthStatusPayload } from '../shared/types';
import {
  type ApiViewMode,
  fetchAuthStatus,
  logoutWriteAccess,
  setApiAuthToken,
  setApiViewMode
} from './lib/api';
import { ExperimentsLandingPage } from './pages/ExperimentsLandingPage';
import { ExperimentsPage } from './pages/ExperimentsPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { ModelEvidencePage } from './pages/ModelEvidencePage';
import { ResultsPage } from './pages/ResultsPage';

const AUTH_TOKEN_STORAGE_KEY = 'dashboard.writeAuthToken';
const VIEW_MODE_STORAGE_KEY = 'dashboard.viewMode';
const LEGACY_PREVIEW_MODE_STORAGE_KEY = 'dashboard.prodPreviewEnabled';
const EXPERIMENTS_VIEW_PATH = '/experiments';

type PrimaryDestination = 'home' | 'experiments' | 'results' | 'model-evidence';

function getActivePrimaryDestination(pathname: string): PrimaryDestination | null {
  if (pathname === '/') return 'home';
  if (pathname === '/experiments') return 'experiments';
  if (pathname === '/results') return 'results';
  if (pathname === '/model-evidence' || pathname === '/calibration' || pathname === '/validation') {
    return 'model-evidence';
  }

  if (
    pathname === '/scenarios' ||
    pathname === '/scenarios/new' ||
    pathname === '/sensitivity' ||
    pathname === '/sensitivity/new' ||
    pathname === '/runs' ||
    pathname === '/new-scenario' ||
    pathname === '/compare'
  ) return 'experiments';
  return null;
}

/**
 * /compare was a separate page that rendered the same ManualResultsView as /scenarios, differing
 * only in its heading. Comparison is a state of that view, so the alias redirects and carries its
 * run-selection params through, keeping any links already shared elsewhere working.
 */
function LegacyCompareRedirect() {
  const location = useLocation();
  return <Navigate to={`/scenarios${location.search}`} replace />;
}

/** Keep existing evidence links working while moving both views under one primary destination. */
function LegacyEvidenceRedirect({ view }: { view: 'calibration' | 'validation' }) {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  searchParams.set('view', view);
  return <Navigate to={`/model-evidence?${searchParams.toString()}`} replace />;
}

const DEFAULT_AUTH_STATUS: AuthStatusPayload = {
  authEnabled: false,
  canWrite: true,
  canDownloadResults: true,
  canDeleteResults: true,
  deleteKeyRequired: false,
  authMisconfigured: false,
  modelRunsEnabled: false,
  modelRunsConfigured: false,
  modelRunsDisabledReason: null
};

const VIEW_MODE_OPTIONS: Array<{ value: ApiViewMode; label: string }> = [
  { value: 'dev', label: 'Dev mode' },
  { value: 'preview_desktop', label: 'Preview desktop' },
  { value: 'preview_cloud', label: 'Preview cloud' }
];

function loadStoredAuthToken(): string | null {
  try {
    return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistAuthToken(token: string | null): void {
  try {
    if (token) {
      window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore persistence failures
  }
}

function isApiViewMode(value: string | null): value is ApiViewMode {
  return value === 'dev' || value === 'preview_desktop' || value === 'preview_cloud';
}

function loadStoredViewMode(isDevEnv: boolean): ApiViewMode {
  if (!isDevEnv) {
    return 'preview_cloud';
  }

  try {
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (isApiViewMode(stored)) {
      return stored;
    }
    if (stored === 'non_dev_preview' || window.localStorage.getItem(LEGACY_PREVIEW_MODE_STORAGE_KEY) === 'true') {
      return 'preview_cloud';
    }
  } catch {
    return 'dev';
  }

  return 'dev';
}

function persistViewMode(mode: ApiViewMode, isDevEnv: boolean): void {
  try {
    if (isDevEnv) {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
      window.localStorage.removeItem(LEGACY_PREVIEW_MODE_STORAGE_KEY);
    } else {
      window.localStorage.removeItem(VIEW_MODE_STORAGE_KEY);
    }
  } catch {
    // ignore persistence failures
  }
}

function getDesktopApi(): UkHousingDesktopApi | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.ukHousingDesktop ?? null;
}

export function App() {
  const location = useLocation();
  const isDevEnv = import.meta.env.DEV;
  const [desktopApi] = useState<UkHousingDesktopApi | null>(() => getDesktopApi());
  const isDesktopRuntime = Boolean(desktopApi);
  const [viewMode, setViewMode] = useState<ApiViewMode>(() => loadStoredViewMode(isDevEnv));
  const [authStatus, setAuthStatus] = useState<AuthStatusPayload>(DEFAULT_AUTH_STATUS);
  const [authInitialised, setAuthInitialised] = useState(false);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [authError, setAuthError] = useState('');
  const [desktopActionError, setDesktopActionError] = useState('');
  const [desktopActionMessage, setDesktopActionMessage] = useState('');
  const experimentsVisible = true;
  const modelEvidenceVisible = true;
  const browserAuthControlsVisible = !isDesktopRuntime && viewMode !== 'preview_desktop';
  const activeViewModeLabel = VIEW_MODE_OPTIONS.find((option) => option.value === viewMode)?.label ?? 'Dev mode';

  const loginPath = `/login?next=${encodeURIComponent(EXPERIMENTS_VIEW_PATH)}`;
  const activePrimaryDestination = getActivePrimaryDestination(location.pathname);

  const refreshAuthStatus = useCallback(async () => {
    try {
      const status = await fetchAuthStatus();
      setAuthStatus(status);
      if (!isDesktopRuntime && status.authEnabled && !status.canWrite) {
        setApiAuthToken(null);
        persistAuthToken(null);
      }
      setAuthError('');
    } catch (error) {
      setAuthError((error as Error).message);
    } finally {
      setAuthLoaded(true);
    }
  }, [isDesktopRuntime]);

  useEffect(() => {
    let cancelled = false;

    async function initialiseAuthToken(): Promise<void> {
      try {
        if (desktopApi) {
          const token = await desktopApi.getApiAuthToken();
          if (cancelled) {
            return;
          }
          setApiAuthToken(token);
          persistAuthToken(null);
        } else {
          setApiAuthToken(loadStoredAuthToken());
        }
      } catch (error) {
        if (!cancelled) {
          setApiAuthToken(null);
          setAuthError((error as Error).message);
        }
      } finally {
        if (!cancelled) {
          setAuthInitialised(true);
        }
      }
    }

    void initialiseAuthToken();

    return () => {
      cancelled = true;
    };
  }, [desktopApi]);

  useEffect(() => {
    if (!authInitialised) {
      return;
    }
    if (!isDevEnv && viewMode !== 'preview_cloud') {
      setViewMode('preview_cloud');
      return;
    }
    persistViewMode(viewMode, isDevEnv);
    setApiViewMode(viewMode);
    void refreshAuthStatus();
  }, [authInitialised, experimentsVisible, isDevEnv, refreshAuthStatus, viewMode]);

  const handleLoginSuccess = useCallback(
    async (token: string | null) => {
      setApiAuthToken(token);
      persistAuthToken(token);
      await refreshAuthStatus();
    },
    [refreshAuthStatus]
  );

  const handleLogout = useCallback(async () => {
    if (isDesktopRuntime) {
      return;
    }
    try {
      await logoutWriteAccess();
    } catch {
      // ignore logout API errors and clear token locally
    }
    setApiAuthToken(null);
    persistAuthToken(null);
    await refreshAuthStatus();
  }, [isDesktopRuntime, refreshAuthStatus]);

  const handleViewModeChange = useCallback((nextViewMode: ApiViewMode) => {
    setApiViewMode(nextViewMode);
    setViewMode(nextViewMode);
  }, []);

  const handleOpenDesktopFolder = useCallback(async (openFolder: () => Promise<UkHousingDesktopFolderOpenResult>) => {
    const result = await openFolder();
    if (result.ok) {
      setDesktopActionError('');
      setDesktopActionMessage('');
      return;
    }
    setDesktopActionError(result.error ?? 'Unable to open desktop folder.');
    setDesktopActionMessage('');
  }, []);

  const handleExportSupportBundle = useCallback(async (desktopApiInput: UkHousingDesktopApi) => {
    const result = await desktopApiInput.exportSupportBundle();
    if (result.ok) {
      setDesktopActionError('');
      setDesktopActionMessage(`Support bundle exported: ${result.path ?? 'desktop support-bundles folder'}`);
      return;
    }
    setDesktopActionError(result.error ?? 'Unable to export support bundle.');
    setDesktopActionMessage('');
  }, []);

  return (
    <div className="app-shell">
      <header className="top">
        <div className="wrap">
          <div className="top-inner">
            <div className="top-brand">
              <p className="eyebrow">Max Stoddard · BEng Individual Project</p>
              <h1 className="brand">
                <Link to="/">UK Housing Market Model</Link>
              </h1>
            </div>
            <nav className="main" aria-label="Main">
            <NavLink className={activePrimaryDestination === 'home' ? 'active' : undefined} to="/" end>
              Home
            </NavLink>
            <NavLink className={activePrimaryDestination === 'experiments' ? 'active' : undefined} to="/experiments">
              Experiments
            </NavLink>
            <NavLink className={activePrimaryDestination === 'results' ? 'active' : undefined} to="/results">
              Results
            </NavLink>
            {modelEvidenceVisible && (
              <NavLink className={activePrimaryDestination === 'model-evidence' ? 'active' : undefined} to="/model-evidence">
                Model Evidence
              </NavLink>
            )}
            {experimentsVisible && browserAuthControlsVisible && authStatus.authEnabled && !authStatus.canWrite && (
              <NavLink className="main-nav-auth-control main-nav-auth-link" to={loginPath}>
                <span className="main-nav-auth-icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20" role="img" aria-hidden="true">
                    <path
                      d="M10 2.5a3.75 3.75 0 1 0 0 7.5a3.75 3.75 0 0 0 0-7.5zm0 9c-3.44 0-6.25 1.98-6.25 4.42V17.5h12.5v-1.58c0-2.44-2.81-4.42-6.25-4.42z"
                      fill="currentColor"
                    />
                  </svg>
                </span>
                <span>Login</span>
              </NavLink>
            )}
            {experimentsVisible && browserAuthControlsVisible && authStatus.authEnabled && authStatus.canWrite && (
              <button type="button" className="main-nav-auth-control main-nav-auth-button" onClick={() => void handleLogout()}>
                <span className="main-nav-auth-icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20" role="img" aria-hidden="true">
                    <path
                      d="M10 2.5a3.75 3.75 0 1 0 0 7.5a3.75 3.75 0 0 0 0-7.5zm0 9c-3.44 0-6.25 1.98-6.25 4.42V17.5h12.5v-1.58c0-2.44-2.81-4.42-6.25-4.42z"
                      fill="currentColor"
                    />
                  </svg>
                </span>
                <span>Logout</span>
              </button>
            )}
          </nav>
            {isDevEnv && (
              <div className="env-controls">
                <span className="env-pill-dev">{activeViewModeLabel}</span>
                <label className="env-selector">
                  <span>Runtime view</span>
                  <select value={viewMode} onChange={(event) => handleViewModeChange(event.target.value as ApiViewMode)}>
                    {VIEW_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
          {desktopApi && (
            <div className="desktop-folder-actions" aria-label="Desktop folders">
              <button
                type="button"
                onClick={() => void handleOpenDesktopFolder(desktopApi.openResultsFolder)}
                title="Open Results Folder"
              >
                Results Folder
              </button>
              <button
                type="button"
                onClick={() => void handleOpenDesktopFolder(desktopApi.openLogsFolder)}
                title="Open Logs Folder"
              >
                Logs Folder
              </button>
              <button
                type="button"
                onClick={() => void handleExportSupportBundle(desktopApi)}
                title="Export Support Bundle"
              >
                Support Bundle
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="app-main">
        {authError && <p className="error-banner">{authError}</p>}
        {desktopActionError && <p className="error-banner">{desktopActionError}</p>}
        {desktopActionMessage && <p className="info-banner">{desktopActionMessage}</p>}
        {experimentsVisible && authLoaded && authStatus.authMisconfigured && (
          <p className="error-banner">
            Write access is disabled: model runs are enabled but dashboard write credentials are not configured.
          </p>
        )}
        {!authLoaded ? (
          <p className="loading-banner">Checking access...</p>
        ) : (
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/experiments" element={<ExperimentsLandingPage />} />
            <Route
              path="/scenarios"
              element={
                <ExperimentsPage
                  canWrite={authStatus.canWrite}
                  canDownloadResults={authStatus.canDownloadResults}
                  canDeleteResults={authStatus.canDeleteResults}
                  deleteKeyRequired={authStatus.deleteKeyRequired}
                  authEnabled={authStatus.authEnabled}
                  workspace="manual"
                />
              }
            />
            <Route
              path="/scenarios/new"
              element={
                <ExperimentsPage
                  canWrite={authStatus.canWrite}
                  canDownloadResults={authStatus.canDownloadResults}
                  canDeleteResults={authStatus.canDeleteResults}
                  deleteKeyRequired={authStatus.deleteKeyRequired}
                  authEnabled={authStatus.authEnabled}
                  workspace="manual"
                  initialView="create"
                />
              }
            />
            <Route path="/new-scenario" element={<Navigate to="/scenarios/new" replace />} />
            <Route path="/runs" element={<Navigate to="/scenarios" replace />} />
            <Route
              path="/sensitivity"
              element={
                <ExperimentsPage
                  canWrite={authStatus.canWrite}
                  canDownloadResults={authStatus.canDownloadResults}
                  canDeleteResults={authStatus.canDeleteResults}
                  deleteKeyRequired={authStatus.deleteKeyRequired}
                  authEnabled={authStatus.authEnabled}
                  workspace="sensitivity"
                />
              }
            />
            <Route
              path="/sensitivity/new"
              element={
                <ExperimentsPage
                  canWrite={authStatus.canWrite}
                  canDownloadResults={authStatus.canDownloadResults}
                  canDeleteResults={authStatus.canDeleteResults}
                  deleteKeyRequired={authStatus.deleteKeyRequired}
                  authEnabled={authStatus.authEnabled}
                  workspace="sensitivity"
                  initialView="create"
                />
              }
            />
            <Route path="/compare" element={<LegacyCompareRedirect />} />
            {modelEvidenceVisible && <Route path="/model-evidence" element={<ModelEvidencePage />} />}
            <Route path="/calibration" element={<LegacyEvidenceRedirect view="calibration" />} />
            <Route path="/validation" element={<LegacyEvidenceRedirect view="validation" />} />
            {experimentsVisible && (
              <Route
                path="/results"
                element={
                  <ResultsPage
                    canWrite={authStatus.canWrite}
                    canDownloadResults={authStatus.canDownloadResults}
                    canDeleteResults={authStatus.canDeleteResults}
                    deleteKeyRequired={authStatus.deleteKeyRequired}
                    authEnabled={authStatus.authEnabled}
                  />
                }
              />
            )}
            {experimentsVisible && (
              <Route
                path="/login"
                element={<LoginPage authStatus={authStatus} onLoginSuccess={handleLoginSuccess} />}
              />
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>

      <footer className="foot">
        <div className="wrap">
          <span>© 2026 Max Stoddard. All rights reserved.</span>
          <span>Carro, Hinterschweiger, Uluc &amp; Farmer — BoE SWP 976</span>
        </div>
      </footer>
    </div>
  );
}
