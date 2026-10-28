/**
 * Plain-text notification copy shared by logs, SNS email, and EventBridge detail.
 *
 * SNS email subscriptions cannot render HTML, so the body is structured text.
 * Emoji match the Slack parent line and per-instance status line.
 */

/** One instance included in a completion notification. */
export interface NotificationInstance {
  /** Account id parsed from the instance ARN. */
  readonly account: string;
  /** Region parsed from the instance ARN. */
  readonly region: string;
  /** EC2 instance id. */
  readonly identifier: string;
  /** EC2 state name after processing (for example `running` or `stopped`). */
  readonly status: string;
}

/** Subject line and plain-text body for one scheduler run. */
export interface NotificationText {
  /** Parent line. Also used as the SNS email subject. */
  readonly subject: string;
  /** Instance blocks separated by a blank line. */
  readonly message: string;
}

/** JSON `detail` published to an EventBridge custom bus. */
export interface NotificationEventDetail {
  /** Scheduler mode for this run. */
  readonly mode: 'Start' | 'Stop';
  /** Same text as {@link NotificationText.subject}. */
  readonly subject: string;
  /** Same text as {@link NotificationText.message}. */
  readonly message: string;
  /** Instances included in {@link NotificationEventDetail.message}. */
  readonly instances: readonly NotificationInstance[];
}

/** Emoji and label for a known EC2 state. */
export interface InstanceStatusDisplay {
  /** Status emoji. */
  readonly emoji: string;
  /** Uppercase status label. */
  readonly name: string;
}

const STATE_DISPLAY = [
  { name: 'RUNNING', emoji: '😆', state: 'running' },
  { name: 'STOPPED', emoji: '😴', state: 'stopped' },
] as const;

const UNKNOWN_STATUS_DISPLAY: InstanceStatusDisplay = { emoji: '❔', name: 'Unknown' };

/**
 * Parent line for a start or stop run.
 *
 * @param mode - Scheduler mode.
 * @returns Slack parent text and SNS email subject.
 */
export const notificationSubject = (mode: 'Start' | 'Stop'): string => {
  if (mode === 'Start') {
    return '😆 Starts the scheduled EC2 Instance.';
  }
  return '🥱 Stops the scheduled EC2 Instance.';
};

/**
 * Emoji and label for an EC2 state name.
 *
 * @param status - EC2 state name.
 * @returns Display for a known state, or a fallback for anything else.
 */
export const instanceStatusDisplay = (status: string): InstanceStatusDisplay => {
  const found = STATE_DISPLAY.find((entry) => entry.state === status);
  if (!found) {
    return UNKNOWN_STATUS_DISPLAY;
  }
  return { emoji: found.emoji, name: found.name };
};

/**
 * One plain-text block for a single instance.
 *
 * @param instance - Instance fields to include.
 * @returns Five lines: status sentence, account, region, identifier, and status label.
 */
export const formatInstanceBlock = (instance: NotificationInstance): string => {
  const display = instanceStatusDisplay(instance.status);
  return [
    `${display.emoji} The status of the EC2 Instance ${instance.identifier} changed to ${display.name} due to the schedule.`,
    `Account: ${instance.account}`,
    `Region: ${instance.region}`,
    `Identifier: ${instance.identifier}`,
    `Status: ${display.name}`,
  ].join('\n');
};

/**
 * Subject and body for a completed run.
 *
 * @param mode - Scheduler mode.
 * @param instances - Instances that finished processing. Order is preserved.
 * @returns Subject plus instance blocks separated by a blank line.
 */
export const formatNotificationText = (
  mode: 'Start' | 'Stop',
  instances: readonly NotificationInstance[],
): NotificationText => {
  return {
    subject: notificationSubject(mode),
    message: instances.map((instance) => formatInstanceBlock(instance)).join('\n\n'),
  };
};

/**
 * EventBridge detail payload for a completed run.
 *
 * @param mode - Scheduler mode.
 * @param instances - Instances that finished processing.
 * @returns Detail object. The handler JSON-encodes it for `PutEvents`.
 */
export const buildNotificationEventDetail = (
  mode: 'Start' | 'Stop',
  instances: readonly NotificationInstance[],
): NotificationEventDetail => {
  const text = formatNotificationText(mode, instances);
  return {
    mode,
    subject: text.subject,
    message: text.message,
    instances,
  };
};
