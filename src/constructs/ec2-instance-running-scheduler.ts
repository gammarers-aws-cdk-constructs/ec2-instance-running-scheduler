import { Duration, RemovalPolicy, TimeZone } from 'aws-cdk-lib';
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
import { DEFAULT_RESOURCE_WAIT_LIMITS } from '../funcs/running-scheduler-predicates';
import {
  PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV,
  PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV,
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
   * Optional CloudWatch alarms and log-based metrics for failure detection.
   *
   * Set `enabled: true` to create alarms; optionally pass `alarmTopic` for SNS notifications.
   *
   * @default disabled when omitted
   */
  readonly failureDetection?: FailureDetectionAlarms;
}

/**
 * Provisions EventBridge Scheduler rules and a Durable Execution Lambda that start/stop tagged EC2 instances.
 *
 * Each schedule invokes the function with `Params` (`TagKey`, `TagValues`, `Mode`). The function uses
 * the Resource Groups Tagging API and EC2 APIs; Slack notifications use the secret named in {@link Secrets.slackSecretName}.
 *
 * Per-instance wait timeouts are configured via {@link EC2InstanceRunningSchedulerProps.resourceWait}
 * and enforced in the handler before the Durable execution timeout. Optional CloudWatch failure
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
   *   {@link ResourceWaitLimits}, and optional {@link FailureDetectionAlarms}.
   */
  constructor(scope: Construct, id: string, props: EC2InstanceRunningSchedulerProps) {
    super(scope, id);

    const slackSecret = Secret.fromSecretNameV2(this, 'SlackSecret', props.secrets.slackSecretName);

    // Durable Functions-based Running Scheduler (previous Step Functions logic implemented in Lambda).
    // Durable Execution requires Node.js 22+.
    const runningScheduleFunctionLogGroup = new logs.LogGroup(this, 'RunningSchedulerFunctionLogGroup', {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const runningScheduleFunction = new RunningSchedulerFunction(this, 'RunningSchedulerFunction', {
      description: 'Starts and stops tagged EC2 instances on EventBridge Scheduler schedules.',
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.minutes(15),
      memorySize: 512,
      retryAttempts: 2,
      durableConfig: {
        executionTimeout: Duration.hours(2),
        retentionPeriod: Duration.days(1),
      },
      environment: {
        SLACK_SECRET_NAME: props.secrets.slackSecretName,
        [PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV]: String(
          props.resourceWait?.maxLoopCount ?? DEFAULT_RESOURCE_WAIT_LIMITS.maxLoopCount,
        ),
        [PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV]: String(
          props.resourceWait?.maxElapsedSeconds ?? DEFAULT_RESOURCE_WAIT_LIMITS.maxElapsedSeconds,
        ),
      },
      paramsAndSecrets: lambda.ParamsAndSecretsLayerVersion.fromVersion(lambda.ParamsAndSecretsVersions.V1_0_103, {
        cacheSize: 500,
        logLevel: lambda.ParamsAndSecretsLogLevel.INFO,
      }),
      role: new iam.Role(this, 'RunningSchedulerFunctionRole', {
        description: 'Allows the running scheduler to describe, start, and stop EC2 instances and read Slack secrets.',
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
      resources: ['*'],
    }));
    // EC2: describe instances and start/stop by instance id
    runningScheduleFunction.addToRolePolicy(new iam.PolicyStatement({
      sid: 'Ec2RunningControl',
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:DescribeInstances',
        'ec2:StartInstances',
        'ec2:StopInstances',
      ],
      resources: ['*'],
    }));
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
