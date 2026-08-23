import type { ReactNode } from 'react';
import type {
  ResultsRunConfigurationValue,
  ResultsRunDetail
} from '../../../../shared/types';
import { CENTRAL_BANK_POLICY_DISPLAY, formatPolicyValue } from '../../../../shared/policyDisplay';
import { getBasePolicyOption, summariseRunPolicy } from '../../../../shared/policyCatalogue';
import { POLICY_SETTING_GROUPS } from '../../../lib/manualScenarioPolicy';
import { extractVersionFromResultsRunId } from '../../../lib/versionLabels';
import { formatModelName, getModelAnchor } from '../../../lib/modelAnchors';

interface FullRunDetailsDialogProps {
  run: ResultsRunDetail;
  onClose: () => void;
}

interface RunSettingDefinition {
  key: string;
  label: string;
}

const RUN_SETTINGS: readonly RunSettingDefinition[] = [
  { key: 'N_STEPS', label: 'Simulation duration' },
  { key: 'N_SIMS', label: 'Seeds per run' },
  { key: 'MAX_WORKERS', label: 'Max workers' },
  { key: 'TARGET_POPULATION', label: 'Target population' },
  { key: 'ROLLING_WINDOW_SIZE_FOR_CORE_INDICATORS', label: 'Core indicator rolling window' },
  { key: 'CUMULATIVE_WEIGHT_BEYOND_YEAR', label: 'Cumulative weight beyond year' }
];

const RECORDING_SETTINGS: readonly RunSettingDefinition[] = [
  { key: 'TIME_TO_START_RECORDING_TRANSACTIONS', label: 'Start recording at month' },
  { key: 'recordTransactions', label: 'Record transactions' },
  { key: 'recordNBidUpFrequency', label: 'Record bid-up frequency' },
  { key: 'recordQualityBandPrice', label: 'Record quality-band prices' },
  { key: 'recordHouseholdID', label: 'Record household ID' },
  { key: 'recordEmploymentIncome', label: 'Record employment income' },
  { key: 'recordRentalIncome', label: 'Record rental income' },
  { key: 'recordBankBalance', label: 'Record bank balance' },
  { key: 'recordHousingWealth', label: 'Record housing wealth' },
  { key: 'recordTotalDebt', label: 'Record total debt' },
  { key: 'recordHousingStatus', label: 'Record housing status' },
  { key: 'recordConsumption', label: 'Record non-housing consumption' },
  { key: 'recordNHousesOwned', label: 'Record number of houses owned' },
  { key: 'recordAge', label: 'Record household age' },
  { key: 'recordSavingRate', label: 'Record saving rate' }
];

function RunDetailStep({
  number,
  title,
  description,
  children
}: {
  number: number;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="full-run-details-step" aria-labelledby={`full-run-details-step-${number}`}>
      <span className="full-run-details-step-number" aria-hidden="true">{number}</span>
      <div className="full-run-details-step-content">
        <p className="full-run-details-step-label">Step {number}</p>
        <h4 id={`full-run-details-step-${number}`}>{title}</h4>
        <p className="full-run-details-step-description">{description}</p>
        {children}
      </div>
    </section>
  );
}

function configurationValue(run: ResultsRunDetail, key: string): ResultsRunConfigurationValue | undefined {
  if (key === 'MAX_WORKERS') return run.configuration.maxWorkers ?? undefined;
  return run.configuration.parameterValues[key];
}

function formatConfigurationValue(key: string, value: ResultsRunConfigurationValue | undefined): string {
  if (value === undefined || value === '') return 'Not recorded';
  if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
  if (typeof value !== 'number') return value;

  const formatted = value.toLocaleString('en-GB');
  if (key === 'N_STEPS') return `${formatted} steps`;
  if (key === 'N_SIMS') return `${formatted} ${value === 1 ? 'seed' : 'seeds'}`;
  if (key === 'TARGET_POPULATION') return `${formatted} households`;
  if (key === 'ROLLING_WINDOW_SIZE_FOR_CORE_INDICATORS') {
    return `${formatted} ${value === 1 ? 'month' : 'months'}`;
  }
  return formatted;
}

export function FullRunDetailsDialog({ run, onClose }: FullRunDetailsDialogProps) {
  const modelVersion = run.configuration.modelVersion ?? extractVersionFromResultsRunId(run.runId);
  const modelAnchor = modelVersion ? getModelAnchor(modelVersion) : undefined;
  const modelLabel = modelVersion
    ? modelAnchor
      ? `${formatModelName(modelVersion)} (${modelVersion})`
      : modelVersion
    : 'Not recorded';
  const inferredPolicySummary = summariseRunPolicy(run.policySettings);
  const recordedBasePolicy = run.configuration.basePolicy
    ? getBasePolicyOption(run.configuration.basePolicy)
    : null;
  const policySummary = recordedBasePolicy
    ? {
        basePolicyId: recordedBasePolicy.id,
        basePolicyTitle: recordedBasePolicy.title,
        deviations: run.policySettings.flatMap((setting) => {
          const baseValue = recordedBasePolicy.values[setting.key];
          return typeof baseValue === 'number' && Math.abs(baseValue - setting.value) > 1e-9
            ? [{ key: setting.key, value: setting.value, baseValue }]
            : [];
        })
      }
    : inferredPolicySummary;
  const changedPolicyKeys = new Set(policySummary.deviations.map((deviation) => deviation.key));
  const policySettingByKey = new Map(run.policySettings.map((setting) => [setting.key, setting]));
  const deviationByKey = new Map(policySummary.deviations.map((deviation) => [deviation.key, deviation]));

  return (
    <div
      className="trend-modal-backdrop full-run-details-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="trend-modal full-run-details-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="full-run-details-title"
      >
        <div className="trend-modal-head full-run-details-head">
          <div>
            <p className="trend-modal-eyebrow">Saved policy scenario</p>
            <h3 id="full-run-details-title">Full run details</h3>
            <p>{run.title?.trim() || run.runId}</p>
          </div>
          <button
            type="button"
            className="trend-modal-close"
            aria-label="Close full run details"
            autoFocus
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="full-run-details-steps">
          <RunDetailStep
            number={1}
            title="Scenario name"
            description="The name entered when this policy scenario was created."
          >
            <dl className="sensitivity-review-list full-run-details-facts">
              <div className="sensitivity-review-wide">
                <dt>Scenario name</dt>
                <dd>{run.title?.trim() || 'Not recorded'}</dd>
              </div>
            </dl>
          </RunDetailStep>

          <RunDetailStep
            number={2}
            title="Model version"
            description="The model option selected for this scenario."
          >
            <dl className="sensitivity-review-list full-run-details-facts">
              <div className="sensitivity-review-wide">
                <dt>Model</dt>
                <dd>{modelLabel}</dd>
              </div>
            </dl>
          </RunDetailStep>

          <RunDetailStep
            number={3}
            title="Policy settings"
            description="The reference policy and every Central Bank setting used in the completed run."
          >
            <dl className="sensitivity-review-list full-run-details-facts full-run-details-policy-overview">
              <div>
                <dt>Reference policy</dt>
                <dd>{policySummary.basePolicyTitle ?? 'Not recorded'}</dd>
              </div>
              <div>
                <dt>Policy changes</dt>
                <dd>
                  {policySummary.deviations.length === 0
                    ? 'No settings changed'
                    : `${policySummary.deviations.length} ${policySummary.deviations.length === 1 ? 'setting' : 'settings'} changed`}
                </dd>
              </div>
            </dl>

            {run.policySettings.length > 0 ? (
              <div className="scenario-policy-review-groups full-run-policy-groups">
                {POLICY_SETTING_GROUPS.map((group) => (
                  <section key={group.id} className="scenario-policy-review-group">
                    <h5>{group.heading}</h5>
                    <dl>
                      {group.keys.map((key) => {
                        const setting = policySettingByKey.get(key);
                        if (!setting) return null;
                        const display = CENTRAL_BANK_POLICY_DISPLAY[key];
                        const changed = changedPolicyKeys.has(key);
                        const deviation = deviationByKey.get(key);
                        return (
                          <div key={key} className={changed ? 'is-changed' : undefined}>
                            <dt>{display?.label ?? key}</dt>
                            <dd>
                              <span className="scenario-policy-review-value">
                                {display ? formatPolicyValue(setting.value, display.unit) : setting.value}
                              </span>
                              <span className={`scenario-policy-review-status ${changed ? 'is-changed' : 'is-unchanged'}`}>
                                {changed ? 'Changed' : 'Unchanged'}
                              </span>
                              {changed && deviation && display && (
                                <small>Reference: {formatPolicyValue(deviation.baseValue, display.unit)}</small>
                              )}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </section>
                ))}
              </div>
            ) : (
              <p className="info-banner">Policy settings were not recorded for this run.</p>
            )}
          </RunDetailStep>

          <RunDetailStep
            number={4}
            title="Technical details"
            description="The execution and recording choices applied when the model was run."
          >
            <div className="full-run-details-technical-group">
              <h5>Run settings</h5>
              <dl className="sensitivity-review-list full-run-details-facts">
                {RUN_SETTINGS.map((setting) => (
                  <div key={setting.key}>
                    <dt>{setting.label}</dt>
                    <dd>{formatConfigurationValue(setting.key, configurationValue(run, setting.key))}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="full-run-details-technical-group">
              <h5>Recording configuration</h5>
              <dl className="sensitivity-review-list full-run-details-facts">
                {RECORDING_SETTINGS.map((setting) => (
                  <div key={setting.key}>
                    <dt>{setting.label}</dt>
                    <dd>{formatConfigurationValue(setting.key, configurationValue(run, setting.key))}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </RunDetailStep>

        </div>
      </section>
    </div>
  );
}
