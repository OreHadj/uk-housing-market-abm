import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { buildModelOptions, formatModelName } from '../lib/modelAnchors';

interface EvidenceReturnPanelProps {
  className: string;
  message: string;
  returnHref: string;
  versions: readonly string[];
  currentVersion: string;
  inProgressVersions?: ReadonlySet<string>;
  onChooseModel: (version: string) => void;
}

/**
 * Round-trip controls shown only when Model Evidence was opened from an unfinished setup.
 * Choosing a model is deliberately a two-stage action: the analyst first opens the full model
 * list, then one explicit choice updates the saved draft and returns to the exact wizard step.
 */
export function EvidenceReturnPanel({
  className,
  message,
  returnHref,
  versions,
  currentVersion,
  inProgressVersions = new Set(),
  onChooseModel
}: EvidenceReturnPanelProps) {
  const navigate = useNavigate();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const pickerAnchorRef = useRef<HTMLDivElement>(null);
  const modelOptions = useMemo(
    () => buildModelOptions(versions, currentVersion, inProgressVersions),
    [currentVersion, inProgressVersions, versions]
  );

  useEffect(() => {
    if (!isPickerOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!pickerAnchorRef.current?.contains(event.target as Node)) setIsPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPickerOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isPickerOpen]);

  return (
    <aside className={`${className} evidence-return-panel`}>
      <p>{message}</p>
      <div className="evidence-return-actions">
        <Link className="secondary-button" to={returnHref}>Return without changing model</Link>
        <div ref={pickerAnchorRef} className="evidence-return-picker-anchor">
          <button
            type="button"
            className="primary-button"
            aria-expanded={isPickerOpen}
            aria-controls="evidence-return-model-picker"
            onClick={() => setIsPickerOpen((current) => !current)}
          >
            Select different model
          </button>
          {isPickerOpen && (
            <div
              id="evidence-return-model-picker"
              className="evidence-return-model-picker"
              role="dialog"
              aria-label="Select a model and return"
            >
              <div className="evidence-return-model-picker-heading">
                <strong>Select a model</strong>
                <button type="button" className="trend-modal-close" aria-label="Close model selection" onClick={() => setIsPickerOpen(false)}>×</button>
              </div>
              <div className="evidence-return-model-options">
                {modelOptions.map((option) => {
                  const isCurrent = option.version === currentVersion;
                  return (
                    <button
                      type="button"
                      key={option.version}
                      className={`validation-model-option${isCurrent ? ' is-selected' : ''}`}
                      onClick={() => {
                        onChooseModel(option.version);
                        navigate(returnHref);
                      }}
                    >
                      <span className="validation-model-option-copy">
                        <span className="validation-model-option-heading">
                          <strong>{formatModelName(option.version)}</strong>
                          <span className="validation-model-option-version">{option.version}</span>
                        </span>
                        {isCurrent && <span className="evidence-return-current-model">Currently viewed</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
