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
const ANCHORS: Record<string, { name: string; data: string; fit: string; method: string; inheritance: string | null }> = {
  v0: { name: 'Original 2011 model', data: '2011', fit: '2011', method: 'Original documented output calibration', inheritance: null },
  v0o7: { name: 'Refitted 2011 model', data: '2011', fit: '2011', method: 'TuRBO-1 with snapped local refinement', inheritance: 'Refitted from v0 against the 2011 evidence profile.' },
  'v4.26': { name: '2024 data model', data: '2024', fit: '2011', method: 'Inherited original behavioural fit', inheritance: 'Uses updated 2024 empirical inputs but inherits the behavioural values fitted for v0 to 2011 evidence.' },
  v5o3: { name: 'Refitted 2024 model', data: '2024', fit: '2024', method: 'TuRBO-1 with snapped local refinement', inheritance: 'Refitted from v4.26 against the 2024 evidence profile.' }
};

interface TurboSummary {
  validationProfile?: { validationTargetYear?: number };
  validationObjective?: string;
  baseline?: { overallCompositeLoss?: number };
  selected?: { overallCompositeLoss?: number };
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

function emptyCampaign(method: string, evidenceYear: number | null, provenance: string[]): CalibrationCampaign {
  return {
    evidenceYear, method, objective: 'Not recorded', targetGroups: [], baselineLoss: null,
    selectedLoss: null, improvement: null, promotion: 'Not recorded', guardrail: 'Not recorded',
    seeds: null, simulationSteps: null, analysisWindow: null, optimisationSettings: [], provenance
  };
}

function turboCampaign(dataRoot: string, version: 'v0o7' | 'v5o3'): { campaign: CalibrationCampaign; specs: TurboSummary['parameterSpecs'] } | null {
  const artifact = path.join(dataRoot, 'calibration-evidence', `output-five-parameter-turbo-${version}`, 'OutputParameterTurboCalibrationSummary.json');
  if (!fs.existsSync(artifact)) return null;
  const summary = JSON.parse(fs.readFileSync(artifact, 'utf8')) as TurboSummary;
  const baseline = summary.baseline?.overallCompositeLoss ?? null;
  const selected = summary.selected?.overallCompositeLoss ?? null;
  return {
    specs: summary.parameterSpecs,
    campaign: {
      evidenceYear: summary.validationProfile?.validationTargetYear ?? null,
      method: 'TuRBO-1 Bayesian optimisation with snapped local refinement',
      objective: summary.validationObjective === 'family_aware_metric_loss' ? 'Minimise family-aware composite validation loss' : summary.validationObjective ?? 'Not recorded',
      targetGroups: groupsFor(summary.observations), baselineLoss: baseline, selectedLoss: selected,
      improvement: baseline === null || selected === null ? null : baseline - selected,
      promotion: summary.localRefinement?.promotionAccepted ? 'Promoted' : 'Not promoted',
      guardrail: summary.finalValidationNote ?? 'Not recorded', seeds: summary.seeds ?? null,
      simulationSteps: summary.nSteps ?? null,
      analysisWindow: summary.validationWindow ? { start: summary.validationWindow.startIndex, end: summary.validationWindow.endIndex } : null,
      optimisationSettings: [
        `Initial points: ${summary.initialPoints ?? 'Not recorded'}`,
        `Maximum evaluations: ${summary.maxEvaluations ?? 'Not recorded'}`,
        `Candidate batch: ${summary.candidateBatchSize ?? 'Not recorded'}`,
        `Workers: ${summary.workers ?? 'Not recorded'}`,
        `RNG seed: ${summary.rngSeed ?? 'Not recorded'}`,
        `Local candidates evaluated: ${summary.localRefinement?.evaluatedCandidateCount ?? 'Not recorded'}`
      ],
      provenance: [path.relative(dataRoot, artifact)]
    }
  };
}

function modelOverview(pathsInput: RuntimePathInput, version: string): CalibrationModelOverview {
  const paths = resolveRuntimePaths(pathsInput);
  const config = parseConfigFile(getConfigPath(paths, version));
  const anchor = ANCHORS[version];
  const turbo = version === 'v0o7' || version === 'v5o3' ? turboCampaign(paths.dataRoot, version) : null;
  let campaign = turbo?.campaign ?? emptyCampaign(anchor?.method ?? 'Not recorded', anchor ? Number(anchor.fit) : null, ['CALIBRATION_PARAMETER_CHANGELOG.md']);
  if (version === 'v0') campaign = { ...campaign, objective: 'Fit unobservable behavioural assumptions to the original 2011 model evidence', promotion: 'Original published configuration' };
  if (version === 'v4.26') campaign = { ...campaign, objective: 'No new behavioural campaign; values inherited from v0', promotion: 'Inherited unchanged' };
  const specs = new Map((turbo?.specs ?? []).map((spec) => [spec.name, spec]));
  const parameters = PARAMETER_KEYS.map((key) => {
    const value = Number(config.get(key));
    if (!Number.isFinite(value)) throw new Error(`Missing numeric calibration parameter ${key} in ${version}`);
    const spec = specs.get(key);
    return { ...PARAMETER_COPY[key]!, value, lower: spec?.lower ?? null, upper: spec?.upper ?? null, priorLower: spec?.prior_lower ?? null, priorUpper: spec?.prior_upper ?? null };
  });
  return {
    identity: {
      version, name: anchor?.name ?? `${version} historical calibration step`,
      dataVintage: anchor?.data ?? 'Not recorded', fitVintage: anchor?.fit ?? 'Not recorded',
      method: anchor?.method ?? 'Not recorded', inheritance: anchor?.inheritance ?? null
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
