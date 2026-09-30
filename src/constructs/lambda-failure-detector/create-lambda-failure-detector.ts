import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import type { LambdaFailureDetection } from './lambda-failure-detection';
import { LambdaFailureDetector } from './lambda-failure-detector';
import type { LogFailureFilter } from './log-failure-filter';

/**
 * Props accepted by {@link createLambdaFailureDetector}.
 */
export interface CreateLambdaFailureDetectorProps {
  /** Opt-in options; alarms are created only when {@link LambdaFailureDetection.enabled} is true. */
  readonly failureDetection?: LambdaFailureDetection;
  /** Lambda function to monitor. */
  readonly lambdaFunction: lambda.IFunction;
  /** Application log group for log-based filters. */
  readonly logGroup: logs.ILogGroup;
  /**
   * Log-based failure filters.
   *
   * @default no log-based alarms
   */
  readonly logFilters?: LogFailureFilter[];
}

const isFailureDetectionEnabled = (failureDetection: LambdaFailureDetection): boolean =>
  failureDetection.enabled === true;

/**
 * Creates a {@link LambdaFailureDetector} when failure detection is enabled.
 *
 * @param scope - Parent construct.
 * @param id - Construct id.
 * @param props - Lambda, log group, optional opt-in options, and log filters.
 * @returns Detector construct, or undefined when disabled.
 */
export const createLambdaFailureDetector = (
  scope: Construct,
  id: string,
  props: CreateLambdaFailureDetectorProps,
): LambdaFailureDetector | undefined => {
  if (!props.failureDetection || !isFailureDetectionEnabled(props.failureDetection)) {
    return undefined;
  }

  return new LambdaFailureDetector(scope, id, {
    lambdaFunction: props.lambdaFunction,
    logGroup: props.logGroup,
    alarmTopic: props.failureDetection.alarmTopic,
    logFilters: props.logFilters,
  });
};
