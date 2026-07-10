/**
 * Environment variable names for per-instance wait limits.
 *
 * Values are set by {@link EC2InstanceRunningScheduler} and read at handler cold start.
 */

/**
 * Lambda environment variable name for max wait loop count.
 *
 * @see {@link parseResourceWaitLimitsFromEnv} in `running-scheduler-wait-env.ts`
 */
export const PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV = 'PROCESS_RESOURCE_MAX_LOOP_COUNT';

/**
 * Lambda environment variable name for max wait elapsed seconds.
 *
 * @see {@link parseResourceWaitLimitsFromEnv} in `running-scheduler-wait-env.ts`
 */
export const PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV = 'PROCESS_RESOURCE_MAX_ELAPSED_SECONDS';
