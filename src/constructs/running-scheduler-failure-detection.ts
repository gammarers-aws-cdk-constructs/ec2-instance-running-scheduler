import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import type { LambdaFailureDetection } from './lambda-failure-detector/lambda-failure-detection';
import { LambdaFailureDetector } from './lambda-failure-detector/lambda-failure-detector';
import type { LogFailureFilter } from './lambda-failure-detector/log-failure-filter';

/** CloudWatch custom metric namespace for running-scheduler log-based failure metrics. */
const METRIC_NAMESPACE = 'EC2InstanceRunningScheduler';

const INSTANCE_STATUS_FAILURE_ID = 'InstanceStatusFailure';
const SLACK_POST_FAILURE_ID = 'SlackPostFailure';
const DURABLE_EXECUTION_FAILURE_ID = 'DurableExecutionFailure';

/**
 * Log-based failure filters for the EC2 running scheduler Lambda.
 *
 * Defined in one place for this construct; passed into {@link LambdaFailureDetector}.
 */
const RUNNING_SCHEDULER_LOG_FILTERS: LogFailureFilter[] = [
  {
    id: INSTANCE_STATUS_FAILURE_ID,
    filterPattern: '"ResourceWaitFailed"',
    metricNamespace: METRIC_NAMESPACE,
    metricName: 'InstanceStatusFailure',
  },
  {
    id: SLACK_POST_FAILURE_ID,
    filterPattern: '"running-scheduler: Slack post failed"',
    metricNamespace: METRIC_NAMESPACE,
    metricName: 'SlackPostFailure',
  },
  {
    id: DURABLE_EXECUTION_FAILURE_ID,
    filterPattern: '"ERROR" - "processOneResource" - "ResourceWaitFailed" - "running-scheduler: Slack post failed"',
    metricNamespace: METRIC_NAMESPACE,
    metricName: 'DurableExecutionFailure',
  },
];

/**
 * Props accepted by {@link createRunningSchedulerFailureDetection}.
 */
interface CreateRunningSchedulerFailureDetectionProps {
  /** Failure detection options; alarms are created only when {@link RunningSchedulerFailureDetectionProps.enabled} is true. */
  readonly failureDetection?: RunningSchedulerFailureDetectionProps;
  /** Running scheduler Lambda to monitor. */
  readonly runningScheduleFunction: lambda.IFunction;
  /** Application log group for the running scheduler Lambda. */
  readonly logGroup: logs.ILogGroup;
}

/**
 * Opt-in failure detection for `EC2InstanceRunningScheduler`.
 *
 * Pass as `EC2InstanceRunningSchedulerProps.failureDetection`. Extends
 * {@link LambdaFailureDetection} (`enabled` / `alarmTopic`). Which log failures are
 * monitored is defined in this module and applied by {@link RunningSchedulerFailureDetection}.
 */
export interface RunningSchedulerFailureDetectionProps extends LambdaFailureDetection {}

/**
 * Lambda and log group monitored by {@link RunningSchedulerFailureDetection}.
 *
 * Normally `EC2InstanceRunningScheduler` creates this binding. Use directly only when
 * composing failure detection outside the scheduler construct.
 */
export interface RunningSchedulerFailureDetectionResourcesProps {
  readonly alarmTopic?: sns.ITopic;
  readonly runningScheduleFunction: lambda.IFunction;
  readonly logGroup: logs.ILogGroup;
}

const isFailureDetectionEnabled = (failureDetection: RunningSchedulerFailureDetectionProps): boolean =>
  failureDetection.enabled === true;

/**
 * CloudWatch alarms and log-based metrics for the EC2 instance running scheduler.
 *
 * Extends {@link LambdaFailureDetector} with scheduler-specific log filters:
 * - `lambdaErrorsAlarm` – `AWS/Lambda` `Errors` metric.
 * - `instanceStatusFailureAlarm` – log filter for `ResourceWaitFailed:*`.
 * - `slackPostFailureAlarm` – log filter for `running-scheduler: Slack post failed`.
 * - `durableExecutionFailureAlarm` – other handler-level `ERROR` logs (excluding the above).
 *
 * Custom metrics are published under the `EC2InstanceRunningScheduler` namespace.
 */
export class RunningSchedulerFailureDetection extends LambdaFailureDetector {
  /** Fires when instance stable-state waiting fails (`ResourceWaitFailed:*`). */
  public readonly instanceStatusFailureAlarm: cloudwatch.Alarm;
  /** Fires when Slack `chat.postMessage` fails. */
  public readonly slackPostFailureAlarm: cloudwatch.Alarm;
  /** Fires on handler-level ERROR logs outside instance waiting and Slack post failures. */
  public readonly durableExecutionFailureAlarm: cloudwatch.Alarm;

  /**
   * @param scope - Parent construct.
   * @param id - Construct id.
   * @param props - Lambda, log group, and optional alarm notification topic.
   */
  constructor(scope: Construct, id: string, props: RunningSchedulerFailureDetectionResourcesProps) {
    super(scope, id, {
      lambdaFunction: props.runningScheduleFunction,
      logGroup: props.logGroup,
      alarmTopic: props.alarmTopic,
      logFilters: RUNNING_SCHEDULER_LOG_FILTERS,
    });

    const instanceStatusFailureAlarm = this.findLogFilterAlarm(INSTANCE_STATUS_FAILURE_ID);
    const slackPostFailureAlarm = this.findLogFilterAlarm(SLACK_POST_FAILURE_ID);
    const durableExecutionFailureAlarm = this.findLogFilterAlarm(DURABLE_EXECUTION_FAILURE_ID);
    if (!instanceStatusFailureAlarm || !slackPostFailureAlarm || !durableExecutionFailureAlarm) {
      throw new Error('RunningSchedulerFailureDetection: expected log filter alarms were not created.');
    }

    this.instanceStatusFailureAlarm = instanceStatusFailureAlarm;
    this.slackPostFailureAlarm = slackPostFailureAlarm;
    this.durableExecutionFailureAlarm = durableExecutionFailureAlarm;
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
  props: CreateRunningSchedulerFailureDetectionProps,
): RunningSchedulerFailureDetection | undefined => {
  if (!props.failureDetection || !isFailureDetectionEnabled(props.failureDetection)) {
    return undefined;
  }

  return new RunningSchedulerFailureDetection(scope, id, {
    alarmTopic: props.failureDetection.alarmTopic,
    runningScheduleFunction: props.runningScheduleFunction,
    logGroup: props.logGroup,
  });
};
