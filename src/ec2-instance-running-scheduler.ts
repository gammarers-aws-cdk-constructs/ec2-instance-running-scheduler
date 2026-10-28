import { ArnFormat, Duration, RemovalPolicy, Stack, TimeZone } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { RunningSchedulerFunction } from './funcs/running-scheduler-function';
import {
  createRunningSchedulerFailureDetection,
  type RunningSchedulerFailureDetection,
  type RunningSchedulerFailureDetectionProps,
} from './running-scheduler-failure-detection';
import {
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_MAX_ELAPSED_SECONDS,
  DEFAULT_MAX_LOOP_COUNT,
  DEFAULT_STATUS_CHANGE_WAIT_SECONDS,
  NOTIFICATION_CHANNEL_ENV,
  NOTIFICATION_CHANNEL_EVENT_BRIDGE,
  NOTIFICATION_CHANNEL_LOGS,
  NOTIFICATION_CHANNEL_SLACK,
  NOTIFICATION_CHANNEL_SNS,
  NOTIFICATION_EVENT_BUS_NAME_ENV,
  NOTIFICATION_TOPIC_ARN_ENV,
  PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV,
  PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV,
  PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS_ENV,
  PROCESS_RESOURCES_MAX_CONCURRENCY_ENV,
  SLACK_SECRET_NAME_ENV,
} from './settings/consts';

/**
 * Cron-style schedule configuration for start/stop actions.
 */
export interface Schedule {
  /** Time zone for the schedule (e.g. ETC_UTC). */
  readonly timezone: TimeZone;
  /** Cron minute (0–59). */
  readonly minute?: string;
  /** Cron hour (0–23). */
  readonly hour?: string;
  /** Cron day of week (e.g. MON-FRI). */
  readonly week?: string;
}

/**
 * Defines which EC2 instances are targeted by tag key and values.
 *
 * Instances must already have this tag. IAM allows `ec2:StartInstances` /
 * `ec2:StopInstances` only on instances in the stack account and region whose
 * `aws:ResourceTag/<tagKey>` matches one of {@link TargetResource.tagValues}.
 */
export interface TargetResource {
  /** Tag key used to select instances (e.g. Schedule). */
  readonly tagKey: string;
  /** Tag values that match instances to include. */
  readonly tagValues: string[];
}

/**
 * Slack notification. The construct grants secret read and attaches the Parameters and Secrets extension.
 *
 * The secret JSON must contain non-empty `token` and `channel` strings.
 */
export interface SlackNotification {
  /** Selects Slack. */
  readonly channel: typeof NOTIFICATION_CHANNEL_SLACK;
  /** Name of the Secrets Manager secret containing Slack `token` and `channel`. */
  readonly slackSecretName: string;
}

/**
 * Amazon SNS notification. The construct grants `sns:Publish` on {@link topic} and does not create the topic.
 *
 * Email subscriptions receive one plain-text message per run. HTML is not used.
 */
export interface SnsNotification {
  /** Selects Amazon SNS. */
  readonly channel: typeof NOTIFICATION_CHANNEL_SNS;
  /** Existing topic. Attach an email subscription on this topic to deliver mail. */
  readonly topic: sns.ITopic;
}

/**
 * EventBridge custom-bus notification. The construct grants `events:PutEvents` and does not create the bus or rules.
 */
export interface EventBridgeNotification {
  /** Selects an EventBridge custom bus. */
  readonly channel: typeof NOTIFICATION_CHANNEL_EVENT_BRIDGE;
  /** Existing custom event bus. */
  readonly eventBus: events.IEventBus;
}

/**
 * Where a completed run is reported.
 *
 * Omit {@link EC2InstanceRunningSchedulerProps.notification} to log the same text and send nothing else.
 * Only one channel is accepted.
 */
export type RunningSchedulerNotification = SlackNotification | SnsNotification | EventBridgeNotification;

/**
 * CDK-side limits for per-instance stable-state waiting in the Durable Lambda handler.
 *
 * Optional fields map to {@link PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV} and
 * {@link PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV} on the running scheduler function.
 * Prevents abnormal or stuck transitions from running until the Durable execution timeout.
 *
 * The handler reads the same numbers from its environment and applies them as required limits.
 */
export interface ResourceWaitLimits {
  /**
   * Maximum describe/wait loop iterations per instance.
   *
   * @default {@link DEFAULT_MAX_LOOP_COUNT} (90)
   */
  readonly maxLoopCount?: number;
  /**
   * Maximum wall-clock seconds spent waiting for a single instance to stabilize.
   *
   * @default {@link DEFAULT_MAX_ELAPSED_SECONDS} (1800, 30 minutes)
   */
  readonly maxElapsedSeconds?: number;
  /**
   * Seconds to wait between describe iterations after start/stop or while transitioning.
   *
   * Lower values detect state changes sooner; higher values reduce DescribeInstances calls.
   *
   * @default {@link DEFAULT_STATUS_CHANGE_WAIT_SECONDS} (20)
   */
  readonly statusChangeWaitSeconds?: number;
}

/**
 * Lambda invoke settings and bounded parallelism for the running scheduler function.
 *
 * Increase {@link memorySize} and {@link maxConcurrency} when a single invocation targets
 * many instances or regions.
 */
export interface RunningSchedulerRuntimeProps {
  /**
   * Memory allocated to the running scheduler Lambda, in MB.
   *
   * @default 512
   */
  readonly memorySize?: number;
  /**
   * Invoke timeout for the Lambda function (not the durable execution timeout).
   *
   * AWS Lambda's maximum invoke timeout is 15 minutes. Durable waits can continue
   * beyond this via {@link RunningSchedulerDurableProps.executionTimeout}.
   *
   * @default Duration.minutes(15)
   */
  readonly timeout?: Duration;
  /**
   * Maximum number of instances processed in parallel by the durable `map`.
   *
   * @default {@link DEFAULT_MAX_CONCURRENCY} (10)
   */
  readonly maxConcurrency?: number;
}

/**
 * Durable Execution timeout and history retention for the running scheduler Lambda.
 */
export interface RunningSchedulerDurableProps {
  /**
   * Maximum duration of a durable execution.
   *
   * Increase when many instances are processed with long per-instance waits.
   *
   * @default Duration.hours(2)
   */
  readonly executionTimeout?: Duration;
  /**
   * How long to retain durable execution history.
   *
   * @default Duration.days(1)
   */
  readonly retentionPeriod?: Duration;
}

/**
 * CloudWatch Logs settings for the running scheduler function log group.
 */
export interface RunningSchedulerLogGroupProps {
  /**
   * How long to retain application logs.
   *
   * @default RetentionDays.THREE_MONTHS
   */
  readonly retention?: logs.RetentionDays;
  /**
   * Removal policy for the log group.
   *
   * A failed create deletes the log group. After a successful create, stack
   * deletion and replacement keep the logs.
   *
   * @default RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE
   */
  readonly removalPolicy?: RemovalPolicy;
}

/**
 * Properties for creating an EC2 instance running scheduler.
 */
export interface EC2InstanceRunningSchedulerProps {
  /** Tag-based targeting for EC2 instances to start/stop. */
  readonly targetResource: TargetResource;
  /** Whether EventBridge Scheduler rules are enabled. Defaults to true if omitted. */
  readonly enableScheduling?: boolean;
  /**
   * Where to report a completed run.
   *
   * @default logs only (no Slack, SNS, or EventBridge permissions)
   */
  readonly notification?: RunningSchedulerNotification;
  /** Cron schedule for stopping instances. */
  readonly stopSchedule?: Schedule;
  /** Cron schedule for starting instances. */
  readonly startSchedule?: Schedule;
  /**
   * Per-instance wait limits for the running scheduler Lambda.
   *
   * @default {@link DEFAULT_MAX_LOOP_COUNT}, {@link DEFAULT_MAX_ELAPSED_SECONDS}, {@link DEFAULT_STATUS_CHANGE_WAIT_SECONDS}
   */
  readonly resourceWait?: ResourceWaitLimits;
  /**
   * Lambda memory, invoke timeout, and per-invocation instance concurrency.
   *
   * @default 512 MB, 15 minutes, {@link DEFAULT_MAX_CONCURRENCY} (10)
   */
  readonly runtime?: RunningSchedulerRuntimeProps;
  /**
   * Durable Execution timeout and history retention.
   *
   * @default executionTimeout 2 hours, retentionPeriod 1 day
   */
  readonly durable?: RunningSchedulerDurableProps;
  /**
   * CloudWatch Logs retention and removal policy for the function log group.
   *
   * @default RetentionDays.THREE_MONTHS, RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE
   */
  readonly logGroup?: RunningSchedulerLogGroupProps;
  /**
   * Optional CloudWatch alarms and log-based metrics for failure detection.
   *
   * Set `enabled: true` to create alarms; optionally pass `alarmTopic` for SNS notifications.
   *
   * @default disabled when omitted
   */
  readonly failureDetection?: RunningSchedulerFailureDetectionProps;
}

const DEFAULT_LAMBDA_MEMORY_SIZE = 512;
const DEFAULT_LAMBDA_TIMEOUT = Duration.minutes(15);
const DEFAULT_DURABLE_EXECUTION_TIMEOUT = Duration.hours(2);
const DEFAULT_DURABLE_RETENTION_PERIOD = Duration.days(1);

/**
 * Returns `value` when set, otherwise `defaultValue`.
 *
 * @param name - Property path used in the error message.
 * @param value - Optional positive integer from construct props.
 * @param defaultValue - Fallback when `value` is omitted.
 * @returns A positive integer.
 * @throws {Error} When `value` is set and is not a positive integer.
 */
const resolvePositiveInteger = (name: string, value: number | undefined, defaultValue: number): number => {
  if (value === undefined) {
    return defaultValue;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (got ${String(value)})`);
  }
  return value;
};

/**
 * Rejects a Slack channel whose secret name is blank.
 *
 * @param notification - Optional notification channel.
 * @throws {Error} When `notification.slackSecretName` is empty or whitespace.
 */
const assertNotification = (notification: RunningSchedulerNotification | undefined): void => {
  if (!notification || notification.channel !== NOTIFICATION_CHANNEL_SLACK) {
    return;
  }
  if (notification.slackSecretName.trim() !== '') {
    return;
  }
  throw new Error('notification.slackSecretName must be a non-empty string');
};

/**
 * Environment variables that select the notification channel at runtime.
 *
 * @param notification - Optional notification channel.
 * @returns Variables merged onto the running scheduler function.
 */
const notificationEnvironment = (
  notification: RunningSchedulerNotification | undefined,
): { [key: string]: string } => {
  if (!notification) {
    return { [NOTIFICATION_CHANNEL_ENV]: NOTIFICATION_CHANNEL_LOGS };
  }
  if (notification.channel === NOTIFICATION_CHANNEL_SLACK) {
    return {
      [NOTIFICATION_CHANNEL_ENV]: notification.channel,
      [SLACK_SECRET_NAME_ENV]: notification.slackSecretName,
    };
  }
  if (notification.channel === NOTIFICATION_CHANNEL_SNS) {
    return {
      [NOTIFICATION_CHANNEL_ENV]: notification.channel,
      [NOTIFICATION_TOPIC_ARN_ENV]: notification.topic.topicArn,
    };
  }
  return {
    [NOTIFICATION_CHANNEL_ENV]: notification.channel,
    [NOTIFICATION_EVENT_BUS_NAME_ENV]: notification.eventBus.eventBusName,
  };
};

/**
 * Ensures {@link TargetResource} can be used in IAM `aws:ResourceTag` conditions.
 *
 * @param targetResource - Tag key and values used to select EC2 instances.
 * @throws {Error} When `tagKey` is empty or `tagValues` is empty.
 */
const assertTargetResourceForIam = (targetResource: TargetResource): void => {
  if (targetResource.tagKey === '') {
    throw new Error('targetResource.tagKey must be a non-empty string');
  }
  if (targetResource.tagValues.length === 0) {
    throw new Error('targetResource.tagValues must contain at least one value');
  }
};

/**
 * IAM statement that allows start/stop only on EC2 instances in this account and region
 * whose tags match {@link TargetResource}.
 *
 * `tag:GetResources` and `ec2:DescribeInstances` cannot use resource-level ARNs or
 * resource-tag conditions (AWS API limitation). Start/stop are scoped instead so a
 * compromised function cannot start or stop untagged instances.
 *
 * @param scope - Construct used to resolve the stack ARN partition, region, and account.
 * @param targetResource - Tag key and values required on target instances.
 * @returns Policy statement for `ec2:StartInstances` and `ec2:StopInstances`.
 */
const taggedInstanceStartStopStatement = (
  scope: Construct,
  targetResource: TargetResource,
): iam.PolicyStatement => {
  const instanceArn = Stack.of(scope).formatArn({
    service: 'ec2',
    resource: 'instance',
    resourceName: '*',
    arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
  });

  return new iam.PolicyStatement({
    sid: 'Ec2StartStopTaggedInstances',
    effect: iam.Effect.ALLOW,
    actions: [
      'ec2:StartInstances',
      'ec2:StopInstances',
    ],
    resources: [instanceArn],
    conditions: {
      StringEquals: {
        [`aws:ResourceTag/${targetResource.tagKey}`]: targetResource.tagValues,
      },
    },
  });
};

/**
 * Provisions EventBridge Scheduler rules and a Durable Execution Lambda that start/stop tagged EC2 instances.
 *
 * Each schedule invokes the function with `Params` (`TagKey`, `TagValues`, `Mode`). The function uses
 * the Resource Groups Tagging API and EC2 APIs. Notification uses {@link EC2InstanceRunningSchedulerProps.notification}
 * (logs only when omitted).
 *
 * Per-instance wait timeouts are configured via {@link EC2InstanceRunningSchedulerProps.resourceWait}
 * and enforced in the handler before the Durable execution timeout. Lambda memory, invoke timeout,
 * and map concurrency are set via {@link EC2InstanceRunningSchedulerProps.runtime}; Durable
 * execution timeout and history retention via {@link EC2InstanceRunningSchedulerProps.durable};
 * log retention via {@link EC2InstanceRunningSchedulerProps.logGroup}. Start/stop IAM is limited
 * to instances tagged as {@link TargetResource}. Optional CloudWatch failure
 * detection is available via {@link EC2InstanceRunningSchedulerProps.failureDetection}.
 */
export class EC2InstanceRunningScheduler extends Construct {
  /** Failure detection alarms, when {@link EC2InstanceRunningSchedulerProps.failureDetection} is enabled. */
  public readonly failureDetection?: RunningSchedulerFailureDetection;

  /**
   * Defines IAM, logging, optional failure detection alarms, two cron schedules (start/stop),
   * and the bundled running-scheduler Lambda (Node.js, Durable Execution).
   *
   * @param scope - Parent construct.
   * @param id - Construct id.
   * @param props - Target tags, schedules, optional notification channel, schedule enable flag, optional
   *   {@link ResourceWaitLimits}, {@link RunningSchedulerRuntimeProps},
   *   {@link RunningSchedulerDurableProps}, {@link RunningSchedulerLogGroupProps},
   *   and optional {@link RunningSchedulerFailureDetectionProps}.
   */
  constructor(scope: Construct, id: string, props: EC2InstanceRunningSchedulerProps) {
    super(scope, id);

    assertTargetResourceForIam(props.targetResource);
    assertNotification(props.notification);

    const slackSecret = props.notification?.channel === NOTIFICATION_CHANNEL_SLACK
      ? Secret.fromSecretNameV2(this, 'SlackSecret', props.notification.slackSecretName)
      : undefined;

    const maxLoopCount = resolvePositiveInteger(
      'resourceWait.maxLoopCount',
      props.resourceWait?.maxLoopCount,
      DEFAULT_MAX_LOOP_COUNT,
    );
    const maxElapsedSeconds = resolvePositiveInteger(
      'resourceWait.maxElapsedSeconds',
      props.resourceWait?.maxElapsedSeconds,
      DEFAULT_MAX_ELAPSED_SECONDS,
    );
    const statusChangeWaitSeconds = resolvePositiveInteger(
      'resourceWait.statusChangeWaitSeconds',
      props.resourceWait?.statusChangeWaitSeconds,
      DEFAULT_STATUS_CHANGE_WAIT_SECONDS,
    );
    const maxConcurrency = resolvePositiveInteger(
      'runtime.maxConcurrency',
      props.runtime?.maxConcurrency,
      DEFAULT_MAX_CONCURRENCY,
    );
    const memorySize = resolvePositiveInteger(
      'runtime.memorySize',
      props.runtime?.memorySize,
      DEFAULT_LAMBDA_MEMORY_SIZE,
    );

    // Durable Functions-based Running Scheduler (previous Step Functions logic implemented in Lambda).
    // Durable Execution requires Node.js 22+.
    const runningScheduleFunctionLogGroup = new logs.LogGroup(this, 'RunningSchedulerFunctionLogGroup', {
      retention: props.logGroup?.retention ?? logs.RetentionDays.THREE_MONTHS,
      removalPolicy: props.logGroup?.removalPolicy ?? RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });

    const runningScheduleFunction = new RunningSchedulerFunction(this, 'RunningSchedulerFunction', {
      description: 'Starts and stops tagged EC2 instances on EventBridge Scheduler schedules.',
      architecture: lambda.Architecture.ARM_64,
      timeout: props.runtime?.timeout ?? DEFAULT_LAMBDA_TIMEOUT,
      memorySize,
      retryAttempts: 2,
      durableConfig: {
        executionTimeout: props.durable?.executionTimeout ?? DEFAULT_DURABLE_EXECUTION_TIMEOUT,
        retentionPeriod: props.durable?.retentionPeriod ?? DEFAULT_DURABLE_RETENTION_PERIOD,
      },
      environment: {
        ...notificationEnvironment(props.notification),
        [PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV]: String(maxLoopCount),
        [PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV]: String(maxElapsedSeconds),
        [PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS_ENV]: String(statusChangeWaitSeconds),
        [PROCESS_RESOURCES_MAX_CONCURRENCY_ENV]: String(maxConcurrency),
      },
      ...(slackSecret
        ? {
          paramsAndSecrets: lambda.ParamsAndSecretsLayerVersion.fromVersion(lambda.ParamsAndSecretsVersions.V1_0_103, {
            // Required by aws-lambda-secret-fetcher (extension HTTP API on localhost; port from PARAMETERS_SECRETS_EXTENSION_HTTP_PORT).
            cacheSize: 500,
            logLevel: lambda.ParamsAndSecretsLogLevel.INFO,
          }),
        }
        : {}),
      role: new iam.Role(this, 'RunningSchedulerFunctionRole', {
        description: 'Allows the running scheduler to describe instances, start/stop tagged EC2 instances, and send the configured notification.',
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicDurableExecutionRolePolicy'),
        ],
      }),
      logGroup: runningScheduleFunctionLogGroup,
      loggingFormat: lambda.LoggingFormat.JSON,
      systemLogLevelV2: lambda.SystemLogLevel.INFO,
      applicationLogLevelV2: lambda.ApplicationLogLevel.INFO,
    });
    runningScheduleFunction.addToRolePolicy(new iam.PolicyStatement({
      sid: 'GetResources',
      effect: iam.Effect.ALLOW,
      actions: [
        'tag:GetResources',
      ],
      // Resource Groups Tagging API does not support resource-level permissions.
      resources: ['*'],
    }));
    runningScheduleFunction.addToRolePolicy(new iam.PolicyStatement({
      sid: 'Ec2DescribeInstances',
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:DescribeInstances',
      ],
      // Describe* APIs do not support resource-level permissions or resource-tag conditions.
      resources: ['*'],
    }));
    runningScheduleFunction.addToRolePolicy(
      taggedInstanceStartStopStatement(this, props.targetResource),
    );
    if (slackSecret) {
      slackSecret.grantRead(runningScheduleFunction);
    }
    if (props.notification?.channel === NOTIFICATION_CHANNEL_SNS) {
      props.notification.topic.grantPublish(runningScheduleFunction);
    }
    if (props.notification?.channel === NOTIFICATION_CHANNEL_EVENT_BRIDGE) {
      props.notification.eventBus.grantPutEventsTo(runningScheduleFunction);
    }

    this.failureDetection = createRunningSchedulerFailureDetection(this, 'FailureDetection', {
      failureDetection: props.failureDetection,
      runningScheduleFunction,
      logGroup: runningScheduleFunctionLogGroup,
    });

    // See: https://docs.aws.amazon.com/lambda/latest/dg/durable-getting-started-iac.html
    const runningScheduleFunctionAlias = runningScheduleFunction.addAlias('live');

    // Schedules stay enabled unless the caller sets enableScheduling to false.
    const scheduleEnabled = props.enableScheduling !== false;

    // Durable Functions: Lambda performs tag lookup and instance start/stop in a single run.
    new scheduler.Schedule(this, 'RunningStartSchedule', {
      description: 'running start schedule',
      enabled: scheduleEnabled,
      schedule: scheduler.ScheduleExpression.cron({
        minute: props.startSchedule?.minute ?? '50',
        hour: props.startSchedule?.hour ?? '7',
        weekDay: props.startSchedule?.week ?? 'MON-FRI',
        timeZone: props.startSchedule?.timezone ?? TimeZone.ETC_UTC,
      }),
      target: new targets.LambdaInvoke(runningScheduleFunctionAlias, {
        input: scheduler.ScheduleTargetInput.fromObject({
          Params: {
            TagKey: props.targetResource.tagKey,
            TagValues: props.targetResource.tagValues,
            Mode: 'Start',
          },
        }),
      }),
    });

    new scheduler.Schedule(this, 'RunningStopSchedule', {
      description: 'running stop schedule',
      enabled: scheduleEnabled,
      schedule: scheduler.ScheduleExpression.cron({
        minute: props.stopSchedule?.minute ?? '5',
        hour: props.stopSchedule?.hour ?? '19',
        weekDay: props.stopSchedule?.week ?? 'MON-FRI',
        timeZone: props.stopSchedule?.timezone ?? TimeZone.ETC_UTC,
      }),
      target: new targets.LambdaInvoke(runningScheduleFunctionAlias, {
        input: scheduler.ScheduleTargetInput.fromObject({
          Params: {
            TagKey: props.targetResource.tagKey,
            TagValues: props.targetResource.tagValues,
            Mode: 'Stop',
          },
        }),
      }),
    });
  }
}
