import * as sns from 'aws-cdk-lib/aws-sns';

/**
 * Opt-in options for {@link LambdaFailureDetector}.
 *
 * When {@link LambdaFailureDetection.enabled} is true, alarms are created.
 * {@link LambdaFailureDetection.alarmTopic} is optional; when omitted, alarms have no SNS actions.
 * The construct never creates an SNS topic.
 */
export interface LambdaFailureDetection {
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
 * Whether {@link LambdaFailureDetection} requests alarm creation.
 */
export const isLambdaFailureDetectionEnabled = (
  failureDetection: LambdaFailureDetection,
): boolean => failureDetection.enabled === true;
