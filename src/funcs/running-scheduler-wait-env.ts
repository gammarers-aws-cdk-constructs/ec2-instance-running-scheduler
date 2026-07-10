/**
 * Lambda-only environment parsing for per-instance wait limits.
 *
 * Bundled into the running scheduler function; not imported from CDK constructs.
 */
import { SafeEnvGetter, SafeEnvType } from 'safe-env-getter';
import {
  DEFAULT_RESOURCE_WAIT_LIMITS,
  type ResourceWaitLimits,
} from './running-scheduler-predicates';
import {
  PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV,
  PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV,
} from './running-scheduler-wait-config';

/**
 * Ensures a parsed env integer is strictly positive.
 *
 * `SafeEnvType.Number` accepts any decimal integer (including zero and negatives);
 * wait limits require values greater than zero.
 *
 * @param key - Environment variable name used in error messages.
 * @param value - Parsed integer from {@link SafeEnvGetter.getEnvs}.
 * @returns `value` when it is greater than zero.
 * @throws {Error} When `value` is zero or negative.
 */
const assertPositiveEnvInt = (key: string, value: number): number => {
  if (value <= 0) {
    const raw = process.env[key];
    throw new Error(`Invalid ${key}: must be a positive integer (got "${raw ?? ''}")`);
  }
  return value;
};

/**
 * Reads per-instance wait limits from Lambda environment variables set by the CDK construct.
 *
 * @returns Parsed limits, using {@link DEFAULT_RESOURCE_WAIT_LIMITS} when variables are unset.
 * @throws {Error} When a set variable is not a positive integer.
 */
export const parseResourceWaitLimitsFromEnv = (): ResourceWaitLimits => {
  const parsed = SafeEnvGetter.getEnvs({
    [PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV]: [
      SafeEnvType.Number,
      { default: DEFAULT_RESOURCE_WAIT_LIMITS.maxLoopCount },
    ],
    [PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV]: [
      SafeEnvType.Number,
      { default: DEFAULT_RESOURCE_WAIT_LIMITS.maxElapsedSeconds },
    ],
  });

  return {
    maxLoopCount: assertPositiveEnvInt(
      PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV,
      parsed[PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV],
    ),
    maxElapsedSeconds: assertPositiveEnvInt(
      PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV,
      parsed[PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV],
    ),
  };
};
