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
import { GetResourcesCommand, ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { WebClient } from '@slack/web-api';
import { secretFetcher } from 'aws-lambda-secret-fetcher';
import { SafeEnvGetter } from 'safe-env-getter';
import {
  formatResourceWaitFailure,
  getWaitAbortReason,
  isDesiredStableState,
  isTransitioningState,
  type ResourceWaitLimits,
} from './running-scheduler-predicates';
import { parseResourceWaitLimitsFromEnv } from './running-scheduler-wait-env';

/** Mapping of EC2 instance state to display name and emoji for Slack. */
const STATE_LIST = [
  { name: 'RUNNING', emoji: '😆', state: 'running' },
  { name: 'STOPPED', emoji: '😴', state: 'stopped' },
] as const;

/**
 * Seconds to wait between describe iterations after start/stop or while transitioning.
 *
 * Used with {@link processOneResource} durable `wait` calls between describe iterations.
 */
const STATUS_CHANGE_WAIT_SECONDS = 20;

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
 * Returns display name and emoji for an EC2 instance state.
 *
 * @param current - Current instance state (e.g. 'running', 'stopped').
 * @returns Display info or undefined if state is not in STATE_LIST.
 */
const getStateDisplay = (current: string): { emoji: string; name: string } | undefined => {
  const found = STATE_LIST.find((s) => s.state === current);
  return found ? { emoji: found.emoji, name: found.name } : undefined;
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
      const ec2 = new EC2Client({});
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
        const ec2 = new EC2Client({});
        await ec2.send(new StartInstancesCommand({ InstanceIds: [identifier] }));
      });
      ctx.logger.info('processOneResource: wait after start', {
        identifier,
        seconds: STATUS_CHANGE_WAIT_SECONDS,
      });
      await ctx.wait({ seconds: STATUS_CHANGE_WAIT_SECONDS });
      loopCount += 1;
      continue;
    }

    if (mode === 'Stop' && currentState === 'running') {
      ctx.logger.info('processOneResource: stopping instance', { identifier, loopCount });
      await ctx.step(`${stepPrefix}-stop-${loopCount}`, async () => {
        const ec2 = new EC2Client({});
        await ec2.send(new StopInstancesCommand({ InstanceIds: [identifier] }));
      });
      ctx.logger.info('processOneResource: wait after stop', {
        identifier,
        seconds: STATUS_CHANGE_WAIT_SECONDS,
      });
      await ctx.wait({ seconds: STATUS_CHANGE_WAIT_SECONDS });
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
          seconds: STATUS_CHANGE_WAIT_SECONDS,
        });
        await ctx.wait({ seconds: STATUS_CHANGE_WAIT_SECONDS });
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

/**
 * Durable Lambda entry point for the EC2 running scheduler.
 *
 * Resolves instances via Resource Groups Tagging API, runs {@link processOneResource} for each ARN
 * in parallel (bounded concurrency), posts a parent Slack message and per-instance thread replies,
 * and uses durable `step` / `wait` / `map` so the run can resume across suspensions.
 *
 * Reads per-instance wait limits from `PROCESS_RESOURCE_MAX_LOOP_COUNT` and
 * `PROCESS_RESOURCE_MAX_ELAPSED_SECONDS` via {@link parseResourceWaitLimitsFromEnv}.
 * Slack API failures are logged as `running-scheduler: Slack post failed` for CloudWatch log filters.
 *
 * @param event - Payload from EventBridge Scheduler; must include `Params.TagKey`, `Params.TagValues`, `Params.Mode`.
 * @param ctx - Root durable execution context.
 * @returns
 * - `{ status: 'TargetResourcesNotFound' }` when no instances match the tag filter.
 * - `{ status: 'Completed', processed, results }` when instances were handled (`results` entries match {@link processOneResource} return shape).
 * @throws {Error} If `Params` is invalid, wait env vars are invalid, `SLACK_SECRET_NAME` is unset,
 *   the Slack secret is incomplete, or instance processing fails (including `ResourceWaitFailed:*` errors).
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

  // safe get Secrets name from environment variable
  const slackSecretName = SafeEnvGetter.getEnv('SLACK_SECRET_NAME');

  const slackSecretValue = await ctx.step('fetch-slack-secret', async () => {
    ctx.logger.info('running-scheduler: fetching Slack secret', { secretName: slackSecretName });
    return secretFetcher.getSecretValue<SlackSecret>(slackSecretName);
  });

  ctx.logger.info('running-scheduler: Slack secret loaded');

  if (!slackSecretValue?.token || !slackSecretValue?.channel) {
    throw new Error('Slack secret must contain token and channel.');
  }

  const targetResources = await ctx.step('get-target-resources', async () => {
    const client = new ResourceGroupsTaggingAPIClient({});
    const result = await client.send(
      new GetResourcesCommand({
        ResourceTypeFilters: ['ec2:instance'],
        TagFilters: [{ Key: params.TagKey, Values: params.TagValues }],
      }),
    );
    const arns = (result.ResourceTagMappingList ?? [])
      .map((m: { ResourceARN?: string }) => m.ResourceARN)
      .filter((arn: string | undefined): arn is string => arn != null);
    ctx.logger.info('running-scheduler: get-target-resources done', { count: arns.length });
    return arns;
  });

  if (targetResources.length === 0) {
    ctx.logger.info('running-scheduler: no matching instances', { tagKey: params.TagKey });
    return { status: 'TargetResourcesNotFound' as const };
  }

  const client = new WebClient(slackSecretValue.token);
  const channel = slackSecretValue.channel;

  ctx.logger.info('running-scheduler: posting parent Slack message', {
    instanceCount: targetResources.length,
  });

  // send slack message
  const slackParentMessageResult = await ctx.step('post-slack-messages', async () => {
    try {
      return await client.chat.postMessage({
        channel,
        text: `${params.Mode === 'Start' ? '😆 Starts' : '🥱 Stops'} the scheduled EC2 Instance.`,
      });
    } catch (error: unknown) {
      ctx.logger.error('running-scheduler: Slack post failed', {
        step: 'post-slack-messages',
        channel,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });

  ctx.logger.info('running-scheduler: parent Slack message posted', {
    threadTs: slackParentMessageResult?.ts ?? null,
  });

  ctx.logger.info('running-scheduler: starting parallel instance processing', {
    count: targetResources.length,
    maxConcurrency: 10,
  });

  const results = await ctx.map(
    targetResources,
    // async (ctx: DurableContext, targetResource: string, index: number) =>
    //   ctx.step(`process-resource-${index}`, async () =>
    //     processOneResource(ctx, targetResource, params, index),
    //   ),
    async (mapCtx: DurableContext, targetResource: string, index: number) => {
      return mapCtx.runInChildContext(`resource-${index}`, async (childCtx: DurableContext) => {
        const result = await processOneResource(childCtx, targetResource, params, index, waitLimits);
        // if (result.status === 'skipped') {
        //   return result;
        // }
        childCtx.logger.info('running-scheduler: posting thread Slack message', {
          index,
          identifier: result.identifier,
          status: result.status,
        });
        // send slack thread message
        await childCtx.step('post-slack-child-messages', async () => {
          const display = getStateDisplay(result.status);

          try {
            return await client.chat.postMessage({
              channel,
              thread_ts: slackParentMessageResult?.ts,
              attachments: [
                {
                  color: '#36a64f',
                  pretext: `${display?.emoji} The status of the EC2 Instance ${result.identifier} changed to ${display?.name} due to the schedule.`,
                  fields: [
                    { title: 'Account', value: result.account, short: true },
                    { title: 'Region', value: result.region, short: true },
                    { title: 'Identifier', value: result.identifier, short: true },
                    { title: 'Status', value: (display?.name ?? 'Unknown'), short: true },
                  ],
                },
              ],
            });
          } catch (error: unknown) {
            childCtx.logger.error('running-scheduler: Slack post failed', {
              step: 'post-slack-child-messages',
              channel,
              identifier: result.identifier,
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        });
        return result;
      });
    },
    { maxConcurrency: 10 },
  );

  const resultList = Array.isArray(results) ? results : [];
  ctx.logger.info('running-scheduler: completed', {
    processed: targetResources.length,
    resultCount: resultList.length,
  });
  return {
    status: 'Completed' as const,
    processed: targetResources.length,
    results: resultList,
  };
});
