import { ArnFormat, Duration, RemovalPolicy, Stack, TimeZone } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import {
  createRunningSchedulerFailureDetection,
  type FailureDetectionAlarms,
  type RunningSchedulerFailureDetection,
} from './running-scheduler-failure-detection';
import { RunningSchedulerFunction } from '../funcs/running-scheduler-function';
import {
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_RESOURCE_WAIT_LIMITS,
} from '../funcs/running-scheduler-predicates';
import {
  PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV,
  PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV,
  PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS_ENV,
  PROCESS_RESOURCES_MAX_CONCURRENCY_ENV,
} from '../funcs/running-scheduler-wait-config';

export type {
  FailureDetectionAlarms,
  RunningSchedulerFailureDetection,
  RunningSchedulerFailureDetectionProps,
} from './running-scheduler-failure-detection';

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
 * Secret identifiers required by the scheduler (e.g. Slack).
 */
export interface Secrets {
  /** Name of the Secrets Manager secret containing Slack token and channel. */
  readonly slackSecretName: string;
}

/**
 * CDK-side limits for per-instance stable-state waiting in the Durable Lambda handler.
 *
 * Optional fields map to {@link PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV} and
 * {@link PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV} on the running scheduler function.
 * Prevents abnormal or stuck transitions from running until the Durable execution timeout.
 *
 * @see {@link ResourceWaitLimits} in `running-scheduler-predicates.ts` for the handler-side required shape.
 */
export interface ResourceWaitLimits {
  /**
   * Maximum describe/wait loop iterations per instance.
   *
   * @default {@link DEFAULT_RESOURCE_WAIT_LIMITS.maxLoopCount} (90)
   */
  readonly maxLoopCount?: number;
  /**
   * Maximum wall-clock seconds spent waiting for a single instance to stabilize.
   *
   * @default {@link DEFAULT_RESOURCE_WAIT_LIMITS.maxElapsedSeconds} (1800, 30 minutes)
   */
  readonly maxElapsedSeconds?: number;
  /**
   * Seconds to wait between describe iterations after start/stop or while transitioning.
   *
   * Lower values detect state changes sooner; higher values reduce DescribeInstances calls.
   *
   * @default {@link DEFAULT_RESOURCE_WAIT_LIMITS.statusChangeWaitSeconds} (20)
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
   * @default RemovalPolicy.DESTROY
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
  /** Secrets (e.g. Slack) used for notifications. */
  readonly secrets: Secrets;
  /** Cron schedule for stopping instances. */
  readonly stopSchedule?: Schedule;
  /** Cron schedule for starting instances. */
  readonly startSchedule?: Schedule;
  /**
   * Per-instance wait limits for the running scheduler Lambda.
   *
   * @default {@link DEFAULT_RESOURCE_WAIT_LIMITS}
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
   * @default RetentionDays.THREE_MONTHS, RemovalPolicy.DESTROY
   */
  readonly logGroup?: RunningSchedulerLogGroupProps;
  /**
   * Optional CloudWatch alarms and log-based metrics for failure detection.
   *
   * Set `enabled: true` to create alarms; optionally pass `alarmTopic` for SNS notifications.
   *
   * @default disabled when omitted
   */
  readonly failureDetection?: FailureDetectionAlarms;
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
 * the Resource Groups Tagging API and EC2 APIs; Slack notifications use the secret named in {@link Secrets.slackSecretName}.
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
   * @param props - Target tags, schedules, Slack secret, schedule enable flag, optional
   *   {@link ResourceWaitLimits}, {@link RunningSchedulerRuntimeProps},
   *   {@link RunningSchedulerDurableProps}, {@link RunningSchedulerLogGroupProps},
   *   and optional {@link FailureDetectionAlarms}.
   */
  constructor(scope: Construct, id: string, props: EC2InstanceRunningSchedulerProps) {
    super(scope, id);

    assertTargetResourceForIam(props.targetResource);

    const slackSecret = Secret.fromSecretNameV2(this, 'SlackSecret', props.secrets.slackSecretName);

    const maxLoopCount = resolvePositiveInteger(
      'resourceWait.maxLoopCount',
      props.resourceWait?.maxLoopCount,
      DEFAULT_RESOURCE_WAIT_LIMITS.maxLoopCount,
    );
    const maxElapsedSeconds = resolvePositiveInteger(
      'resourceWait.maxElapsedSeconds',
      props.resourceWait?.maxElapsedSeconds,
      DEFAULT_RESOURCE_WAIT_LIMITS.maxElapsedSeconds,
    );
    const statusChangeWaitSeconds = resolvePositiveInteger(
      'resourceWait.statusChangeWaitSeconds',
      props.resourceWait?.statusChangeWaitSeconds,
      DEFAULT_RESOURCE_WAIT_LIMITS.statusChangeWaitSeconds,
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
      removalPolicy: props.logGroup?.removalPolicy ?? RemovalPolicy.DESTROY,
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
        SLACK_SECRET_NAME: props.secrets.slackSecretName,
        [PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV]: String(maxLoopCount),
        [PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV]: String(maxElapsedSeconds),
        [PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS_ENV]: String(statusChangeWaitSeconds),
        [PROCESS_RESOURCES_MAX_CONCURRENCY_ENV]: String(maxConcurrency),
      },
      paramsAndSecrets: lambda.ParamsAndSecretsLayerVersion.fromVersion(lambda.ParamsAndSecretsVersions.V1_0_103, {
        // Required by aws-lambda-secret-fetcher (extension HTTP API on localhost; port from PARAMETERS_SECRETS_EXTENSION_HTTP_PORT).
        cacheSize: 500,
        logLevel: lambda.ParamsAndSecretsLogLevel.INFO,
      }),
      role: new iam.Role(this, 'RunningSchedulerFunctionRole', {
        description: 'Allows the running scheduler to describe instances and start/stop tagged EC2 instances, and to read Slack secrets.',
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
    // Grant read access to the Slack secret
    slackSecret.grantRead(runningScheduleFunction);

    this.failureDetection = createRunningSchedulerFailureDetection(this, 'FailureDetection', {
      failureDetection: props.failureDetection,
      runningScheduleFunction,
      logGroup: runningScheduleFunctionLogGroup,
    });

    // See: https://docs.aws.amazon.com/lambda/latest/dg/durable-getting-started-iac.html
    const runningScheduleFunctionAlias = runningScheduleFunction.addAlias('live');

    // Whether schedules are enabled (default true unless explicitly disabled).
    const scheduleEnabled: boolean = (() => {
      if (props.enableScheduling === undefined || props.enableScheduling) {
        return true;
      } else {
        return false;
      }
    })();

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
