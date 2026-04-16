/**
 * Pure predicates for the EC2 running scheduler Lambda (no AWS SDK).
 */

/** Value of `Params.Mode` from the EventBridge Scheduler payload. */
export type RunningSchedulerMode = 'Start' | 'Stop';

/**
 * Whether the instance is already in the goal state for the scheduler mode (no start/stop needed).
 *
 * @param mode - `Start` expects `running`; `Stop` expects `stopped`.
 * @param currentState - Instance state from `DescribeInstances` (e.g. `running`, `pending`).
 * @returns `true` when the instance matches the target state for `mode`.
 */
export const isDesiredStableState = (mode: RunningSchedulerMode, currentState: string): boolean =>
  (mode === 'Start' && currentState === 'running') || (mode === 'Stop' && currentState === 'stopped');
