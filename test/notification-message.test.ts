import {
  buildNotificationEventDetail,
  formatInstanceBlock,
  formatNotificationText,
  instanceStatusDisplay,
  notificationSubject,
} from '../src/funcs/core/notification-message';

const instance = {
  account: '111122223333',
  region: 'ap-northeast-1',
  identifier: 'i-abc',
  status: 'running',
};

describe('notificationSubject', () => {
  it.each([
    ['Start', '😆 Starts the scheduled EC2 Instance.'],
    ['Stop', '🥱 Stops the scheduled EC2 Instance.'],
  ] as const)('mode %s', (mode, subject) => {
    expect(notificationSubject(mode)).toBe(subject);
  });
});

describe('instanceStatusDisplay', () => {
  it.each([
    ['running', '😆', 'RUNNING'],
    ['stopped', '😴', 'STOPPED'],
    ['pending', '❔', 'Unknown'],
  ] as const)('state %s', (status, emoji, name) => {
    expect(instanceStatusDisplay(status)).toEqual({ emoji, name });
  });
});

describe('formatNotificationText', () => {
  it('builds one plain-text block per instance', () => {
    const text = formatNotificationText('Start', [
      instance,
      { ...instance, identifier: 'i-def', status: 'stopped' },
    ]);

    expect(text.subject).toBe('😆 Starts the scheduled EC2 Instance.');
    expect(text.message).toBe([
      formatInstanceBlock(instance),
      formatInstanceBlock({ ...instance, identifier: 'i-def', status: 'stopped' }),
    ].join('\n\n'));
    expect(text.message).toContain('Account: 111122223333');
    expect(text.message).toContain('Region: ap-northeast-1');
    expect(text.message).toContain('Status: RUNNING');
    expect(text.message).toContain('Status: STOPPED');
  });
});

describe('buildNotificationEventDetail', () => {
  it('includes the plain-text body and the instance list', () => {
    const detail = buildNotificationEventDetail('Stop', [instance]);

    expect(detail.mode).toBe('Stop');
    expect(detail.subject).toBe(notificationSubject('Stop'));
    expect(detail.message).toBe(formatInstanceBlock(instance));
    expect(detail.instances).toEqual([instance]);
  });
});
