/**
 * Environment variable names for per-instance polling limits.
 *
 * Values are set by {@link EC2InstanceRunningScheduler} and read at handler cold start.
 */

/**
 * Lambda environment variable name for max poll loop count.
 *
 * @see {@link parseResourcePollingLimitsFromEnv} in `running-scheduler-polling-env.ts`
 */
export const PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV = 'PROCESS_RESOURCE_MAX_LOOP_COUNT';

/**
 * Lambda environment variable name for max poll elapsed seconds.
 *
 * @see {@link parseResourcePollingLimitsFromEnv} in `running-scheduler-polling-env.ts`
 */
export const PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV = 'PROCESS_RESOURCE_MAX_ELAPSED_SECONDS';
