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
import {
  NOTIFICATION_CHANNEL_ENV,
  NOTIFICATION_CHANNEL_EVENT_BRIDGE,
  NOTIFICATION_CHANNEL_LOGS,
  NOTIFICATION_CHANNEL_SLACK,
  NOTIFICATION_CHANNEL_SNS,
  NOTIFICATION_EVENT_BUS_NAME_ENV,
  NOTIFICATION_TOPIC_ARN_ENV,
  SLACK_SECRET_NAME_ENV,
} from '../settings/consts';

/**
 * Reads per-instance wait limits from Lambda environment variables set by the CDK construct.
 *
 * @returns Parsed limits, using {@link DEFAULT_RESOURCE_WAIT_LIMITS} when variables are unset.
 * @throws {import('strict-env-resolver').StrictEnvValidationError} When a set variable is not a positive integer.
 */
export const parseResourceWaitLimitsFromEnv = (): ResourceWaitLimits => {
  const parsed = StrictEnvResolver.resolveAll({
    [PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV]: [
      StrictEnvType.Number.PositiveInteger,
      { default: DEFAULT_RESOURCE_WAIT_LIMITS.maxLoopCount },
    ],
    [PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV]: [
      StrictEnvType.Number.PositiveInteger,
      { default: DEFAULT_RESOURCE_WAIT_LIMITS.maxElapsedSeconds },
    ],
    [PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS_ENV]: [
      StrictEnvType.Number.PositiveInteger,
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
      StrictEnvType.Number.PositiveInteger,
      { default: DEFAULT_MAX_CONCURRENCY },
    ],
  });

  return parsed[PROCESS_RESOURCES_MAX_CONCURRENCY_ENV];
};

const NOTIFICATION_CHANNELS = [
  NOTIFICATION_CHANNEL_LOGS,
  NOTIFICATION_CHANNEL_SLACK,
  NOTIFICATION_CHANNEL_SNS,
  NOTIFICATION_CHANNEL_EVENT_BRIDGE,
] as const;

/** Notification settings resolved from the Lambda environment. */
export type ResolvedNotification =
  | { readonly channel: typeof NOTIFICATION_CHANNEL_LOGS }
  | { readonly channel: typeof NOTIFICATION_CHANNEL_SLACK; readonly slackSecretName: string }
  | { readonly channel: typeof NOTIFICATION_CHANNEL_SNS; readonly topicArn: string }
  | { readonly channel: typeof NOTIFICATION_CHANNEL_EVENT_BRIDGE; readonly eventBusName: string };

/**
 * Resolves which notification channel this invocation uses.
 *
 * Omitted {@link NOTIFICATION_CHANNEL_ENV} means logs only.
 *
 * @returns Channel and the setting that channel requires.
 * @throws {import('strict-env-resolver').StrictEnvValidationError} When the channel is not one of
 *   `logs`, `slack`, `sns`, or `eventBridge`, or a required setting for that channel is missing.
 */
export const parseNotificationFromEnv = (): ResolvedNotification => {
  const channel = StrictEnvResolver.resolve(
    NOTIFICATION_CHANNEL_ENV,
    StrictEnvType.Enum(NOTIFICATION_CHANNELS),
    { default: NOTIFICATION_CHANNEL_LOGS },
  );

  if (channel === NOTIFICATION_CHANNEL_LOGS) {
    return { channel };
  }
  if (channel === NOTIFICATION_CHANNEL_SLACK) {
    return {
      channel,
      slackSecretName: StrictEnvResolver.resolve(SLACK_SECRET_NAME_ENV, StrictEnvType.String, { trim: true }),
    };
  }
  if (channel === NOTIFICATION_CHANNEL_SNS) {
    return {
      channel,
      topicArn: StrictEnvResolver.resolve(NOTIFICATION_TOPIC_ARN_ENV, StrictEnvType.String, { trim: true }),
    };
  }

  return {
    channel: NOTIFICATION_CHANNEL_EVENT_BRIDGE,
    eventBusName: StrictEnvResolver.resolve(NOTIFICATION_EVENT_BUS_NAME_ENV, StrictEnvType.String, { trim: true }),
  };
};
