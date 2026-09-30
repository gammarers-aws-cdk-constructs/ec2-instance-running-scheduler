/**
 * One log-based failure signal for {@link LambdaFailureDetector}.
 *
 * Creates a CloudWatch Logs metric filter and an alarm on the resulting sum metric.
 */
export interface LogFailureFilter {
  /**
   * Stable id used as the MetricFilter / Alarm construct id prefix
   * (e.g. `InstanceStatusFailure` → `InstanceStatusFailureMetric`).
   */
  readonly id: string;
  /**
   * CloudWatch Logs filter pattern string passed to `FilterPattern.literal`.
   *
   * @example '"ResourceWaitFailed"'
   */
  readonly filterPattern: string;
  /** Custom metric namespace for the metric filter. */
  readonly metricNamespace: string;
  /** Custom metric name for the metric filter. */
  readonly metricName: string;
}
