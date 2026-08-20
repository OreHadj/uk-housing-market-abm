import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ComparePage } from './ComparePage';
import { ValidationPage } from './ValidationPage';

const EVIDENCE_VIEWS = [
  {
    id: 'calibration',
    label: 'Calibration',
    description: 'Review the evidence and assumptions used to configure each model version.'
  },
  {
    id: 'validation',
    label: 'Validation',
    description: 'Compare model outputs with independent UK evidence.'
  }
] as const;

type EvidenceView = (typeof EVIDENCE_VIEWS)[number]['id'];

function isEvidenceView(value: string): value is EvidenceView {
  return EVIDENCE_VIEWS.some((view) => view.id === value);
}

/**
 * One destination for the model's fixed evidence. Calibration and validation keep their existing
 * contents; this page only provides the same full-width, URL-backed view switcher as Results.
 */
export function ModelEvidencePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get('view')?.trim() ?? '';
  const activeView: EvidenceView = isEvidenceView(requestedView) ? requestedView : 'calibration';

  const selectView = useCallback(
    (view: EvidenceView) => {
      const next = new URLSearchParams(searchParams);
      next.set('view', view);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  return (
    <section className="run-exp-layout model-evidence-page">
      <header className="results-view-switcher model-evidence-view-switcher">
        <h2 className="visually-hidden">Model evidence</h2>
        <div className="results-type-toggle" role="tablist" aria-label="Type of model evidence to view">
          {EVIDENCE_VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              role="tab"
              aria-selected={view.id === activeView}
              className={`results-type-option ${view.id === activeView ? 'active' : ''}`}
              title={view.description}
              onClick={() => selectView(view.id)}
            >
              {view.label}
            </button>
          ))}
        </div>
      </header>

      {activeView === 'calibration' ? <ComparePage /> : <ValidationPage />}
    </section>
  );
}
