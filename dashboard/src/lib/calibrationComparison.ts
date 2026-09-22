import type {
  CompareResponse,
  DeltaStat,
  JointCell,
  ScalarDatum,
  VisualPayload
} from '../../shared/types';

function parseVersionParts(version: string): number[] {
  const normalized = version.replace(/^v/i, '').toLowerCase();
  const numberedSuffix = normalized.match(/o(\d+)$/u);
  const suffix = numberedSuffix ? null : normalized.match(/o+$/u);
  const suffixRank = numberedSuffix
    ? 2 + Number.parseInt(numberedSuffix[1] ?? '0', 10)
    : suffix?.[0].length ?? 0;
  const numeric = numberedSuffix
    ? normalized.slice(0, numberedSuffix.index ?? normalized.length)
    : suffixRank > 0
      ? normalized.slice(0, -suffixRank)
      : normalized;
  return numeric.split('.').map((part) => Number.parseInt(part, 10)).concat(suffixRank);
}

export function compareCalibrationVersions(left: string, right: string): number {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (leftParts.length !== rightParts.length) return leftParts.length - rightParts.length;
  return left.localeCompare(right);
}

export function chronologicalCalibrationPair(
  primaryVersion: string,
  comparisonVersion: string
): readonly [string, string] {
  return compareCalibrationVersions(primaryVersion, comparisonVersion) <= 0
    ? [primaryVersion, comparisonVersion]
    : [comparisonVersion, primaryVersion];
}

function deltaStat(left: number, right: number): DeltaStat {
  const absolute = right - left;
  return {
    absolute,
    percent: Math.abs(left) < 1e-12 ? null : (absolute / left) * 100
  };
}

function swapScalar(row: ScalarDatum): ScalarDatum {
  return {
    ...row,
    left: row.right,
    right: row.left,
    delta: deltaStat(row.right, row.left)
  };
}

function swapJointDelta(cell: JointCell): JointCell {
  return { ...cell, value: -cell.value };
}

function swapVisualPayload(payload: VisualPayload): VisualPayload {
  switch (payload.type) {
    case 'scalar':
      return { ...payload, values: payload.values.map(swapScalar) };
    case 'binned_distribution':
      return {
        ...payload,
        bins: payload.bins.map((bin) => ({
          ...bin,
          left: bin.right,
          right: bin.left,
          delta: -bin.delta
        })),
        sourceBins: payload.sourceBins
          ? { left: payload.sourceBins.right, right: payload.sourceBins.left }
          : undefined
      };
    case 'joint_distribution':
      return {
        ...payload,
        matrix: {
          ...payload.matrix,
          left: payload.matrix.right,
          right: payload.matrix.left,
          delta: payload.matrix.delta.map(swapJointDelta)
        }
      };
    case 'lognormal_pair':
      return {
        ...payload,
        parameters: payload.parameters.map(swapScalar),
        curveLeft: payload.curveRight,
        curveRight: payload.curveLeft,
        median: {
          left: payload.median.right,
          right: payload.median.left,
          delta: deltaStat(payload.median.right, payload.median.left)
        }
      };
    case 'power_law_pair':
      return {
        ...payload,
        parameters: payload.parameters.map(swapScalar),
        curveLeft: payload.curveRight,
        curveRight: payload.curveLeft
      };
    case 'gaussian_pair':
      return {
        ...payload,
        parameters: payload.parameters.map(swapScalar),
        logCurveLeft: payload.logCurveRight,
        logCurveRight: payload.logCurveLeft,
        percentCurveLeft: payload.percentCurveRight,
        percentCurveRight: payload.percentCurveLeft,
        percentCapMassLeft: payload.percentCapMassRight,
        percentCapMassRight: payload.percentCapMassLeft,
        logMedian: {
          left: payload.logMedian.right,
          right: payload.logMedian.left,
          delta: deltaStat(payload.logMedian.right, payload.logMedian.left)
        },
        percentMedian: {
          left: payload.percentMedian.right,
          right: payload.percentMedian.left,
          delta: deltaStat(payload.percentMedian.right, payload.percentMedian.left)
        }
      };
    case 'hpa_expectation_line':
      return {
        ...payload,
        parameters: payload.parameters.map(swapScalar),
        curveLeft: payload.curveRight,
        curveRight: payload.curveLeft
      };
    case 'buy_quad':
      return {
        ...payload,
        parameters: payload.parameters.map(swapScalar),
        budgetLeft: payload.budgetRight,
        budgetRight: payload.budgetLeft,
        multiplierLeft: payload.multiplierRight,
        multiplierRight: payload.multiplierLeft,
        medianMultiplier: {
          left: payload.medianMultiplier.right,
          right: payload.medianMultiplier.left,
          delta: deltaStat(payload.medianMultiplier.right, payload.medianMultiplier.left)
        },
        expectedMultiplier: {
          left: payload.expectedMultiplier.right,
          right: payload.expectedMultiplier.left,
          delta: deltaStat(payload.expectedMultiplier.right, payload.expectedMultiplier.left)
        }
      };
  }
}

/**
 * The comparison API must be requested in chronological order so its provenance range remains
 * meaningful. Calibration names the currently inspected model “Model 1”, even when it is the
 * newer/right-hand API version, so this adapter swaps only the presentation payload.
 */
export function normalizeCalibrationComparison(
  response: CompareResponse,
  primaryVersion: string,
  comparisonVersion: string
): CompareResponse {
  if (
    !comparisonVersion ||
    primaryVersion === comparisonVersion ||
    (response.left === primaryVersion && response.right === comparisonVersion) ||
    response.left !== comparisonVersion ||
    response.right !== primaryVersion
  ) {
    return response;
  }

  return {
    left: primaryVersion,
    right: comparisonVersion,
    items: response.items.map((item) => ({
      ...item,
      leftVersion: primaryVersion,
      rightVersion: comparisonVersion,
      sourceInfo: {
        ...item.sourceInfo,
        configPathLeft: item.sourceInfo.configPathRight,
        configPathRight: item.sourceInfo.configPathLeft,
        dataFilesLeft: item.sourceInfo.dataFilesRight,
        dataFilesRight: item.sourceInfo.dataFilesLeft,
        datasetsLeft: item.sourceInfo.datasetsRight,
        datasetsRight: item.sourceInfo.datasetsLeft
      },
      visualPayload: swapVisualPayload(item.visualPayload)
    }))
  };
}
