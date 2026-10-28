import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  EC2InstanceRunningScheduler,
  type EC2InstanceRunningSchedulerProps,
} from './ec2-instance-running-scheduler';

/**
 * Props for the EC2 instance running schedule CDK stack.
 *
 * Scheduler fields match {@link EC2InstanceRunningSchedulerProps}. Stack settings such as `env` stay on the stack.
 */
export interface EC2InstanceRunningScheduleStackProps extends EC2InstanceRunningSchedulerProps, StackProps {}

/**
 * CDK stack that deploys the EC2 instance running scheduler (EventBridge Scheduler + Durable Lambda).
 *
 * Forwards the scheduler fields of {@link EC2InstanceRunningScheduleStackProps} to {@link EC2InstanceRunningScheduler}.
 */
export class EC2InstanceRunningScheduleStack extends Stack {
  /**
   * Creates the stack and wires {@link EC2InstanceRunningScheduler}.
   *
   * @param scope - Parent construct or app.
   * @param id - Stack id.
   * @param props - Scheduler props plus standard stack props.
   */
  constructor(scope: Construct, id: string, props: EC2InstanceRunningScheduleStackProps) {
    super(scope, id, props);

    new EC2InstanceRunningScheduler(this, 'EC2InstanceRunningScheduler', {
      targetResource: props.targetResource,
      enableScheduling: props.enableScheduling,
      notification: props.notification,
      stopSchedule: props.stopSchedule,
      startSchedule: props.startSchedule,
      resourceWait: props.resourceWait,
      runtime: props.runtime,
      durable: props.durable,
      logGroup: props.logGroup,
      failureDetection: props.failureDetection,
    });
  }
}
