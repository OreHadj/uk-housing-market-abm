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
import { ResultsLandingPage } from './pages/ResultsLandingPage';
import { SettingsPage } from './pages/SettingsPage';
import { WorkspaceTypeNavigation } from './components/WorkspaceTypeNavigation';
import { ModelInformationNavigation } from './components/ModelInformationNavigation';
import { GuidedDemo } from './components/GuidedDemo';
import { PrimaryNavigationIcon } from './components/PrimaryNavigationIcon';
import { getActivePrimaryDestination, getModelInformationView, getResultsNavigationSearch, isResultsLanding, MODEL_INFORMATION_VIEWS, PRIMARY_DESTINATION_LABELS } from './lib/workspaceNavigation';

const AUTH_TOKEN_STORAGE_KEY = 'dashboard.writeAuthToken';
const VIEW_MODE_STORAGE_KEY = 'dashboard.viewMode';
const LEGACY_PREVIEW_MODE_STORAGE_KEY = 'dashboard.prodPreviewEnabled';
const EXPERIMENTS_VIEW_PATH = '/experiments';

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
  const experimentsVisible = true;
  const modelEvidenceVisible = true;
  const browserAuthControlsVisible = !isDesktopRuntime && viewMode !== 'preview_desktop';
  const activeViewModeLabel = VIEW_MODE_OPTIONS.find((option) => option.value === viewMode)?.label ?? 'Dev mode';

  const loginPath = `/login?next=${encodeURIComponent(EXPERIMENTS_VIEW_PATH)}`;
  const activePrimaryDestination = getActivePrimaryDestination(location.pathname);
  const resultsLanding = activePrimaryDestination === 'results' && isResultsLanding(new URLSearchParams(location.search));
  const [openSidebarSections, setOpenSidebarSections] = useState(() => ({
    experiments: activePrimaryDestination === 'experiments',
    results: activePrimaryDestination === 'results',
    'model-evidence': activePrimaryDestination === 'model-evidence'
  }));
  const [lastResultsSearch, setLastResultsSearch] = useState(() => activePrimaryDestination === 'results' && !resultsLanding
    ? getResultsNavigationSearch(new URLSearchParams(location.search)) : '');
  const [lastModelInformationSearch, setLastModelInformationSearch] = useState('');
  const modelInformationView = getModelInformationView(new URLSearchParams(location.search));

  useEffect(() => {
    if (activePrimaryDestination === 'experiments' || activePrimaryDestination === 'results' || activePrimaryDestination === 'model-evidence') {
      setOpenSidebarSections((current) => current[activePrimaryDestination]
        ? current : { ...current, [activePrimaryDestination]: true });
    }
  }, [activePrimaryDestination]);

  useEffect(() => {
    if (activePrimaryDestination === 'results' && !resultsLanding) {
      setLastResultsSearch(getResultsNavigationSearch(new URLSearchParams(location.search)));
    }
  }, [activePrimaryDestination, location.search, resultsLanding]);

  useEffect(() => {
    if (location.pathname !== '/model-evidence') return;
    const search = new URLSearchParams(location.search);
    // Keep model selections and draft return context, but never restart an exited tour.
    for (const key of ['demo', 'step', 'tour', 'journey']) search.delete(key);
    setLastModelInformationSearch(search.size ? `?${search}` : '');
  }, [location.pathname, location.search]);

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

  return (
    <div className="app-shell">
      <a className="skip-to-workspace" href="#main-workspace">Skip to workspace</a>
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <p className="eyebrow">Max Stoddard · BEng Individual Project</p>
          <h1 className="brand">
            <Link to="/">UK Housing Market Model</Link>
          </h1>
        </div>
        <nav className="main" aria-label="Main">
          <Link
            className={activePrimaryDestination === 'home' ? 'active' : undefined}
            aria-current={activePrimaryDestination === 'home' ? 'page' : undefined}
            to="/"
            data-guided-target="sidebar-home"
          >
            <span className="main-nav-destination-content"><PrimaryNavigationIcon destination="home" /><span>Home</span></span>
          </Link>
          <div className={`sidebar-destination${activePrimaryDestination === 'experiments' ? ' is-active' : ''}${openSidebarSections.experiments ? ' is-expanded' : ''}`}>
            <Link
              className={activePrimaryDestination === 'experiments' ? 'active' : undefined}
              aria-current={activePrimaryDestination === 'experiments'
                ? location.pathname === '/experiments' ? 'page' : 'true'
                : undefined}
              aria-expanded={openSidebarSections.experiments}
              aria-controls="sidebar-experiment-types"
              to="/experiments"
              data-guided-target="sidebar-experiments"
              onClick={(event) => {
                if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                setOpenSidebarSections((current) => ({
                  ...current,
                  experiments: activePrimaryDestination === 'experiments' ? !current.experiments : true
                }));
              }}
            >
              <span className="main-nav-destination-content"><PrimaryNavigationIcon destination="experiments" /><span>Experiments</span></span>
            </Link>
            <div id="sidebar-experiment-types" hidden={!openSidebarSections.experiments}>
              <WorkspaceTypeNavigation area="experiments" />
            </div>
          </div>
          <div className={`sidebar-destination${activePrimaryDestination === 'results' ? ' is-active' : ''}${openSidebarSections.results ? ' is-expanded' : ''}`}>
            <Link
              className={activePrimaryDestination === 'results' ? 'active' : undefined}
              aria-current={activePrimaryDestination === 'results' ? resultsLanding ? 'page' : 'true' : undefined}
              aria-expanded={openSidebarSections.results}
              aria-controls="sidebar-result-types"
              to="/results"
              data-guided-target="sidebar-results"
              onClick={(event) => {
                if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                setOpenSidebarSections((current) => ({
                  ...current,
                  results: resultsLanding ? !current.results : true
                }));
              }}
            >
              <span className="main-nav-destination-content"><PrimaryNavigationIcon destination="results" /><span>Results</span></span>
            </Link>
            <div id="sidebar-result-types" hidden={!openSidebarSections.results}>
              <WorkspaceTypeNavigation area="results" resultsSearch={lastResultsSearch} />
            </div>
          </div>
          {modelEvidenceVisible && (
            <div className={`sidebar-destination${activePrimaryDestination === 'model-evidence' ? ' is-active' : ''}${openSidebarSections['model-evidence'] ? ' is-expanded' : ''}`}>
              <Link
                className={activePrimaryDestination === 'model-evidence' ? 'active' : undefined}
                aria-current={activePrimaryDestination === 'model-evidence' ? 'true' : undefined}
                aria-expanded={openSidebarSections['model-evidence']}
                aria-controls="sidebar-model-information-sections"
                to={activePrimaryDestination === 'model-evidence' ? `${location.pathname}${location.search}` : `/model-evidence${lastModelInformationSearch}`}
                data-guided-target="sidebar-model-information"
                onClick={(event) => {
                  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  setOpenSidebarSections((current) => ({
                    ...current,
                    'model-evidence': activePrimaryDestination === 'model-evidence' ? !current['model-evidence'] : true
                  }));
                }}
              >
                <span className="main-nav-destination-content"><PrimaryNavigationIcon destination="model-evidence" /><span>{PRIMARY_DESTINATION_LABELS['model-evidence']}</span></span>
              </Link>
              <div id="sidebar-model-information-sections" hidden={!openSidebarSections['model-evidence']}>
                <ModelInformationNavigation modelInformationSearch={lastModelInformationSearch} />
              </div>
            </div>
          )}
          <Link
            className={activePrimaryDestination === 'settings' ? 'active' : undefined}
            aria-current={activePrimaryDestination === 'settings' ? 'page' : undefined}
            to="/settings"
            data-guided-target="sidebar-settings"
          >
            <span className="main-nav-destination-content"><PrimaryNavigationIcon destination="settings" /><span>Settings</span></span>
          </Link>
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
      </aside>

      <div className="app-workspace">
        {(activePrimaryDestination || isDevEnv) && (
          <header className="top workspace-header">
            {activePrimaryDestination && (
              <h2 id="workspace-page-title" className="workspace-page-title">
                {PRIMARY_DESTINATION_LABELS[activePrimaryDestination]}
                {activePrimaryDestination === 'model-evidence' && <span className="model-information-workspace-title">
                  <span aria-hidden="true"> / </span>{MODEL_INFORMATION_VIEWS.find((view) => view.id === modelInformationView)?.label}
                </span>}
              </h2>
            )}
            {isDevEnv && <div className="env-controls">
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
            </div>}
          </header>
        )}

      <main id="main-workspace" className="app-main" tabIndex={-1} aria-labelledby={activePrimaryDestination ? 'workspace-page-title' : undefined}>
        {authError && <p className="error-banner">{authError}</p>}
        {experimentsVisible && authLoaded && authStatus.authMisconfigured && (
          <p className="error-banner">
            Write access is disabled: model runs are enabled but dashboard write credentials are not configured.
          </p>
        )}
        {!authLoaded && activePrimaryDestination !== 'settings' ? (
          <p className="loading-banner">Checking access...</p>
        ) : (
          <Routes>
            <Route path="/settings" element={<SettingsPage desktopApi={desktopApi} />} />
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
                element={resultsLanding ? <ResultsLandingPage resultsSearch={lastResultsSearch} /> : (
                  <ResultsPage
                    canWrite={authStatus.canWrite}
                    canDownloadResults={authStatus.canDownloadResults}
                    canDeleteResults={authStatus.canDeleteResults}
                    deleteKeyRequired={authStatus.deleteKeyRequired}
                    authEnabled={authStatus.authEnabled}
                  />
                )}
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
      {authLoaded && <GuidedDemo />}
    </div>
  );
}
