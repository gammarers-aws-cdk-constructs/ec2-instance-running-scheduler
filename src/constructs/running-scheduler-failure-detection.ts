import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

const METRIC_NAMESPACE = 'EC2InstanceRunningScheduler';

/**
 * Optional CloudWatch alarms and log-based metrics for operational failure detection.
 *
 * When {@link FailureDetectionAlarms.enabled} is true, the construct creates alarms for Lambda
 * errors, Durable handler failures, EC2 instance status wait failures, and Slack post failures.
 * Alarms can optionally notify an SNS topic supplied by the caller.
 */
export interface FailureDetectionAlarms {
  /**
   * When true, creates failure detection alarms and log-based metrics.
   *
   * @default false when omitted
   */
  readonly enabled?: boolean;
  /**
   * SNS topic for alarm notifications.
   *
   * When omitted, alarms are created without SNS actions.
   */
  readonly alarmTopic?: sns.ITopic;
}

/**
 * Props for {@link RunningSchedulerFailureDetection}.
 */
export interface RunningSchedulerFailureDetectionProps {
  /** Alarm configuration (must have {@link FailureDetectionAlarms.enabled} true). */
  readonly failureDetection: FailureDetectionAlarms;
  /** Running scheduler Lambda to monitor. */
  readonly runningScheduleFunction: lambda.IFunction;
  /** Application log group for the running scheduler Lambda. */
  readonly logGroup: logs.ILogGroup;
}

const isFailureDetectionEnabled = (failureDetection: FailureDetectionAlarms): boolean =>
  failureDetection.enabled === true;

const attachAlarmActions = (alarm: cloudwatch.Alarm, alarmTopic?: sns.ITopic): void => {
  if (!alarmTopic) {
    return;
  }

  alarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));
};

const createLogSumAlarm = (
  scope: Construct,
  id: string,
  props: {
    metric: cloudwatch.IMetric;
    alarmTopic?: sns.ITopic;
  },
): cloudwatch.Alarm => {
  const alarm = new cloudwatch.Alarm(scope, id, {
    metric: props.metric,
    threshold: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  } as cloudwatch.AlarmProps);
  attachAlarmActions(alarm, props.alarmTopic);
  return alarm;
};

/**
 * CloudWatch alarms and log-based metrics for the running scheduler Lambda.
 *
 * Covers Lambda invocation errors, Durable handler failures (excluding per-instance waiting),
 * EC2 stable-state wait failures (`ResourceWaitFailed:*`), and Slack API post failures.
 */
export class RunningSchedulerFailureDetection extends Construct {
  /** SNS topic used for alarm actions, when configured. */
  public readonly alarmTopic?: sns.ITopic;
  /** Fires when the Lambda `Errors` metric is non-zero. */
  public readonly lambdaErrorsAlarm: cloudwatch.Alarm;
  /** Fires on handler-level ERROR logs outside instance waiting and Slack post failures. */
  public readonly durableExecutionFailureAlarm: cloudwatch.Alarm;
  /** Fires when instance stable-state waiting fails (`ResourceWaitFailed:*`). */
  public readonly instanceStatusFailureAlarm: cloudwatch.Alarm;
  /** Fires when Slack `chat.postMessage` fails. */
  public readonly slackPostFailureAlarm: cloudwatch.Alarm;

  /**
   * @param scope - Parent construct.
   * @param id - Construct id.
   * @param props - Lambda, log group, and alarm options.
   */
  constructor(scope: Construct, id: string, props: RunningSchedulerFailureDetectionProps) {
    super(scope, id);

    const alarmTopic = props.failureDetection.alarmTopic;
    this.alarmTopic = alarmTopic;

    this.lambdaErrorsAlarm = createLogSumAlarm(this, 'LambdaErrorsAlarm', {
      metric: props.runningScheduleFunction.metricErrors({
        period: Duration.minutes(5),
        statistic: 'Sum',
      }),
      alarmTopic,
    });

    const instanceStatusFailureMetric = new logs.MetricFilter(this, 'InstanceStatusFailureMetric', {
      logGroup: props.logGroup,
      filterPattern: logs.FilterPattern.literal('"ResourceWaitFailed"'),
      metricNamespace: METRIC_NAMESPACE,
      metricName: 'InstanceStatusFailure',
      metricValue: '1',
      defaultValue: 0,
    });
    this.instanceStatusFailureAlarm = createLogSumAlarm(this, 'InstanceStatusFailureAlarm', {
      metric: instanceStatusFailureMetric.metric({
        period: Duration.minutes(5),
        statistic: 'Sum',
      }),
      alarmTopic,
    });

    const slackPostFailureMetric = new logs.MetricFilter(this, 'SlackPostFailureMetric', {
      logGroup: props.logGroup,
      filterPattern: logs.FilterPattern.literal('"running-scheduler: Slack post failed"'),
      metricNamespace: METRIC_NAMESPACE,
      metricName: 'SlackPostFailure',
      metricValue: '1',
      defaultValue: 0,
    });
    this.slackPostFailureAlarm = createLogSumAlarm(this, 'SlackPostFailureAlarm', {
      metric: slackPostFailureMetric.metric({
        period: Duration.minutes(5),
        statistic: 'Sum',
      }),
      alarmTopic,
    });

    const durableExecutionFailureMetric = new logs.MetricFilter(this, 'DurableExecutionFailureMetric', {
      logGroup: props.logGroup,
      filterPattern: logs.FilterPattern.literal('"ERROR" - "processOneResource" - "ResourceWaitFailed" - "running-scheduler: Slack post failed"'),
      metricNamespace: METRIC_NAMESPACE,
      metricName: 'DurableExecutionFailure',
      metricValue: '1',
      defaultValue: 0,
    });
    this.durableExecutionFailureAlarm = createLogSumAlarm(this, 'DurableExecutionFailureAlarm', {
      metric: durableExecutionFailureMetric.metric({
        period: Duration.minutes(5),
        statistic: 'Sum',
      }),
      alarmTopic,
    });
  }
}

/**
 * Creates failure detection alarms when enabled in props.
 *
 * @param scope - Parent construct.
 * @param id - Construct id.
 * @param props - Lambda, log group, and optional alarm configuration.
 * @returns Failure detection construct, or undefined when disabled.
 */
export const createRunningSchedulerFailureDetection = (
  scope: Construct,
  id: string,
  props: {
    readonly failureDetection?: FailureDetectionAlarms;
    readonly runningScheduleFunction: lambda.IFunction;
    readonly logGroup: logs.ILogGroup;
  },
): RunningSchedulerFailureDetection | undefined => {
  if (!props.failureDetection || !isFailureDetectionEnabled(props.failureDetection)) {
    return undefined;
  }

  return new RunningSchedulerFailureDetection(scope, id, {
    failureDetection: props.failureDetection,
    runningScheduleFunction: props.runningScheduleFunction,
    logGroup: props.logGroup,
  });
};
