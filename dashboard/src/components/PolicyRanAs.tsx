import { describeRanAs, formatLenderLimit } from '../../shared/lenderLimits';

/**
 * " (ran as 85%)" after a recorded policy value that was past its model's lender limit, so the run
 * used the limit instead. Shown only beside values a view marks as changed or different.
 */
export function PolicyRanAs({ settingKey, ranAs }: { settingKey: string; ranAs: number | undefined }) {
  if (ranAs === undefined) return null;
  return (
    <span className="policy-ran-as" title={describeRanAs(settingKey, ranAs)}>
      {' '}(ran as {formatLenderLimit(settingKey, ranAs)})
    </span>
  );
}
