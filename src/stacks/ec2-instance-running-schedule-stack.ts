import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EC2InstanceRunningScheduler, TargetResource, Secrets, Schedule, type FailureDetectionAlarms } from '../constructs/ec2-instance-running-scheduler';

/**
 * Props for the EC2 instance running schedule CDK stack.
 *
 * @see {@link EC2InstanceRunningSchedulerProps} for construct-level options not exposed here (e.g. `resourceWait`).
 */
export interface EC2InstanceRunningScheduleStackProps extends StackProps {
  /** Tag-based target resource for EC2 instances to start/stop. */
  readonly targetResource: TargetResource;
  /** Whether scheduling is enabled. Defaults to true if omitted. */
  readonly enableScheduling?: boolean;
  /** Secrets (e.g. Slack) for the scheduler. */
  readonly secrets: Secrets;
  /** Cron schedule for stopping instances. */
  readonly stopSchedule?: Schedule;
  /** Cron schedule for starting instances. */
  readonly startSchedule?: Schedule;
  /** Optional CloudWatch failure detection alarms. */
  readonly failureDetection?: FailureDetectionAlarms;
}

/**
 * CDK stack that deploys the EC2 instance running scheduler (EventBridge Scheduler + Durable Lambda).
 */
export class EC2InstanceRunningScheduleStack extends Stack {
  /**
   * Creates the stack and wires {@link EC2InstanceRunningScheduler}.
   *
   * @param scope - Parent construct or app.
   * @param id - Stack id.
   * @param props - Target resource, schedules, secrets, and standard stack props.
   */
  constructor(scope: Construct, id: string, props: EC2InstanceRunningScheduleStackProps) {
    super(scope, id, props);

    new EC2InstanceRunningScheduler(this, 'EC2InstanceRunningScheduler', {
      targetResource: props.targetResource,
      enableScheduling: props.enableScheduling,
      secrets: props.secrets,
      stopSchedule: props.stopSchedule,
      startSchedule: props.startSchedule,
      failureDetection: props.failureDetection,
    });
  }
}