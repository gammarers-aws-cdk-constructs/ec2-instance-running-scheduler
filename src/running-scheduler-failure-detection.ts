import { type Alarm } from 'aws-cdk-lib/aws-cloudwatch';
import { type IFunction } from 'aws-cdk-lib/aws-lambda';
import { type ILogGroup } from 'aws-cdk-lib/aws-logs';
import { type ITopic } from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import {
  isLambdaFailureDetectionEnabled,
  LambdaFailureDetector,
  type LambdaFailureDetection,
  type LogFailureFilter,
} from 'lambda-failure-detector';
import { NOTIFICATION_POST_FAILED_LOG, RUNNING_SCHEDULER_EXECUTION_FAILED_LOG } from './settings/consts';

/** CloudWatch custom metric namespace for running-scheduler log-based failure metrics. */
const METRIC_NAMESPACE = 'EC2InstanceRunningScheduler';

const INSTANCE_STATUS_FAILURE_ID = 'InstanceStatusFailure';
const NOTIFICATION_POST_FAILURE_ID = 'NotificationPostFailure';
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
    id: NOTIFICATION_POST_FAILURE_ID,
    filterPattern: `"${NOTIFICATION_POST_FAILED_LOG}"`,
    metricNamespace: METRIC_NAMESPACE,
    metricName: 'NotificationPostFailure',
  },
  {
    id: DURABLE_EXECUTION_FAILURE_ID,
    filterPattern: `"${RUNNING_SCHEDULER_EXECUTION_FAILED_LOG}"`,
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
  readonly runningScheduleFunction: IFunction;
  /** Application log group for the running scheduler Lambda. */
  readonly logGroup: ILogGroup;
}

/**
 * Opt-in failure detection for {@link EC2InstanceRunningScheduler}.
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
  /** Existing SNS topic for alarm actions. When omitted, alarms have no SNS actions. */
  readonly alarmTopic?: ITopic;
  /** Running scheduler Lambda whose platform metrics are alarmed. */
  readonly runningScheduleFunction: IFunction;
  /** Application log group used by the scheduler log filters. */
  readonly logGroup: ILogGroup;
}

/**
 * Resolves a required log-filter alarm created from the scheduler log filters.
 *
 * @param detector - Detector that owns the log-filter alarms.
 * @param id - {@link LogFailureFilter} id.
 * @returns The CloudWatch alarm for that filter.
 * @throws {Error} When no alarm exists for the given id.
 */
const requireLogFilterAlarm = (
  detector: LambdaFailureDetector,
  id: string,
): Alarm => {
  const alarm = detector.findLogFilterAlarm(id);
  if (!alarm) {
    throw new Error(`RunningSchedulerFailureDetection: missing log filter alarm for id "${id}".`);
  }

  return alarm;
};

/**
 * CloudWatch alarms and log-based metrics for the EC2 instance running scheduler.
 *
 * Extends {@link LambdaFailureDetector} with scheduler-specific log filters.
 * Platform alarms from `lambda-failure-detector` include `Errors` and `Throttles`.
 * - `lambdaErrorsAlarm` – `AWS/Lambda` `Errors` metric.
 * - `lambdaThrottlesAlarm` – `AWS/Lambda` `Throttles` metric.
 * - `instanceStatusFailureAlarm` – log filter for `ResourceWaitFailed:*`.
 * - `notificationPostFailureAlarm` – log filter for `running-scheduler: notification post failed`.
 * - `durableExecutionFailureAlarm` – log filter for {@link RUNNING_SCHEDULER_EXECUTION_FAILED_LOG}.
 *
 * Custom metrics are published under the `EC2InstanceRunningScheduler` namespace.
 */
export class RunningSchedulerFailureDetection extends LambdaFailureDetector {
  /** Fires when instance stable-state waiting fails (`ResourceWaitFailed:*`). */
  public readonly instanceStatusFailureAlarm: Alarm;
  /** Fires when a configured Slack, SNS, or EventBridge notification send fails. */
  public readonly notificationPostFailureAlarm: Alarm;
  /** Fires when the handler logs {@link RUNNING_SCHEDULER_EXECUTION_FAILED_LOG}. */
  public readonly durableExecutionFailureAlarm: Alarm;

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

    this.instanceStatusFailureAlarm = requireLogFilterAlarm(this, INSTANCE_STATUS_FAILURE_ID);
    this.notificationPostFailureAlarm = requireLogFilterAlarm(this, NOTIFICATION_POST_FAILURE_ID);
    this.durableExecutionFailureAlarm = requireLogFilterAlarm(this, DURABLE_EXECUTION_FAILURE_ID);
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
  if (!props.failureDetection || !isLambdaFailureDetectionEnabled(props.failureDetection)) {
    return undefined;
  }

  return new RunningSchedulerFailureDetection(scope, id, {
    alarmTopic: props.failureDetection.alarmTopic,
    runningScheduleFunction: props.runningScheduleFunction,
    logGroup: props.logGroup,
  });
};
