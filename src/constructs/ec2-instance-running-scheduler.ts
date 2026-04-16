import { Duration, RemovalPolicy, TimeZone } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { RunningSchedulerFunction } from '../funcs/running-scheduler-function';

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
}

/**
 * Provisions EventBridge Scheduler rules and a Durable Execution Lambda that start/stop tagged EC2 instances.
 *
 * Each schedule invokes the function with `Params` (`TagKey`, `TagValues`, `Mode`). The function uses
 * the Resource Groups Tagging API and EC2 APIs; Slack notifications use the secret named in {@link Secrets.slackSecretName}.
 */
export class EC2InstanceRunningScheduler extends Construct {
  /**
   * Defines IAM, logging, two cron schedules (start/stop), and the bundled running-scheduler Lambda (Node.js, Durable Execution).
   *
   * @param scope - Parent construct.
   * @param id - Construct id.
   * @param props - Target tags, optional cron overrides, Slack secret name, and schedule enable flag.
   */
  constructor(scope: Construct, id: string, props: EC2InstanceRunningSchedulerProps) {
    super(scope, id);

    const slackSecret = Secret.fromSecretNameV2(this, 'SlackSecret', props.secrets.slackSecretName);

    // Durable Functions-based Running Scheduler (previous Step Functions logic implemented in Lambda).
    // Durable Execution requires Node.js 22+.
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
      logGroup: new logs.LogGroup(this, 'RunningSchedulerFunctionLogGroup', {
        retention: logs.RetentionDays.THREE_MONTHS,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
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
