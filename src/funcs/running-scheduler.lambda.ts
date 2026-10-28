/**
 * EC2 Running Scheduler – Durable Functions implementation.
 *
 * Implements the running-control flow using AWS Lambda Durable Execution.
 * Step checkpoints, wait (no charge), and parallel map provide a flow equivalent to Step Functions.
 *
 * @see https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-sdk.html
 */

import { withDurableExecution, type DurableContext } from '@aws/durable-execution-sdk-js';
import {
  EC2Client,
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
} from '@aws-sdk/client-ec2';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { GetResourcesCommand, ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { WebClient } from '@slack/web-api';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { secretFetcher, type GetSecretValueOptions } from 'aws-lambda-secret-fetcher';
import {
  buildNotificationEventDetail,
  formatNotificationText,
  instanceStatusDisplay,
  notificationSubject,
  type NotificationInstance,
} from './core/notification-message';
import {
  formatResourceWaitFailure,
  getWaitAbortReason,
  isDesiredStableState,
  isTransitioningState,
  type ResourceWaitLimits,
} from './running-scheduler-predicates';
import {
  parseMaxConcurrencyFromEnv,
  parseNotificationFromEnv,
  parseResourceWaitLimitsFromEnv,
  type ResolvedNotification,
} from './running-scheduler-wait-env';
import {
  NOTIFICATION_CHANNEL_EVENT_BRIDGE,
  NOTIFICATION_CHANNEL_LOGS,
  NOTIFICATION_CHANNEL_SLACK,
  NOTIFICATION_CHANNEL_SNS,
  NOTIFICATION_EVENT_DETAIL_TYPE,
  NOTIFICATION_EVENT_SOURCE,
  NOTIFICATION_POST_FAILED_LOG,
} from '../settings/consts';

/** Total SDK attempts per send, including the first call. Transient errors stay inside the SDK. */
const AWS_SDK_MAX_ATTEMPTS = 3;
/** TCP connect timeout for AWS SDK clients. */
const AWS_SDK_CONNECTION_TIMEOUT_MS = 5_000;
/** Per-attempt HTTP timeout for AWS SDK clients. */
const AWS_SDK_REQUEST_TIMEOUT_MS = 30_000;

/**
 * SDK client options. Region comes from the Lambda environment.
 *
 * @returns Attempts and HTTP timeouts for one client instance.
 */
const awsSdkClientConfig = (): {
  maxAttempts: number;
  requestHandler: NodeHttpHandler;
} => ({
  maxAttempts: AWS_SDK_MAX_ATTEMPTS,
  requestHandler: new NodeHttpHandler({
    connectionTimeout: AWS_SDK_CONNECTION_TIMEOUT_MS,
    requestTimeout: AWS_SDK_REQUEST_TIMEOUT_MS,
  }),
});

/**
 * Options passed to {@link secretFetcher.getSecretValue} when loading the Slack secret.
 *
 * Retries cover transient extension HTTP errors (5xx, 429) and the extension
 * "not ready to serve traffic" response during cold starts.
 */
const SLACK_SECRET_FETCH_OPTIONS: GetSecretValueOptions = {
  timeoutMs: 3000,
  retries: 5,
  baseBackoffMs: 300,
};

/**
 * Event payload from EventBridge Scheduler invoking this Lambda.
 *
 * @see {@link handler}
 */
export interface SchedulerEvent {
  /** Scheduler invocation parameters (tag filter and start/stop mode). */
  Params: {
    /** Tag key used to select EC2 instances. */
    TagKey: string;
    /** Tag values to match. */
    TagValues: string[];
    /** Whether to start or stop instances. */
    Mode: 'Start' | 'Stop';
  };
}

/** Slack credentials and default channel loaded from Secrets Manager (`SLACK_SECRET_NAME`). */
interface SlackSecret {
  /** Slack bot token for the Slack `WebClient`. */
  token: string;
  /** Channel ID or name passed to `chat.postMessage`. */
  channel: string;
}

/**
 * Whether a secret payload is a JSON object with non-empty Slack `token` and `channel`.
 *
 * `aws-lambda-secret-fetcher` ^0.8 parses JSON string secrets with quiet-json-parser
 * (invalid or empty JSON falls back to the original string) and returns binary secrets as
 * `Uint8Array`, which this guard rejects.
 *
 * @param value - Value returned by {@link secretFetcher.getSecretValue}.
 * @returns `true` when `value` is a {@link SlackSecret}.
 */
const isSlackSecret = (value: unknown): value is SlackSecret => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('token' in value) || !('channel' in value)) {
    return false;
  }
  if (typeof value.token !== 'string' || value.token === '') {
    return false;
  }
  if (typeof value.channel !== 'string' || value.channel === '') {
    return false;
  }
  return true;
};

/** Slack Web API client and channel loaded for this invocation. */
interface SlackClientBinding {
  /** Slack Web API client. */
  readonly client: WebClient;
  /** Channel passed to `chat.postMessage`. */
  readonly channel: string;
}

/**
 * Text of an unknown thrown value, without assuming it is an {@link Error}.
 *
 * @param error - Value caught from a notification send.
 * @returns A message safe to log. Does not include secrets.
 */
const errorText = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

/**
 * Processes one EC2 instance: describes state, issues start/stop when needed, then waits until
 * {@link isDesiredStableState} is satisfied (durable `step` / `wait` between attempts).
 *
 * Each loop iteration checks {@link getWaitAbortReason} before describe. Failures use
 * {@link formatResourceWaitFailure} (`ResourceWaitFailed:*` message prefix).
 *
 * @param ctx - Durable execution context (child context per instance recommended).
 * @param targetResource - EC2 instance ARN.
 * @param params - Scheduler params (`TagKey`, `TagValues`, `Mode`).
 * @param resourceIndex - Index used in durable step names for this resource.
 * @param waitLimits - Per-instance caps from {@link parseResourceWaitLimitsFromEnv} (set by the CDK construct).
 * @returns Final resource ARN, EC2 state name, parsed account, region, and instance id.
 * @throws {Error} When wait limits are exceeded (`MaxLoopCountExceeded`, `MaxElapsedTimeExceeded`),
 *   the instance is in an unexpected state (`UnexpectedInstanceState`), or the loop exits without a stable goal state.
 */
const processOneResource = async (
  ctx: DurableContext,
  targetResource: string,
  params: SchedulerEvent['Params'],
  resourceIndex: number,
  waitLimits: ResourceWaitLimits,
): Promise<{ resource: string; status: string; account: string; region: string; identifier: string }> => {
  const parts = targetResource.split('/');
  const identifier = parts[parts.length - 1] ?? 'unknown';
  const arnParts = targetResource.split(':');
  const account = arnParts[4] ?? '';
  const region = arnParts[3] ?? '';
  const stepPrefix = `resource-${resourceIndex}-${identifier}`;

  ctx.logger.info('processOneResource: start', {
    resourceIndex,
    identifier,
    region,
    account,
    mode: params.Mode,
    maxLoopCount: waitLimits.maxLoopCount,
    maxElapsedSeconds: waitLimits.maxElapsedSeconds,
    statusChangeWaitSeconds: waitLimits.statusChangeWaitSeconds,
  });

  const startedAtMs = await ctx.step(`${stepPrefix}-wait-started-at`, async () => Date.now());

  let loopCount = 0;
  let currentState = '';
  do {
    const abortReason = await ctx.step(`${stepPrefix}-wait-limit-check-${loopCount}`, async () =>
      getWaitAbortReason(loopCount, startedAtMs, Date.now(), waitLimits),
    );
    if (abortReason) {
      const message = formatResourceWaitFailure(abortReason, {
        identifier,
        mode: params.Mode,
        currentState: currentState || 'unknown',
        loopCount,
        limits: waitLimits,
      });
      ctx.logger.error('processOneResource: wait limit exceeded', {
        identifier,
        abortReason,
        loopCount,
        currentState,
        maxLoopCount: waitLimits.maxLoopCount,
        maxElapsedSeconds: waitLimits.maxElapsedSeconds,
      });
      throw new Error(message);
    }

    currentState = await ctx.step(`${stepPrefix}-describe-${loopCount}`, async () => {
      const ec2 = new EC2Client(awsSdkClientConfig());
      const out = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [identifier] }));
      return out.Reservations?.[0]?.Instances?.[0]?.State?.Name ?? 'unknown';
    });

    ctx.logger.info('processOneResource: described', {
      identifier,
      loopCount,
      currentState,
      mode: params.Mode,
    });

    const mode = params.Mode;

    if (mode === 'Start' && currentState === 'stopped') {
      ctx.logger.info('processOneResource: starting instance', { identifier, loopCount });
      await ctx.step(`${stepPrefix}-start-${loopCount}`, async () => {
        const ec2 = new EC2Client(awsSdkClientConfig());
        await ec2.send(new StartInstancesCommand({ InstanceIds: [identifier] }));
      });
      ctx.logger.info('processOneResource: wait after start', {
        identifier,
        seconds: waitLimits.statusChangeWaitSeconds,
      });
      await ctx.wait({ seconds: waitLimits.statusChangeWaitSeconds });
      loopCount += 1;
      continue;
    }

    if (mode === 'Stop' && currentState === 'running') {
      ctx.logger.info('processOneResource: stopping instance', { identifier, loopCount });
      await ctx.step(`${stepPrefix}-stop-${loopCount}`, async () => {
        const ec2 = new EC2Client(awsSdkClientConfig());
        await ec2.send(new StopInstancesCommand({ InstanceIds: [identifier] }));
      });
      ctx.logger.info('processOneResource: wait after stop', {
        identifier,
        seconds: waitLimits.statusChangeWaitSeconds,
      });
      await ctx.wait({ seconds: waitLimits.statusChangeWaitSeconds });
      loopCount += 1;
      continue;
    }

    if (!isDesiredStableState(mode, currentState)) {
      if (isTransitioningState(mode, currentState)) {
        ctx.logger.info('processOneResource: wait while transitioning', {
          identifier,
          loopCount,
          currentState,
          mode,
          seconds: waitLimits.statusChangeWaitSeconds,
        });
        await ctx.wait({ seconds: waitLimits.statusChangeWaitSeconds });
        loopCount += 1;
        continue;
      }

      const message = formatResourceWaitFailure('UnexpectedInstanceState', {
        identifier,
        mode,
        currentState,
        loopCount,
        limits: waitLimits,
      });
      ctx.logger.error('processOneResource: unexpected state', {
        identifier,
        mode,
        currentState,
        loopCount,
      });
      throw new Error(message);
    }
  } while (!isDesiredStableState(params.Mode, currentState));

  ctx.logger.info('processOneResource: reached desired stable state', {
    identifier,
    finalState: currentState,
    mode: params.Mode,
    loopCount,
  });

  return {
    identifier,
    account,
    region,
    resource: targetResource,
    status: currentState,
  };
};

/** One processed instance, including the ARN kept on the handler result. */
interface ProcessedInstance extends NotificationInstance {
  /** EC2 instance ARN. */
  readonly resource: string;
}

/**
 * Loads Slack credentials when that channel is selected.
 *
 * A secret that is not JSON with non-empty `token` and `channel` is a configuration error and throws.
 * Send failures later in the run are logged and do not throw.
 *
 * @param ctx - Root durable execution context.
 * @param notification - Channel resolved from the environment.
 * @returns Slack client, or `undefined` when the channel is not Slack.
 * @throws {Error} When the secret JSON is missing `token` or `channel`.
 */
const loadSlackClient = async (
  ctx: DurableContext,
  notification: ResolvedNotification,
): Promise<SlackClientBinding | undefined> => {
  if (notification.channel !== NOTIFICATION_CHANNEL_SLACK) {
    return undefined;
  }

  const slackSecretName = notification.slackSecretName;
  const slackSecretValue: unknown = await ctx.step('fetch-slack-secret', async () => {
    ctx.logger.info('running-scheduler: fetching Slack secret', { secretName: slackSecretName });
    return secretFetcher.getSecretValue(slackSecretName, SLACK_SECRET_FETCH_OPTIONS);
  });
  ctx.logger.info('running-scheduler: Slack secret loaded');
  if (!isSlackSecret(slackSecretValue)) {
    throw new Error('Slack secret must contain token and channel.');
  }

  return {
    client: new WebClient(slackSecretValue.token),
    channel: slackSecretValue.channel,
  };
};

/**
 * Logs a notification send failure for the CloudWatch metric filter.
 *
 * The instance start/stop result is left unchanged.
 *
 * @param ctx - Durable context whose logger receives the error line.
 * @param step - Durable step name.
 * @param channel - Notification channel that failed.
 * @param error - Failure from the send. Tokens are not logged.
 */
const logNotificationFailure = (
  ctx: DurableContext,
  step: string,
  channel: ResolvedNotification['channel'],
  error: unknown,
): void => {
  ctx.logger.error(NOTIFICATION_POST_FAILED_LOG, {
    step,
    notificationChannel: channel,
    errorMessage: errorText(error),
  });
};

/**
 * Posts the Slack parent message. A send failure is logged and returns no thread timestamp.
 *
 * @param ctx - Root durable execution context.
 * @param slack - Slack client and channel.
 * @param mode - Start or stop.
 * @returns Slack thread timestamp, or `undefined` when the post failed.
 */
const postSlackParent = async (
  ctx: DurableContext,
  slack: SlackClientBinding,
  mode: 'Start' | 'Stop',
): Promise<string | undefined> => {
  ctx.logger.info('running-scheduler: posting parent Slack message', { mode });
  const threadTs = await ctx.step('post-slack-messages', async () => {
    try {
      const posted = await slack.client.chat.postMessage({
        channel: slack.channel,
        text: notificationSubject(mode),
      });
      return posted.ts ?? '';
    } catch (error: unknown) {
      logNotificationFailure(ctx, 'post-slack-messages', NOTIFICATION_CHANNEL_SLACK, error);
      return '';
    }
  });
  if (threadTs === '') {
    return undefined;
  }
  ctx.logger.info('running-scheduler: parent Slack message posted', { threadTs });
  return threadTs;
};

/**
 * Posts one Slack thread reply for a finished instance.
 *
 * @param ctx - Child durable context for this instance.
 * @param slack - Slack client and channel.
 * @param threadTs - Parent thread timestamp. Omitted when the parent post failed.
 * @param instance - Finished instance.
 */
const postSlackThread = async (
  ctx: DurableContext,
  slack: SlackClientBinding,
  threadTs: string | undefined,
  instance: ProcessedInstance,
): Promise<void> => {
  const display = instanceStatusDisplay(instance.status);
  ctx.logger.info('running-scheduler: posting thread Slack message', {
    identifier: instance.identifier,
    status: instance.status,
  });
  await ctx.step('post-slack-child-messages', async () => {
    try {
      await slack.client.chat.postMessage({
        channel: slack.channel,
        ...(threadTs ? { thread_ts: threadTs } : {}),
        attachments: [
          {
            color: '#36a64f',
            pretext: `${display.emoji} The status of the EC2 Instance ${instance.identifier} changed to ${display.name} due to the schedule.`,
            fields: [
              { title: 'Account', value: instance.account, short: true },
              { title: 'Region', value: instance.region, short: true },
              { title: 'Identifier', value: instance.identifier, short: true },
              { title: 'Status', value: display.name, short: true },
            ],
          },
        ],
      });
    } catch (error: unknown) {
      logNotificationFailure(ctx, 'post-slack-child-messages', NOTIFICATION_CHANNEL_SLACK, error);
    }
  });
};

/**
 * Sends the plain-text summary for logs, SNS, or EventBridge.
 *
 * SNS is one publish after every instance finishes, because email subscriptions have no thread.
 * A send failure is logged inside the durable step and does not fail the run. SDK retries stay on the client.
 *
 * @param ctx - Root durable execution context.
 * @param notification - Channel resolved from the environment.
 * @param mode - Start or stop.
 * @param instances - Instances that finished processing.
 */
const publishSummary = async (
  ctx: DurableContext,
  notification: ResolvedNotification,
  mode: 'Start' | 'Stop',
  instances: readonly NotificationInstance[],
): Promise<void> => {
  if (notification.channel === NOTIFICATION_CHANNEL_SLACK) {
    return;
  }

  const text = formatNotificationText(mode, instances);
  if (notification.channel === NOTIFICATION_CHANNEL_LOGS) {
    await ctx.step('log-notification', async () => {
      ctx.logger.info('running-scheduler: notification', {
        notificationChannel: notification.channel,
        subject: text.subject,
        message: text.message,
      });
    });
    return;
  }
  if (notification.channel === NOTIFICATION_CHANNEL_SNS) {
    const topicArn = notification.topicArn;
    await ctx.step('publish-sns-notification', async () => {
      try {
        const sns = new SNSClient(awsSdkClientConfig());
        // Email subscriptions show Subject as the mail subject and Message as the plain-text body.
        await sns.send(new PublishCommand({
          TopicArn: topicArn,
          Subject: text.subject,
          Message: text.message,
        }));
      } catch (error: unknown) {
        logNotificationFailure(ctx, 'publish-sns-notification', NOTIFICATION_CHANNEL_SNS, error);
      }
    });
    return;
  }

  const eventBusName = notification.eventBusName;
  const detail = buildNotificationEventDetail(mode, instances);
  await ctx.step('put-notification-event', async () => {
    try {
      const events = new EventBridgeClient(awsSdkClientConfig());
      const sent = await events.send(new PutEventsCommand({
        Entries: [{
          EventBusName: eventBusName,
          Source: NOTIFICATION_EVENT_SOURCE,
          DetailType: NOTIFICATION_EVENT_DETAIL_TYPE,
          Detail: JSON.stringify(detail),
        }],
      }));
      const failedCount = sent.FailedEntryCount ?? 0;
      if (failedCount === 0) {
        return;
      }
      logNotificationFailure(
        ctx,
        'put-notification-event',
        NOTIFICATION_CHANNEL_EVENT_BRIDGE,
        new Error(sent.Entries?.[0]?.ErrorMessage ?? 'PutEvents entry failed'),
      );
    } catch (error: unknown) {
      logNotificationFailure(ctx, 'put-notification-event', NOTIFICATION_CHANNEL_EVENT_BRIDGE, error);
    }
  });
};

/**
 * Durable Lambda entry point for the EC2 running scheduler.
 *
 * Resolves instances via Resource Groups Tagging API, runs {@link processOneResource} for each ARN
 * in parallel (bounded concurrency), then reports the run on the configured notification channel.
 * Logs are the default. Slack posts a parent message and per-instance thread replies. SNS publishes
 * one plain-text message after processing. EventBridge publishes one event to the configured bus.
 * Durable `step` / `wait` / `map` let the run resume across suspensions.
 *
 * Reads per-instance wait limits from `PROCESS_RESOURCE_MAX_LOOP_COUNT`,
 * `PROCESS_RESOURCE_MAX_ELAPSED_SECONDS`, and `PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS`
 * via {@link parseResourceWaitLimitsFromEnv}, and map concurrency from
 * `PROCESS_RESOURCES_MAX_CONCURRENCY` via {@link parseMaxConcurrencyFromEnv}.
 * Slack loads its secret via {@link secretFetcher} (Parameters and Secrets Lambda Extension).
 * Notification send failures are logged as {@link NOTIFICATION_POST_FAILED_LOG} and do not fail the run.
 *
 * @param event - Payload from EventBridge Scheduler; must include `Params.TagKey`, `Params.TagValues`, `Params.Mode`.
 * @param ctx - Root durable execution context.
 * @returns
 * - `{ status: 'TargetResourcesNotFound' }` when no instances match the tag filter. Nothing is sent.
 * - `{ status: 'Completed', processed, results }` when instances were handled (`results` entries match {@link processOneResource} return shape).
 * @throws {Error} If `Params` is invalid, the Slack secret is incomplete or not JSON with `token` and `channel`,
 *   or instance processing fails (including `ResourceWaitFailed:*` errors).
 * @throws {import('strict-env-resolver').StrictEnvValidationError} When required env vars are missing or not positive integers.
 * @throws {import('fetch-retrier').FetchRetrierHttpError} When the extension returns a non-retriable HTTP error.
 * @throws {import('fetch-retrier').FetchRetrierNetworkError} When extension requests fail at the network level.
 * @throws {import('fetch-retrier').FetchRetrierAbortError} When extension requests time out after all retries.
 * @throws {import('fetch-retrier').FetchRetrierInvalidOptionsError} When secret-fetch retry options are invalid.
 */
export const handler = withDurableExecution(async (event: SchedulerEvent, ctx: DurableContext) => {
  const params = event.Params;

  ctx.logger.info('running-scheduler: invocation', {
    mode: params?.Mode,
    tagKey: params?.TagKey,
    tagValueCount: params?.TagValues?.length ?? 0,
  });

  if (!params?.TagKey || !params?.TagValues || !params?.Mode) {
    throw new Error('Invalid event: Params.TagKey, Params.TagValues, Params.Mode are required.');
  }

  const waitLimits = parseResourceWaitLimitsFromEnv();
  const maxConcurrency = parseMaxConcurrencyFromEnv();
  const notification = parseNotificationFromEnv();
  const slack = await loadSlackClient(ctx, notification);

  const targetResources = await ctx.step('get-target-resources', async () => {
    const client = new ResourceGroupsTaggingAPIClient(awsSdkClientConfig());
    const result = await client.send(
      new GetResourcesCommand({
        ResourceTypeFilters: ['ec2:instance'],
        TagFilters: [{ Key: params.TagKey, Values: params.TagValues }],
      }),
    );
    const arns = (result.ResourceTagMappingList ?? [])
      .map((mapping: { ResourceARN?: string }) => mapping.ResourceARN)
      .filter((arn: string | undefined): arn is string => arn != null);
    ctx.logger.info('running-scheduler: get-target-resources done', { count: arns.length });
    return arns;
  });

  if (targetResources.length === 0) {
    ctx.logger.info('running-scheduler: no matching instances', { tagKey: params.TagKey });
    return { status: 'TargetResourcesNotFound' as const };
  }

  const threadTs = slack ? await postSlackParent(ctx, slack, params.Mode) : undefined;

  ctx.logger.info('running-scheduler: starting parallel instance processing', {
    count: targetResources.length,
    maxConcurrency,
  });

  const results = await ctx.map(
    targetResources,
    async (mapCtx: DurableContext, targetResource: string, index: number): Promise<ProcessedInstance> => {
      return mapCtx.runInChildContext(`resource-${index}`, async (childCtx: DurableContext) => {
        const result = await processOneResource(childCtx, targetResource, params, index, waitLimits);
        if (!slack) {
          return result;
        }
        await postSlackThread(childCtx, slack, threadTs, result);
        return result;
      });
    },
    { maxConcurrency },
  );

  results.throwIfError();
  const resultList = results.getResults();
  await publishSummary(ctx, notification, params.Mode, resultList);

  ctx.logger.info('running-scheduler: completed', {
    processed: targetResources.length,
    resultCount: resultList.length,
    notificationChannel: notification.channel,
  });
  return {
    status: 'Completed' as const,
    processed: targetResources.length,
    results: resultList,
  };
});
