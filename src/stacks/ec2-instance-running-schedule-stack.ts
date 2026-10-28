import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EC2InstanceRunningScheduler, TargetResource, Schedule, type RunningSchedulerFailureDetectionProps, type RunningSchedulerNotification } from '../constructs/ec2-instance-running-scheduler';

/**
 * Props for the EC2 instance running schedule CDK stack.
 *
 * @see {@link EC2InstanceRunningSchedulerProps} for construct-level options not exposed here
 * (e.g. `resourceWait`, `runtime`, `durable`, `logGroup`).
 */
export interface EC2InstanceRunningScheduleStackProps extends StackProps {
  /** Tag-based target resource for EC2 instances to start/stop. */
  readonly targetResource: TargetResource;
  /** Whether scheduling is enabled. Defaults to true if omitted. */
  readonly enableScheduling?: boolean;
  /**
   * Where to report a completed run.
   *
   * @default logs only
   */
  readonly notification?: RunningSchedulerNotification;
  /** Cron schedule for stopping instances. */
  readonly stopSchedule?: Schedule;
  /** Cron schedule for starting instances. */
  readonly startSchedule?: Schedule;
  /** Optional CloudWatch failure detection alarms and log-based metrics. */
  readonly failureDetection?: RunningSchedulerFailureDetectionProps;
}

/**
 * CDK stack that deploys the EC2 instance running scheduler (EventBridge Scheduler + Durable Lambda).
 *
 * Wires {@link EC2InstanceRunningScheduler} with targeting, schedules, optional notification, scheduling toggle,
 * and optional {@link RunningSchedulerFailureDetectionProps}. Does not expose {@link ResourceWaitLimits},
 * {@link RunningSchedulerRuntimeProps}, {@link RunningSchedulerDurableProps}, or
 * {@link RunningSchedulerLogGroupProps}; use the construct directly when custom runtime,
 * wait, durable, or log group settings are required.
 */
export class EC2InstanceRunningScheduleStack extends Stack {
  /**
   * Creates the stack and wires {@link EC2InstanceRunningScheduler}.
   *
   * @param scope - Parent construct or app.
   * @param id - Stack id.
   * @param props - Target resource, schedules, optional notification, optional failure detection, and standard stack props.
   */
  constructor(scope: Construct, id: string, props: EC2InstanceRunningScheduleStackProps) {
    super(scope, id, props);

    new EC2InstanceRunningScheduler(this, 'EC2InstanceRunningScheduler', {
      targetResource: props.targetResource,
      enableScheduling: props.enableScheduling,
      notification: props.notification,
      stopSchedule: props.stopSchedule,
      startSchedule: props.startSchedule,
      failureDetection: props.failureDetection,
    });
  }
}