/**
 * Lambda-only environment parsing for running scheduler handler configuration.
 *
 * Bundled into the running scheduler function; not imported from CDK constructs.
 */
import { StrictEnvResolver, StrictEnvType } from 'strict-env-resolver';
import {
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_RESOURCE_WAIT_LIMITS,
  type ResourceWaitLimits,
} from './running-scheduler-predicates';
import {
  PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV,
  PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV,
  PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS_ENV,
  PROCESS_RESOURCES_MAX_CONCURRENCY_ENV,
} from './running-scheduler-wait-config';

/**
 * Reads per-instance wait limits from Lambda environment variables set by the CDK construct.
 *
 * @returns Parsed limits, using {@link DEFAULT_RESOURCE_WAIT_LIMITS} when variables are unset.
 * @throws {import('strict-env-resolver').StrictEnvValidationError} When a set variable is not a positive integer.
 */
export const parseResourceWaitLimitsFromEnv = (): ResourceWaitLimits => {
  const parsed = StrictEnvResolver.resolveAll({
    [PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV]: [
      StrictEnvType.PositiveInt,
      { default: DEFAULT_RESOURCE_WAIT_LIMITS.maxLoopCount },
    ],
    [PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV]: [
      StrictEnvType.PositiveInt,
      { default: DEFAULT_RESOURCE_WAIT_LIMITS.maxElapsedSeconds },
    ],
    [PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS_ENV]: [
      StrictEnvType.PositiveInt,
      { default: DEFAULT_RESOURCE_WAIT_LIMITS.statusChangeWaitSeconds },
    ],
  });

  return {
    maxLoopCount: parsed[PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV],
    maxElapsedSeconds: parsed[PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV],
    statusChangeWaitSeconds: parsed[PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS_ENV],
  };
};

/**
 * Reads durable `map` bounded concurrency from the Lambda environment.
 *
 * @returns Parsed concurrency, using {@link DEFAULT_MAX_CONCURRENCY} when unset.
 * @throws {import('strict-env-resolver').StrictEnvValidationError} When a set variable is not a positive integer.
 */
export const parseMaxConcurrencyFromEnv = (): number => {
  const parsed = StrictEnvResolver.resolveAll({
    [PROCESS_RESOURCES_MAX_CONCURRENCY_ENV]: [
      StrictEnvType.PositiveInt,
      { default: DEFAULT_MAX_CONCURRENCY },
    ],
  });

  return parsed[PROCESS_RESOURCES_MAX_CONCURRENCY_ENV];
};
