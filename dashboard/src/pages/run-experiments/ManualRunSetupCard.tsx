import { Link } from 'react-router-dom';
import type {
  BasePolicyId,
  BasePolicyOption,
  ModelRunParameterDefinition,
  ModelRunSnapshotOption,
  ModelRunWarning
} from '../../../shared/types';
import {
  formatExperimentModelOption,
  orderExperimentModelOptions
} from '../../lib/experimentVersionOptions';
import { GeneralModelControl } from './GeneralModelControl';
import { CentralBankPolicyInput } from './CentralBankPolicyInput';
import { InfoLabel } from './InfoLabel';
import { SETTING_HELP } from './settingHelp';

type FormValue = string | boolean;

interface ManualRunSetupCardProps {
  executionDisabled: boolean;
  isLoadingOptions: boolean;
  selectedBaseline: string;
  onBaselineChange: (baseline: string) => void;
  basePolicies: BasePolicyOption[];
  basePolicy: BasePolicyId;
  onBasePolicyChange: (basePolicy: BasePolicyId) => void;
  snapshots: ModelRunSnapshotOption[];
  title: string;
  onTitleChange: (value: string) => void;
  parameters: ModelRunParameterDefinition[];
  policyParameters: ModelRunParameterDefinition[];
  formValues: Record<string, FormValue>;
  onFormValueChange: (parameter: ModelRunParameterDefinition, value: FormValue) => void;
  maxWorkers: string;
  maxWorkersCap?: number;
  onMaxWorkersChange: (value: string) => void;
  warnings: ModelRunWarning[];
  isSubmitting: boolean;
  manualSubmissionLockedBySensitivity: boolean;
  lockMessage: string | null;
  onSubmit: (confirmWarnings: boolean) => void;
}

export function ManualRunSetupCard({
  executionDisabled,
  isLoadingOptions,
  selectedBaseline,
  onBaselineChange,
  basePolicies,
  basePolicy,
  onBasePolicyChange,
  snapshots,
  title,
  onTitleChange,
  parameters,
  policyParameters,
  formValues,
  onFormValueChange,
  maxWorkers,
  maxWorkersCap,
  onMaxWorkersChange,
  warnings,
  isSubmitting,
  manualSubmissionLockedBySensitivity,
  lockMessage,
  onSubmit
}: ManualRunSetupCardProps) {
  const orderedSnapshots = orderExperimentModelOptions(snapshots);
  const selectedBasePolicy = basePolicies.find((policy) => policy.id === basePolicy);

  return (
    <article className="results-card">
      <h3>Manual Parameters</h3>
      <p>Choose a calibration parameter version, set USER SET parameters, then queue a model run.</p>
      {manualSubmissionLockedBySensitivity && lockMessage && <p className="info-banner">{lockMessage}</p>}

      {isLoadingOptions ? (
        <p className="loading-banner">Loading run options...</p>
      ) : (
        <>
          <div className="run-form-head">
            <label>
              <InfoLabel label="Calibration Parameter Version" info={SETTING_HELP.calibrationParameterVersion} />
              <select
                value={selectedBaseline}
                disabled={executionDisabled}
                onChange={(event) => onBaselineChange(event.target.value)}
              >
                {orderedSnapshots.map((snapshot) => (
                  <option key={snapshot.version} value={snapshot.version}>
                    {formatExperimentModelOption(snapshot, orderedSnapshots)}
                  </option>
                ))}
              </select>
              <Link className="summary-link-inline" to={`/calibration?mode=single&version=${encodeURIComponent(selectedBaseline)}`}>
                View in Calibration Versions
              </Link>
            </label>

            <label>
              <InfoLabel label="Base policy" info={SETTING_HELP.basePolicy} />
              <select
                value={basePolicy}
                disabled={executionDisabled}
                onChange={(event) => onBasePolicyChange(event.target.value as BasePolicyId)}
              >
                {basePolicies.map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.title}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <InfoLabel label="Optional run title" info={SETTING_HELP.optionalRunTitle} />
              <input
                type="text"
                value={title}
                disabled={executionDisabled}
                onChange={(event) => onTitleChange(event.target.value)}
                maxLength={120}
                placeholder="Policy scenario label"
              />
            </label>
          </div>

          {selectedBasePolicy ? (
            <section className="policy-summary-panel" aria-label="Base policy summary">
              <div className="policy-summary-item">
                <span>Base policy</span>
                <h4>{selectedBasePolicy.title}</h4>
                <p>{selectedBasePolicy.summary}</p>
              </div>
            </section>
          ) : null}

          {warnings.length > 0 && (
            <div className="run-warning-card">
              <h4>Warnings detected</h4>
              <p>Confirm to submit anyway.</p>
              <ul>
                {warnings.map((warning) => (
                  <li key={`${warning.code}-${warning.message}`}>{warning.message}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="run-param-groups">
            <GeneralModelControl
              mode="manual"
              parameters={parameters}
              formValues={formValues}
              executionDisabled={executionDisabled}
              onFormValueChange={onFormValueChange}
              maxWorkers={maxWorkers}
              maxWorkersCap={maxWorkersCap}
              onMaxWorkersChange={onMaxWorkersChange}
              maxWorkersHint={SETTING_HELP.maxWorkers}
            />

            {policyParameters.length > 0 && (
              <section className="run-param-group">
                <h4>Central Bank policy</h4>
                <div className="run-param-grid">
                  {policyParameters.map((parameter) => (
                    <CentralBankPolicyInput
                      key={parameter.key}
                      parameter={parameter}
                      value={formValues[parameter.key]}
                      executionDisabled={executionDisabled}
                      mode="manual"
                      onChange={onFormValueChange}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="run-form-actions">
            <button
              type="button"
              className="primary-button"
              disabled={isSubmitting || executionDisabled || manualSubmissionLockedBySensitivity}
              onClick={() => onSubmit(false)}
            >
              {isSubmitting ? 'Submitting...' : 'Queue Run'}
            </button>
            {warnings.length > 0 && (
              <button
                type="button"
                className="secondary-button"
                disabled={isSubmitting || executionDisabled || manualSubmissionLockedBySensitivity}
                onClick={() => onSubmit(true)}
              >
                Confirm and Queue
              </button>
            )}
          </div>
        </>
      )}
    </article>
  );
}
