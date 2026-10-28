import { StrictEnvValidationError } from 'strict-env-resolver';
import { parseNotificationFromEnv } from '../src/funcs/running-scheduler-wait-env';
import {
  NOTIFICATION_CHANNEL_ENV,
  NOTIFICATION_CHANNEL_EVENT_BRIDGE,
  NOTIFICATION_CHANNEL_LOGS,
  NOTIFICATION_CHANNEL_SLACK,
  NOTIFICATION_CHANNEL_SNS,
  NOTIFICATION_EVENT_BUS_NAME_ENV,
  NOTIFICATION_TOPIC_ARN_ENV,
  SLACK_SECRET_NAME_ENV,
} from '../src/settings/consts';

const ENV_KEYS = [
  NOTIFICATION_CHANNEL_ENV,
  SLACK_SECRET_NAME_ENV,
  NOTIFICATION_TOPIC_ARN_ENV,
  NOTIFICATION_EVENT_BUS_NAME_ENV,
] as const;

const withNotificationEnv = (values: Record<string, string | undefined>, run: () => void): void => {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
  try {
    run();
  } finally {
    for (const key of ENV_KEYS) {
      const prior = previous.get(key);
      if (prior === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = prior;
    }
  }
};

describe('parseNotificationFromEnv', () => {
  it('defaults to logs when the channel is unset', () => {
    withNotificationEnv({}, () => {
      expect(parseNotificationFromEnv()).toEqual({ channel: NOTIFICATION_CHANNEL_LOGS });
    });
  });

  it.each([
    [NOTIFICATION_CHANNEL_SLACK, SLACK_SECRET_NAME_ENV, 'slackSecretName', 'my-slack'],
    [NOTIFICATION_CHANNEL_SNS, NOTIFICATION_TOPIC_ARN_ENV, 'topicArn', 'arn:aws:sns:ap-northeast-1:111122223333:ops'],
    [NOTIFICATION_CHANNEL_EVENT_BRIDGE, NOTIFICATION_EVENT_BUS_NAME_ENV, 'eventBusName', 'ops-bus'],
  ] as const)('reads %s settings', (channel, envKey, field, value) => {
    withNotificationEnv({
      [NOTIFICATION_CHANNEL_ENV]: channel,
      [envKey]: value,
    }, () => {
      expect(parseNotificationFromEnv()).toEqual({ channel, [field]: value });
    });
  });

  it('rejects an unknown channel', () => {
    withNotificationEnv({ [NOTIFICATION_CHANNEL_ENV]: 'email' }, () => {
      expect(() => parseNotificationFromEnv()).toThrow(StrictEnvValidationError);
    });
  });

  it('rejects a missing Slack secret name', () => {
    withNotificationEnv({ [NOTIFICATION_CHANNEL_ENV]: NOTIFICATION_CHANNEL_SLACK }, () => {
      expect(() => parseNotificationFromEnv()).toThrow(StrictEnvValidationError);
    });
  });
});
