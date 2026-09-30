import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import type { LogFailureFilter } from './log-failure-filter';

/**
 * Alarm created for one {@link LogFailureFilter}.
 */
export interface LogFailureAlarm {
  /** Same as {@link LogFailureFilter.id}. */
  readonly id: string;
  /** Alarm on the log metric filter sum. */
  readonly alarm: cloudwatch.Alarm;
}

/**
 * Props for {@link LambdaFailureDetector}.
 */
export interface LambdaFailureDetectorProps {
  /** Lambda function whose platform `Errors` metric is alarmed. */
  readonly lambdaFunction: lambda.IFunction;
  /** Log group used for {@link LogFailureFilter} metric filters. */
  readonly logGroup: logs.ILogGroup;
  /**
   * Optional SNS topic for all alarm actions.
   *
   * When omitted, alarms are created without SNS actions.
   */
  readonly alarmTopic?: sns.ITopic;
  /**
   * Log-based failure filters. Each entry creates a metric filter and alarm.
   *
   * @default no log-based alarms
   */
  readonly logFilters?: LogFailureFilter[];
}

/**
 * Registers an SNS alarm action when a topic is configured.
 */
const attachAlarmActions = (alarm: cloudwatch.Alarm, alarmTopic?: sns.ITopic): void => {
  if (!alarmTopic) {
    return;
  }

  alarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));
};

/**
 * Creates a CloudWatch alarm that fires when a sum metric is greater than or equal to 1.
 *
 * Uses `treatMissingData: notBreaching` so scheduled invocations do not alarm between runs.
 */
const createSumAlarm = (
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
 * CloudWatch failure detection for a Lambda function.
 *
 * Always creates a platform `AWS/Lambda` `Errors` alarm. Optionally creates one
 * metric filter + alarm per {@link LogFailureFilter}. Does not create an SNS topic;
 * pass {@link LambdaFailureDetectorProps.alarmTopic} to attach notifications.
 */
export class LambdaFailureDetector extends Construct {
  /** SNS topic used for alarm actions, when configured. */
  public readonly alarmTopic?: sns.ITopic;
  /** Fires when the Lambda `Errors` metric is non-zero. */
  public readonly lambdaErrorsAlarm: cloudwatch.Alarm;
  /**
   * Alarms for each log filter, in the same order as
   * {@link LambdaFailureDetectorProps.logFilters}.
   */
  public readonly logFilterAlarms: LogFailureAlarm[];

  /**
   * @param scope - Parent construct.
   * @param id - Construct id.
   * @param props - Lambda, log group, optional topic, and log filters.
   */
  constructor(scope: Construct, id: string, props: LambdaFailureDetectorProps) {
    super(scope, id);

    const alarmTopic = props.alarmTopic;
    this.alarmTopic = alarmTopic;

    this.lambdaErrorsAlarm = createSumAlarm(this, 'LambdaErrorsAlarm', {
      metric: props.lambdaFunction.metricErrors({
        period: Duration.minutes(5),
        statistic: 'Sum',
      }),
      alarmTopic,
    });

    const logFilters = props.logFilters ?? [];
    this.logFilterAlarms = logFilters.map((filter) => {
      const metricFilter = new logs.MetricFilter(this, `${filter.id}Metric`, {
        logGroup: props.logGroup,
        filterPattern: logs.FilterPattern.literal(filter.filterPattern),
        metricNamespace: filter.metricNamespace,
        metricName: filter.metricName,
        metricValue: '1',
        defaultValue: 0,
      });
      const alarm = createSumAlarm(this, `${filter.id}Alarm`, {
        metric: metricFilter.metric({
          period: Duration.minutes(5),
          statistic: 'Sum',
        }),
        alarmTopic,
      });
      return { id: filter.id, alarm };
    });
  }

  /**
   * Returns the log-filter alarm for the given filter id, or undefined when missing.
   */
  public findLogFilterAlarm(id: string): cloudwatch.Alarm | undefined {
    return this.logFilterAlarms.find((entry) => entry.id === id)?.alarm;
  }
}
