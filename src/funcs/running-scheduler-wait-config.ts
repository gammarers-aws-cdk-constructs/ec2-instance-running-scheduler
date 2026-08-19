/**
 * Environment variable names for running scheduler handler configuration.
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

/**
 * Lambda environment variable name for seconds between describe/wait iterations.
 *
 * @see {@link parseResourceWaitLimitsFromEnv} in `running-scheduler-wait-env.ts`
 */
export const PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS_ENV = 'PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS';

/**
 * Lambda environment variable name for durable `map` bounded concurrency.
 *
 * @see {@link parseMaxConcurrencyFromEnv} in `running-scheduler-wait-env.ts`
 */
export const PROCESS_RESOURCES_MAX_CONCURRENCY_ENV = 'PROCESS_RESOURCES_MAX_CONCURRENCY';
