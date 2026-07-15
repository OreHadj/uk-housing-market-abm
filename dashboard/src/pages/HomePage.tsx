import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchModelRunOptions, submitModelRun } from '../lib/api';
import { buildDefaultRunSubmitRequest } from '../lib/homeDefaultRun';
import { buildExperimentsPath } from './experiments/routeState';
import { DEFAULT_EXPERIMENT_ROUTE_STATE } from './experiments/types';

export function HomePage() {
  const navigate = useNavigate();
  const [isNaming, setIsNaming] = useState<boolean>(false);
  const [runName, setRunName] = useState<string>('');
  const [isStartingDefaultRun, setIsStartingDefaultRun] = useState<boolean>(false);
  const [defaultRunError, setDefaultRunError] = useState<string>('');

  const onStartDefaultRun = async () => {
    setIsStartingDefaultRun(true);
    setDefaultRunError('');

    try {
      const options = await fetchModelRunOptions();
      if (!options.executionEnabled) {
        throw new Error(
          options.executionDisabledReason ||
            'Model execution is currently unavailable in this environment. Open Results for details.'
        );
      }

      const response = await submitModelRun(buildDefaultRunSubmitRequest(options, new Date(), runName));
      if (!response.accepted || !response.job) {
        throw new Error('The default run could not be queued. Try again in a moment.');
      }

      // Take the user straight to the Results page. The run continues in the background and
      // appears in the run list there when it finishes (Results shows an in-progress notice).
      navigate(buildExperimentsPath({ ...DEFAULT_EXPERIMENT_ROUTE_STATE, type: 'manual', mode: 'view' }));
    } catch (error) {
      setDefaultRunError((error as Error).message);
      setIsStartingDefaultRun(false);
    }
  };

  return (
    <section className="home-layout">
      <div className="intro-card fade-up">
        <p className="eyebrow">UK Housing Market ABM</p>
        <h2>A UK housing-market simulator for testing central-bank (macroprudential) policy.</h2>
        <p>
          Run a ready-made simulation to see how the model behaves — no setup required. The run is queued
          automatically and its results appear on the Results page.
        </p>
        {isNaming ? (
          <div className="default-run-name">
            <label htmlFor="default-run-name-input">Name this run</label>
            <input
              id="default-run-name-input"
              type="text"
              autoFocus
              value={runName}
              maxLength={80}
              placeholder="e.g. Baseline scenario"
              disabled={isStartingDefaultRun}
              onChange={(event) => setRunName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void onStartDefaultRun();
                }
              }}
            />
            <p className="default-run-hint">
              Give it a memorable name so it&apos;s easy to find on the Results page. Leave blank to use an
              automatic name.
            </p>
            <div className="default-run-actions">
              <button
                type="button"
                className="primary-button default-run-button"
                onClick={() => {
                  void onStartDefaultRun();
                }}
                disabled={isStartingDefaultRun}
              >
                {isStartingDefaultRun ? 'Starting run…' : 'Start run'}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setIsNaming(false)}
                disabled={isStartingDefaultRun}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="default-run-actions">
            <button
              type="button"
              className="primary-button default-run-button"
              onClick={() => {
                setDefaultRunError('');
                setIsNaming(true);
              }}
            >
              Run a demo simulation
            </button>
            <span className="default-run-hint">
              Queues a sensible default run and takes you to the Results page.
            </span>
          </div>
        )}
        {defaultRunError && <p className="error-banner default-run-error">{defaultRunError}</p>}
      </div>
    </section>
  );
}
