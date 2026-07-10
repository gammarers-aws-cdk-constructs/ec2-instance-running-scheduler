/**
 * Pure predicates for the EC2 running scheduler Lambda (no AWS SDK).
 */

/** Value of `Params.Mode` from the EventBridge Scheduler payload. */
export type RunningSchedulerMode = 'Start' | 'Stop';

/** Upper bounds for per-instance stable-state waiting in the running scheduler Lambda handler. */
export interface ResourceWaitLimits {
  /** Maximum describe/wait loop iterations before failing (each loop may include a durable wait). */
  readonly maxLoopCount: number;
  /** Maximum wall-clock seconds from the first wait iteration before failing. */
  readonly maxElapsedSeconds: number;
}

/** Default wait limits (90 loops × 20s wait ≈ 30 minutes of waits; 30 minutes elapsed). */
export const DEFAULT_RESOURCE_WAIT_LIMITS: ResourceWaitLimits = {
  maxLoopCount: 90,
  maxElapsedSeconds: 1800,
};

/**
 * Why per-instance waiting stopped with an error.
 *
 * - `MaxLoopCountExceeded` – {@link getWaitAbortReason} hit {@link ResourceWaitLimits.maxLoopCount}.
 * - `MaxElapsedTimeExceeded` – elapsed wall-clock time exceeded {@link ResourceWaitLimits.maxElapsedSeconds}.
 * - `UnexpectedInstanceState` – state is neither stable, actionable, nor a known transition.
 */
export type ResourceWaitFailureReason =
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
 * Returns a wait abort reason when loop count or elapsed time exceeds configured limits.
 *
 * @param loopCount - Zero-based iteration count for the current wait loop.
 * @param startedAtMs - Epoch milliseconds recorded at the start of waiting (durable step).
 * @param nowMs - Current epoch milliseconds (from a durable step when replay matters).
 * @param limits - Configured {@link ResourceWaitLimits}.
 * @returns Abort reason, or `undefined` when waiting may continue.
 */
export const getWaitAbortReason = (
  loopCount: number,
  startedAtMs: number,
  nowMs: number,
  limits: ResourceWaitLimits,
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

/** Inputs for {@link formatResourceWaitFailure}. */
export interface ResourceWaitFailureContext {
  /** EC2 instance id parsed from the target ARN. */
  readonly identifier: string;
  /** Scheduler mode from the invocation payload. */
  readonly mode: RunningSchedulerMode;
  /** Last observed instance state from `DescribeInstances`. */
  readonly currentState: string;
  /** Zero-based wait loop iteration when the failure occurred. */
  readonly loopCount: number;
  /** Active wait limits for limit-related failure messages. */
  readonly limits: ResourceWaitLimits;
}

/**
 * Builds a stable, grep-friendly error message for wait failures.
 *
 * @param reason - Failure category.
 * @param context - Instance id, mode, state, loop count, and limits.
 * @returns Message prefixed with `ResourceWaitFailed:` (e.g. `ResourceWaitFailed:MaxLoopCountExceeded: ...`).
 */
export const formatResourceWaitFailure = (
  reason: ResourceWaitFailureReason,
  context: ResourceWaitFailureContext,
): string => {
  const common =
    `identifier=${context.identifier} mode=${context.mode} currentState=${context.currentState} loopCount=${context.loopCount}`;
  if (reason === 'MaxLoopCountExceeded') {
    return `ResourceWaitFailed:MaxLoopCountExceeded: ${common} maxLoopCount=${context.limits.maxLoopCount}`;
  }
  if (reason === 'MaxElapsedTimeExceeded') {
    return `ResourceWaitFailed:MaxElapsedTimeExceeded: ${common} maxElapsedSeconds=${context.limits.maxElapsedSeconds}`;
  }
  return `ResourceWaitFailed:UnexpectedInstanceState: ${common}`;
};
