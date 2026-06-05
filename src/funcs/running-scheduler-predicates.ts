/**
 * Pure predicates for the EC2 running scheduler Lambda (no AWS SDK).
 */

/** Value of `Params.Mode` from the EventBridge Scheduler payload. */
export type RunningSchedulerMode = 'Start' | 'Stop';

/** Upper bounds for per-instance stable-state polling in the running scheduler Lambda. */
export interface ResourcePollingLimits {
  /** Maximum describe/poll iterations before failing (each loop may include a durable wait). */
  readonly maxLoopCount: number;
  /** Maximum wall-clock seconds from the first poll iteration before failing. */
  readonly maxElapsedSeconds: number;
}

/** Default polling limits (90 loops × 20s wait ≈ 30 minutes of waits; 30 minutes elapsed). */
export const DEFAULT_RESOURCE_POLLING_LIMITS: ResourcePollingLimits = {
  maxLoopCount: 90,
  maxElapsedSeconds: 1800,
};

/**
 * Why per-instance polling stopped with an error.
 *
 * - `MaxLoopCountExceeded` – {@link getPollingAbortReason} hit {@link ResourcePollingLimits.maxLoopCount}.
 * - `MaxElapsedTimeExceeded` – elapsed wall-clock time exceeded {@link ResourcePollingLimits.maxElapsedSeconds}.
 * - `UnexpectedInstanceState` – state is neither stable, actionable, nor a known transition.
 */
export type ResourcePollingFailureReason =
  | 'MaxLoopCountExceeded'
  | 'MaxElapsedTimeExceeded'
  | 'UnexpectedInstanceState';

/**
 * Whether the instance is already in the goal state for the scheduler mode (no start/stop needed).
 *
 * @param mode - `Start` expects `running`; `Stop` expects `stopped`.
 * @param currentState - Instance state from `DescribeInstances` (e.g. `running`, `pending`).
 * @returns `true` when the instance matches the target state for `mode`.
 */
export const isDesiredStableState = (mode: RunningSchedulerMode, currentState: string): boolean =>
  (mode === 'Start' && currentState === 'running') || (mode === 'Stop' && currentState === 'stopped');

/**
 * Whether the instance is in a known transitional state for the scheduler mode.
 *
 * @param mode - `Start` or `Stop`.
 * @param currentState - Instance state from `DescribeInstances`.
 * @returns `true` when the instance is moving toward the goal state for `mode`.
 */
export const isTransitioningState = (mode: RunningSchedulerMode, currentState: string): boolean =>
  (mode === 'Start' && currentState === 'pending') ||
  (mode === 'Stop' && (currentState === 'stopping' || currentState === 'shutting-down'));

/**
 * Returns a polling abort reason when loop count or elapsed time exceeds configured limits.
 *
 * @param loopCount - Zero-based iteration count for the current poll loop.
 * @param startedAtMs - Epoch milliseconds recorded at the start of polling (durable step).
 * @param nowMs - Current epoch milliseconds (from a durable step when replay matters).
 * @param limits - Configured {@link ResourcePollingLimits}.
 * @returns Abort reason, or `undefined` when polling may continue.
 */
export const getPollingAbortReason = (
  loopCount: number,
  startedAtMs: number,
  nowMs: number,
  limits: ResourcePollingLimits,
): 'MaxLoopCountExceeded' | 'MaxElapsedTimeExceeded' | undefined => {
  if (loopCount >= limits.maxLoopCount) {
    return 'MaxLoopCountExceeded';
  }
  const elapsedSeconds = (nowMs - startedAtMs) / 1000;
  if (elapsedSeconds >= limits.maxElapsedSeconds) {
    return 'MaxElapsedTimeExceeded';
  }
  return undefined;
};

/** Inputs for {@link formatResourcePollingFailure}. */
export interface ResourcePollingFailureContext {
  /** EC2 instance id parsed from the target ARN. */
  readonly identifier: string;
  /** Scheduler mode from the invocation payload. */
  readonly mode: RunningSchedulerMode;
  /** Last observed instance state from `DescribeInstances`. */
  readonly currentState: string;
  /** Zero-based poll loop iteration when the failure occurred. */
  readonly loopCount: number;
  /** Active polling limits for limit-related failure messages. */
  readonly limits: ResourcePollingLimits;
}

/**
 * Builds a stable, grep-friendly error message for polling failures.
 *
 * @param reason - Failure category.
 * @param context - Instance id, mode, state, loop count, and limits.
 * @returns Message prefixed with `ResourcePollingFailed:` (e.g. `ResourcePollingFailed:MaxLoopCountExceeded: ...`).
 */
export const formatResourcePollingFailure = (
  reason: ResourcePollingFailureReason,
  context: ResourcePollingFailureContext,
): string => {
  const common =
    `identifier=${context.identifier} mode=${context.mode} currentState=${context.currentState} loopCount=${context.loopCount}`;
  if (reason === 'MaxLoopCountExceeded') {
    return `ResourcePollingFailed:MaxLoopCountExceeded: ${common} maxLoopCount=${context.limits.maxLoopCount}`;
  }
  if (reason === 'MaxElapsedTimeExceeded') {
    return `ResourcePollingFailed:MaxElapsedTimeExceeded: ${common} maxElapsedSeconds=${context.limits.maxElapsedSeconds}`;
  }
  return `ResourcePollingFailed:UnexpectedInstanceState: ${common}`;
};
