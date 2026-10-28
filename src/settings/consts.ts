/**
 * Values shared by the scheduler construct and the running-scheduler Lambda handler.
 *
 * Channel names are written to {@link NOTIFICATION_CHANNEL_ENV} and read back at runtime.
 */

/** Lambda environment variable selecting the notification channel. */
export const NOTIFICATION_CHANNEL_ENV = 'NOTIFICATION_CHANNEL';

/** Lambda environment variable naming the Slack secret. Set only for the Slack channel. */
export const SLACK_SECRET_NAME_ENV = 'SLACK_SECRET_NAME';

/** Lambda environment variable holding the SNS topic ARN. Set only for the SNS channel. */
export const NOTIFICATION_TOPIC_ARN_ENV = 'NOTIFICATION_TOPIC_ARN';

/** Lambda environment variable holding the EventBridge bus name. Set only for that channel. */
export const NOTIFICATION_EVENT_BUS_NAME_ENV = 'NOTIFICATION_EVENT_BUS_NAME';

/** Log-only notification. No Slack, SNS, or EventBridge call. */
export const NOTIFICATION_CHANNEL_LOGS = 'logs';

/** Slack parent message and per-instance thread replies. */
export const NOTIFICATION_CHANNEL_SLACK = 'slack';

/** One plain-text SNS publish after all instances are processed. */
export const NOTIFICATION_CHANNEL_SNS = 'sns';

/** One EventBridge `PutEvents` after all instances are processed. */
export const NOTIFICATION_CHANNEL_EVENT_BRIDGE = 'eventBridge';

/**
 * Error log message matched by the notification-post failure metric filter.
 *
 * Keep the text identical in the handler and the CloudWatch filter.
 */
export const NOTIFICATION_POST_FAILED_LOG = 'running-scheduler: notification post failed';

/** `Source` on the scheduler's EventBridge notification event. */
export const NOTIFICATION_EVENT_SOURCE = 'ec2-instance-running-scheduler';

/** `DetailType` on the scheduler's EventBridge notification event. */
export const NOTIFICATION_EVENT_DETAIL_TYPE = 'EC2InstanceRunningScheduler.Completed';

/** Lambda environment variable for the max wait loop count. */
export const PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV = 'PROCESS_RESOURCE_MAX_LOOP_COUNT';

/** Lambda environment variable for the max wait elapsed seconds. */
export const PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV = 'PROCESS_RESOURCE_MAX_ELAPSED_SECONDS';

/** Lambda environment variable for seconds between describe/wait iterations. */
export const PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS_ENV = 'PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS';

/** Lambda environment variable for durable `map` bounded concurrency. */
export const PROCESS_RESOURCES_MAX_CONCURRENCY_ENV = 'PROCESS_RESOURCES_MAX_CONCURRENCY';

/** Default describe/wait iterations per instance. */
export const DEFAULT_MAX_LOOP_COUNT = 90;

/** Default wall-clock seconds spent waiting for one instance to stabilize. */
export const DEFAULT_MAX_ELAPSED_SECONDS = 1800;

/** Default seconds between describe iterations after start/stop or while transitioning. */
export const DEFAULT_STATUS_CHANGE_WAIT_SECONDS = 20;

/** Default bounded parallelism for durable `map` over target instances. */
export const DEFAULT_MAX_CONCURRENCY = 10;
