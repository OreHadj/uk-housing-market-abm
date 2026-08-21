import fs from 'node:fs';
import path from 'node:path';
import type {
  CalibrationCampaign,
  CalibrationModelOverview,
  CalibrationOverviewResponse,
  CalibrationParameterRecord
} from '../../shared/types';
import { getConfigPath, parseConfigFile } from './io';
import { resolveRuntimePaths, type RuntimePathInput } from './runtimePaths';

const PARAMETER_COPY: Record<string, Omit<CalibrationParameterRecord, 'value' | 'lower' | 'upper' | 'priorLower' | 'priorUpper'>> = {
  PSYCHOLOGICAL_COST_OF_RENTING: {
    key: 'PSYCHOLOGICAL_COST_OF_RENTING', name: 'Psychological cost of renting',
    meaning: 'An annual non-financial cost added to renting in the household tenure decision.',
    calibrationReason: 'A psychological preference is latent and cannot be read directly from market data.',
    increaseEffect: 'Renting becomes less attractive, increasing the propensity to purchase.',
    decreaseEffect: 'Renting becomes relatively more attractive, reducing purchase propensity.'
  },
  SENSITIVITY_RENT_OR_PURCHASE: {
    key: 'SENSITIVITY_RENT_OR_PURCHASE', name: 'Rent-versus-purchase sensitivity',
    meaning: 'Controls how sharply households react to the modelled cost difference between renting and buying.',
    calibrationReason: 'Observed tenure choices do not uniquely identify the strength of this response.',
    increaseEffect: 'Choices respond more sharply to small cost differences.',
    decreaseEffect: 'Choices become noisier and less responsive to cost differences.'
  },
  BTL_PROBABILITY_MULTIPLIER: {
    key: 'BTL_PROBABILITY_MULTIPLIER', name: 'BTL probability multiplier',
    meaning: 'Scales the income-conditioned probability that a household participates as a buy-to-let investor.',
    calibrationReason: 'Survey participation rates do not directly identify the model-side multiplier.',
    increaseEffect: 'More households tend to enter the BTL investor pool.',
    decreaseEffect: 'Fewer households tend to participate as BTL investors.'
  },
  BTL_CHOICE_INTENSITY: {
    key: 'BTL_CHOICE_INTENSITY', name: 'BTL choice intensity',
    meaning: 'Sets how strongly BTL buy, hold and sell choices respond to expected effective yield.',
    calibrationReason: 'The decision intensity is behavioural and not directly observed.',
    increaseEffect: 'Investor choices concentrate more strongly on the highest expected-yield action.',
    decreaseEffect: 'Investor choices become less sharply differentiated by expected yield.'
  },
  MARKET_AVERAGE_PRICE_DECAY: {
    key: 'MARKET_AVERAGE_PRICE_DECAY', name: 'Market-average price decay',
    meaning: 'Weights the previous market-price average relative to new transaction information.',
    calibrationReason: 'The appropriate model memory cannot be identified from a single empirical series.',
    increaseEffect: 'More weight remains on the prior average, so the signal adjusts more slowly.',
    decreaseEffect: 'More weight goes to new information, so the signal adjusts faster.'
  }
};

const PARAMETER_KEYS = Object.keys(PARAMETER_COPY);
const CHANGELOG_PATH = 'CALIBRATION_PARAMETER_CHANGELOG.md';
const TURBO_METHOD = 'TuRBO-1 Bayesian optimisation with snapped local refinement';

type CampaignDefinition =
  | { kind: 'refitted'; evidenceYear: number; startingVersion: string; artifactDirectory: string }
  | { kind: 'original'; evidenceYear: number; method: string; provenance: string[] }
  | { kind: 'inherited'; evidenceYear: number; sourceVersion: string; provenance: string[] };

interface ModelProvenanceDefinition {
  name: string;
  dataVintage: string;
  fitVintage: string;
  method: string;
  inheritance: string | null;
  campaign: CampaignDefinition;
}

const MODEL_PROVENANCE: Record<string, ModelProvenanceDefinition> = {
  v0: {
    name: 'Original 2011 model', dataVintage: '2011', fitVintage: '2011',
    method: 'Published simulated method of moments (SMM) calibration', inheritance: null,
    campaign: {
      kind: 'original', evidenceYear: 2011,
      method: 'Published simulated method of moments (SMM) calibration',
      provenance: [
        'v0/config.properties',
        'calibration-evidence/output-grid-smm-v0-2011-carro-3level/OutputGridSmmMetadata.json'
      ]
    }
  },
  v0o7: {
    name: 'Refitted 2011 model', dataVintage: '2011', fitVintage: '2011',
    method: TURBO_METHOD, inheritance: 'Refitted from v0 against the 2011 evidence profile.',
    campaign: {
      kind: 'refitted', evidenceYear: 2011, startingVersion: 'v0',
      artifactDirectory: 'calibration-evidence/output-five-parameter-turbo-v0o7'
    }
  },
  'v4.26': {
    name: '2024 data model', dataVintage: '2024', fitVintage: '2011',
    method: 'Inherited original behavioural fit',
    inheritance: 'Uses updated 2024 empirical inputs but inherits the behavioural values fitted for v0 to 2011 evidence.',
    campaign: {
      kind: 'inherited', evidenceYear: 2011, sourceVersion: 'v0',
      provenance: ['v0/config.properties', 'v4.26/config.properties', CHANGELOG_PATH]
    }
  },
  v5o3: {
    name: 'Refitted 2024 model', dataVintage: '2024', fitVintage: '2024',
    method: TURBO_METHOD, inheritance: 'Refitted from v4.26 against the 2024 evidence profile.',
    campaign: {
      kind: 'refitted', evidenceYear: 2024, startingVersion: 'v4.26',
      artifactDirectory: 'calibration-evidence/output-five-parameter-turbo-v5o3'
    }
  }
};

interface TurboSummary {
  workflow?: string;
  sourceVersion?: string;
  validationProfile?: { validationTargetYear?: number };
  validationObjective?: string;
  baseline?: { overallCompositeLoss?: number };
  selected?: {
    overallCompositeLoss?: number;
    improvesTotalLoss?: boolean;
    hpiConstrainedEligible?: boolean;
    hpiMetricLossRegressions?: string[];
  };
  parameterSpecs?: { name: string; lower: number; upper: number; prior_lower: number; prior_upper: number }[];
  observations?: { metric_id: string }[];
  seeds?: number[];
  nSteps?: number;
  validationWindow?: { startIndex: number; endIndex: number };
  initialPoints?: number;
  maxEvaluations?: number;
  candidateBatchSize?: number;
  workers?: number;
  rngSeed?: number;
  localRefinement?: { promotionAccepted?: boolean; evaluatedCandidateCount?: number };
  finalValidationNote?: string;
}

function targetGroup(metricId: string): string {
  if (metricId.includes('hpi') || metricId.includes('housePrice')) return 'House prices and cycle';
  if (metricId.includes('distribution') || metricId.includes('wealth')) return 'Household distributions';
  if (metricId.includes('owning') || metricId.includes('renting')) return 'Tenure';
  if (metricId.includes('mortgage') || metricId.includes('advances') || metricId.includes('debt') || metricId.includes('interest')) return 'Credit and lending';
  return 'Market activity and returns';
}

function groupsFor(observations: { metric_id: string }[] = []) {
  const grouped = new Map<string, string[]>();
  for (const observation of observations) {
    const group = targetGroup(observation.metric_id);
    grouped.set(group, [...(grouped.get(group) ?? []), observation.metric_id.replace(/^core_/, '')]);
  }
  return [...grouped].map(([name, indicators]) => ({ name, indicators, count: indicators.length }));
}

function existingProvenance(dataRoot: string, candidates: string[]): string[] {
  return candidates.filter((candidate) => fs.existsSync(path.join(dataRoot, candidate)));
}

function unavailableCampaign(dataRoot: string, version: string, evidenceYear: number | null, provenance: string[] = []): CalibrationCampaign {
  return {
    kind: 'unavailable',
    evidenceYear,
    provenance: existingProvenance(dataRoot, [`${version}/config.properties`, ...provenance, CHANGELOG_PATH])
  };
}

function optionalSetting(label: string, value: number | undefined): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? `${label}: ${value}` : null;
}

function turboCampaign(
  dataRoot: string,
  version: string,
  definition: Extract<CampaignDefinition, { kind: 'refitted' }>
): { campaign: CalibrationCampaign; specs: TurboSummary['parameterSpecs'] } {
  const summaryPath = `${definition.artifactDirectory}/OutputParameterTurboCalibrationSummary.json`;
  const artifact = path.join(dataRoot, summaryPath);
  const supportingProvenance = [
    `${definition.artifactDirectory}/OutputParameterTurboMetadata.json`,
    `${definition.artifactDirectory}/README.md`
  ];
  if (!fs.existsSync(artifact)) {
    return {
      campaign: unavailableCampaign(dataRoot, version, definition.evidenceYear, supportingProvenance),
      specs: []
    };
  }

  let summary: TurboSummary;
  try {
    summary = JSON.parse(fs.readFileSync(artifact, 'utf8')) as TurboSummary;
  } catch {
    return {
      campaign: unavailableCampaign(dataRoot, version, definition.evidenceYear, supportingProvenance),
      specs: []
    };
  }

  const baseline = summary.baseline?.overallCompositeLoss;
  const selected = summary.selected?.overallCompositeLoss;
  const evidenceYear = summary.validationProfile?.validationTargetYear;
  const sourceVersion = summary.sourceVersion?.trim();
  const targetGroups = groupsFor(summary.observations);
  const targetOutcomeCount = summary.observations?.length ?? 0;
  const tunedParameterCount = summary.parameterSpecs?.length ?? 0;
  const promotionAccepted = summary.localRefinement?.promotionAccepted;
  const improvesTotalLoss = summary.selected?.improvesTotalLoss;
  const hpiConstrainedEligible = summary.selected?.hpiConstrainedEligible;
  const complete = summary.workflow === 'five-parameter-turbo'
    && sourceVersion === definition.startingVersion
    && evidenceYear === definition.evidenceYear
    && typeof baseline === 'number' && Number.isFinite(baseline)
    && typeof selected === 'number' && Number.isFinite(selected)
    && tunedParameterCount === PARAMETER_KEYS.length
    && targetOutcomeCount > 0
    && typeof promotionAccepted === 'boolean'
    && typeof improvesTotalLoss === 'boolean'
    && typeof hpiConstrainedEligible === 'boolean';

  if (!complete) {
    return {
      campaign: unavailableCampaign(dataRoot, version, definition.evidenceYear, [summaryPath, ...supportingProvenance]),
      specs: summary.parameterSpecs ?? []
    };
  }

  const optimisationSettings = [
    optionalSetting('Initial points', summary.initialPoints),
    optionalSetting('Maximum evaluations', summary.maxEvaluations),
    optionalSetting('Candidate batch', summary.candidateBatchSize),
    optionalSetting('Workers', summary.workers),
    optionalSetting('RNG seed', summary.rngSeed),
    optionalSetting('Local candidates evaluated', summary.localRefinement?.evaluatedCandidateCount)
  ].filter((setting): setting is string => setting !== null);

  return {
    specs: summary.parameterSpecs,
    campaign: {
      kind: 'refitted', evidenceYear, startingVersion: sourceVersion,
      method: TURBO_METHOD, tunedParameterCount, targetOutcomeCount,
      objective: summary.validationObjective === 'family_aware_metric_loss'
        ? 'Minimise family-aware composite validation loss'
        : summary.validationObjective ?? null,
      targetGroups, baselineLoss: baseline, selectedLoss: selected,
      absoluteImprovement: baseline - selected,
      passedChecks: improvesTotalLoss && hpiConstrainedEligible
        && (summary.selected?.hpiMetricLossRegressions?.length ?? 0) === 0,
      selected: promotionAccepted,
      guardrail: summary.finalValidationNote?.trim() || null,
      seeds: summary.seeds ?? null,
      simulationSteps: summary.nSteps ?? null,
      analysisWindow: summary.validationWindow ? { start: summary.validationWindow.startIndex, end: summary.validationWindow.endIndex } : null,
      optimisationSettings,
      artifactPath: summaryPath,
      provenance: existingProvenance(dataRoot, [...supportingProvenance, CHANGELOG_PATH])
    }
  };
}

function modelOverview(pathsInput: RuntimePathInput, version: string): CalibrationModelOverview {
  const paths = resolveRuntimePaths(pathsInput);
  const config = parseConfigFile(getConfigPath(paths, version));
  const provenance = MODEL_PROVENANCE[version];
  let campaign: CalibrationCampaign;
  let campaignSpecs: TurboSummary['parameterSpecs'] = [];
  if (!provenance) {
    campaign = unavailableCampaign(paths.dataRoot, version, null);
  } else if (provenance.campaign.kind === 'refitted') {
    const turbo = turboCampaign(paths.dataRoot, version, provenance.campaign);
    campaign = turbo.campaign;
    campaignSpecs = turbo.specs;
  } else if (provenance.campaign.kind === 'original') {
    campaign = {
      kind: 'original', evidenceYear: provenance.campaign.evidenceYear,
      method: provenance.campaign.method, status: 'Original published configuration',
      provenance: existingProvenance(paths.dataRoot, provenance.campaign.provenance)
    };
  } else {
    campaign = {
      kind: 'inherited', evidenceYear: provenance.campaign.evidenceYear,
      sourceVersion: provenance.campaign.sourceVersion, parametersUnchanged: true,
      provenance: existingProvenance(paths.dataRoot, provenance.campaign.provenance)
    };
  }

  const specs = new Map((campaignSpecs ?? []).map((spec) => [spec.name, spec]));
  const parameters = PARAMETER_KEYS.map((key) => {
    const value = Number(config.get(key));
    if (!Number.isFinite(value)) throw new Error(`Missing numeric calibration parameter ${key} in ${version}`);
    const spec = specs.get(key);
    return { ...PARAMETER_COPY[key]!, value, lower: spec?.lower ?? null, upper: spec?.upper ?? null, priorLower: spec?.prior_lower ?? null, priorUpper: spec?.prior_upper ?? null };
  });
  return {
    identity: {
      version, name: provenance?.name ?? `${version} historical calibration step`,
      dataVintage: provenance?.dataVintage ?? 'Not recorded', fitVintage: provenance?.fitVintage ?? 'Not recorded',
      method: provenance?.method ?? 'Not recorded', inheritance: provenance?.inheritance ?? null
    }, campaign, parameters
  };
}

export function getCalibrationOverview(paths: RuntimePathInput, primaryVersion: string, comparisonVersion?: string): CalibrationOverviewResponse {
  const primary = modelOverview(paths, primaryVersion);
  const comparison = comparisonVersion ? modelOverview(paths, comparisonVersion) : null;
  return {
    primary, comparison,
    sameEvidenceProfile: comparison !== null && primary.campaign.evidenceYear !== null && primary.campaign.evidenceYear === comparison.campaign.evidenceYear
  };
}
