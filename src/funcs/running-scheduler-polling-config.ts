/**
 * Environment variable names and parsing for per-instance polling limits.
 *
 * Values are set by {@link EC2InstanceRunningScheduler} and read at handler cold start.
 */
import {
  DEFAULT_RESOURCE_POLLING_LIMITS,
  type ResourcePollingLimits,
} from './running-scheduler-predicates';

/**
 * Lambda environment variable name for {@link ResourcePollingLimits.maxLoopCount}.
 *
 * @see {@link parseResourcePollingLimitsFromEnv}
 */
export const PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV = 'PROCESS_RESOURCE_MAX_LOOP_COUNT';

/**
 * Lambda environment variable name for {@link ResourcePollingLimits.maxElapsedSeconds}.
 *
 * @see {@link parseResourcePollingLimitsFromEnv}
 */
export const PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV = 'PROCESS_RESOURCE_MAX_ELAPSED_SECONDS';

/**
 * Parses a positive integer from an environment variable value.
 *
 * @param raw - Raw env value (may be undefined or empty).
 * @param fallback - Value used when `raw` is unset or empty.
 * @param envName - Variable name used in error messages.
 * @returns Parsed positive integer or `fallback`.
 * @throws {Error} If `raw` is set but not a positive integer.
 */
const parsePositiveInt = (raw: string | undefined, fallback: number, envName: string): number => {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${envName}: must be a positive integer (got "${raw}")`);
  }
  return parsed;
};

/**
 * Reads per-instance polling limits from Lambda environment variables set by the CDK construct.
 *
 * @param env - Process environment (e.g. `process.env`).
 * @returns Parsed limits, using {@link DEFAULT_RESOURCE_POLLING_LIMITS} when variables are unset.
 * @throws {Error} If a set variable is not a positive integer.
 */
export const parseResourcePollingLimitsFromEnv = (
  env: Record<string, string | undefined>,
): ResourcePollingLimits => ({
  maxLoopCount: parsePositiveInt(
    env[PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV],
    DEFAULT_RESOURCE_POLLING_LIMITS.maxLoopCount,
    PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV,
  ),
  maxElapsedSeconds: parsePositiveInt(
    env[PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV],
    DEFAULT_RESOURCE_POLLING_LIMITS.maxElapsedSeconds,
    PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV,
  ),
});
