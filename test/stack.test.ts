import { App, Stack, TimeZone } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { EC2InstanceRunningScheduler, EC2InstanceRunningScheduleStack } from '../src';

const baseProps = {
  targetResource: {
    tagKey: 'WorkHoursRunning',
    tagValues: ['YES'],
  },
  secrets: {
    slackSecretName: 'test/slack-webhook',
  },
};

describe('EC2InstanceRunningScheduleStack', () => {
  describe('default (scheduling enabled, default schedule)', () => {
    const app = new App();
    const stack = new EC2InstanceRunningScheduleStack(app, 'EC2InstanceRunningScheduleStack', {
      ...baseProps,
    });
    const template = Template.fromStack(stack);

    it('Should have Scheduler 2 exist', () => {
      template.resourceCountIs('AWS::Scheduler::Schedule', 2);
    });

    it('Should have Lambda 1 exist', () => {
      template.resourceCountIs('AWS::Lambda::Function', 1);
    });

    it('Should have Lambda Alias for Durable invocation', () => {
      template.resourceCountIs('AWS::Lambda::Alias', 1);
    });

    it('Should set default resource polling limits on Lambda', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            PROCESS_RESOURCE_MAX_LOOP_COUNT: '90',
            PROCESS_RESOURCE_MAX_ELAPSED_SECONDS: '1800',
          },
        },
      });
    });

    it('Should have default Start Schedule (50 7 MON-FRI Etc/UTC)', () => {
      template.hasResourceProperties('AWS::Scheduler::Schedule', {
        ScheduleExpression: 'cron(50 7 ? * MON-FRI *)',
        ScheduleExpressionTimezone: 'Etc/UTC',
      });
    });

    it('Should have default Stop Schedule (5 19 MON-FRI Etc/UTC)', () => {
      template.hasResourceProperties('AWS::Scheduler::Schedule', {
        ScheduleExpression: 'cron(5 19 ? * MON-FRI *)',
        ScheduleExpressionTimezone: 'Etc/UTC',
      });
    });

    it('Should match snapshot', () => {
      expect(template.toJSON()).toMatchSnapshot('default');
    });
  });

  describe('disable (enableScheduling: false)', () => {
    const app = new App();
    const stack = new EC2InstanceRunningScheduleStack(app, 'EC2InstanceRunningScheduleStack', {
      ...baseProps,
      enableScheduling: false,
    });
    const template = Template.fromStack(stack);

    it('Should have Scheduler 2 exist but disabled', () => {
      template.resourceCountIs('AWS::Scheduler::Schedule', 2);
      const schedules = template.findResources('AWS::Scheduler::Schedule');
      const states = Object.values(schedules).map((r: any) => r.Properties?.State);
      expect(states).toEqual(['DISABLED', 'DISABLED']);
    });

    it('Should match snapshot', () => {
      expect(template.toJSON()).toMatchSnapshot('disable');
    });
  });

  describe('specific (custom schedule and timezone)', () => {
    const app = new App();
    const stack = new EC2InstanceRunningScheduleStack(app, 'EC2InstanceRunningScheduleStack', {
      ...baseProps,
      enableScheduling: true,
      startSchedule: {
        timezone: TimeZone.ASIA_TOKYO,
        minute: '55',
        hour: '8',
        week: 'MON-FRI',
      },
      stopSchedule: {
        timezone: TimeZone.ASIA_TOKYO,
        minute: '5',
        hour: '19',
        week: 'MON-FRI',
      },
    });
    const template = Template.fromStack(stack);

    it('Should have Scheduler 2 exist', () => {
      template.resourceCountIs('AWS::Scheduler::Schedule', 2);
    });

    it('Should have Start Scheduler with Asia/Tokyo', () => {
      template.hasResourceProperties('AWS::Scheduler::Schedule', {
        ScheduleExpression: 'cron(55 8 ? * MON-FRI *)',
        ScheduleExpressionTimezone: 'Asia/Tokyo',
      });
    });

    it('Should have Stop Scheduler with Asia/Tokyo', () => {
      template.hasResourceProperties('AWS::Scheduler::Schedule', {
        ScheduleExpression: 'cron(5 19 ? * MON-FRI *)',
        ScheduleExpressionTimezone: 'Asia/Tokyo',
      });
    });

    it('Should have Lambda 1 exist', () => {
      template.resourceCountIs('AWS::Lambda::Function', 1);
    });

    it('Should have Lambda Alias for Durable invocation', () => {
      template.resourceCountIs('AWS::Lambda::Alias', 1);
    });

    it('Should match snapshot', () => {
      expect(template.toJSON()).toMatchSnapshot('specific');
    });
  });
});

describe('EC2InstanceRunningScheduler resourcePolling', () => {
  it('sets custom polling limits on the Lambda environment', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    new EC2InstanceRunningScheduler(stack, 'Scheduler', {
      ...baseProps,
      resourcePolling: {
        maxLoopCount: 42,
        maxElapsedSeconds: 900,
      },
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          PROCESS_RESOURCE_MAX_LOOP_COUNT: '42',
          PROCESS_RESOURCE_MAX_ELAPSED_SECONDS: '900',
          SLACK_SECRET_NAME: baseProps.secrets.slackSecretName,
        },
      },
    });
  });
});
