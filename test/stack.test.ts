import { App, Duration, RemovalPolicy, Stack, TimeZone } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as events from 'aws-cdk-lib/aws-events';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { EC2InstanceRunningScheduler, EC2InstanceRunningScheduleStack } from '../src';

const baseProps = {
  targetResource: {
    tagKey: 'WorkHoursRunning',
    tagValues: ['YES'],
  },
};

/**
 * Function, alias, and both schedules that every running-scheduler stack wires.
 */
const expectDurableSchedulerWiring = (template: Template): void => {
  template.resourceCountIs('AWS::Lambda::Function', 1);
  template.resourceCountIs('AWS::Lambda::Alias', 1);
  template.resourceCountIs('AWS::Scheduler::Schedule', 2);
};

interface SchedulerScheduleResource {
  readonly Properties?: {
    readonly State?: string;
  };
}

const isSchedulerScheduleResource = (value: unknown): value is SchedulerScheduleResource => {
  return typeof value === 'object' && value !== null;
};

describe('EC2InstanceRunningScheduleStack', () => {
  describe('default (scheduling enabled, default schedule)', () => {
    const app = new App();
    const stack = new EC2InstanceRunningScheduleStack(app, 'EC2InstanceRunningScheduleStack', {
      ...baseProps,
    });
    const template = Template.fromStack(stack);

    it('Should wire the durable scheduler', () => {
      expectDurableSchedulerWiring(template);
    });

    it('Should set default resource wait limits and concurrency on Lambda', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            NOTIFICATION_CHANNEL: 'logs',
            PROCESS_RESOURCE_MAX_LOOP_COUNT: '90',
            PROCESS_RESOURCE_MAX_ELAPSED_SECONDS: '1800',
            PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS: '20',
            PROCESS_RESOURCES_MAX_CONCURRENCY: '10',
          },
        },
        MemorySize: 512,
        Timeout: 900,
        DurableConfig: {
          ExecutionTimeout: 7200,
          RetentionPeriodInDays: 1,
        },
      });
    });

    it('Should retain logs for three months and keep them after a successful create', () => {
      template.hasResource('AWS::Logs::LogGroup', {
        DeletionPolicy: 'RetainExceptOnCreate',
        UpdateReplacePolicy: 'Retain',
        Properties: Match.objectLike({
          RetentionInDays: 90,
        }),
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

    it('Should scope start/stop IAM to tagged instances in this account and region', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Sid: 'GetResources',
              Action: 'tag:GetResources',
              Resource: '*',
            }),
            Match.objectLike({
              Sid: 'Ec2DescribeInstances',
              Action: 'ec2:DescribeInstances',
              Resource: '*',
            }),
            Match.objectLike({
              Sid: 'Ec2StartStopTaggedInstances',
              Action: ['ec2:StartInstances', 'ec2:StopInstances'],
              Resource: {
                'Fn::Join': [
                  '',
                  [
                    'arn:',
                    { Ref: 'AWS::Partition' },
                    ':ec2:',
                    { Ref: 'AWS::Region' },
                    ':',
                    { Ref: 'AWS::AccountId' },
                    ':instance/*',
                  ],
                ],
              },
              Condition: {
                StringEquals: {
                  'aws:ResourceTag/WorkHoursRunning': ['YES'],
                },
              },
            }),
          ]),
        },
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
      expectDurableSchedulerWiring(template);
      const schedules = template.findResources('AWS::Scheduler::Schedule');
      const states = Object.values(schedules).flatMap((resource) => {
        if (!isSchedulerScheduleResource(resource)) {
          return [];
        }
        return [resource.Properties?.State];
      });
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

    it('Should wire the durable scheduler', () => {
      expectDurableSchedulerWiring(template);
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

    it('Should match snapshot', () => {
      expect(template.toJSON()).toMatchSnapshot('specific');
    });
  });
});

describe('EC2InstanceRunningScheduler resourceWait', () => {
  it('sets custom wait limits on the Lambda environment', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    new EC2InstanceRunningScheduler(stack, 'Scheduler', {
      ...baseProps,
      resourceWait: {
        maxLoopCount: 42,
        maxElapsedSeconds: 900,
        statusChangeWaitSeconds: 5,
      },
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          PROCESS_RESOURCE_MAX_LOOP_COUNT: '42',
          PROCESS_RESOURCE_MAX_ELAPSED_SECONDS: '900',
          PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS: '5',
          NOTIFICATION_CHANNEL: 'logs',
        },
      },
    });
  });
});

describe('EC2InstanceRunningScheduler IAM', () => {
  it('applies aws:ResourceTag for each configured tag value', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    new EC2InstanceRunningScheduler(stack, 'Scheduler', {
      ...baseProps,
      targetResource: {
        tagKey: 'Schedule',
        tagValues: ['YES', 'ALWAYS'],
      },
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'Ec2StartStopTaggedInstances',
            Condition: {
              StringEquals: {
                'aws:ResourceTag/Schedule': ['YES', 'ALWAYS'],
              },
            },
          }),
        ]),
      },
    });
  });

  it('throws when tagKey is empty', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    expect(() => {
      new EC2InstanceRunningScheduler(stack, 'Scheduler', {
        ...baseProps,
        targetResource: {
          tagKey: '',
          tagValues: ['YES'],
        },
      });
    }).toThrow(/tagKey/);
  });

  it('throws when tagValues is empty', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    expect(() => {
      new EC2InstanceRunningScheduler(stack, 'Scheduler', {
        ...baseProps,
        targetResource: {
          tagKey: 'Schedule',
          tagValues: [],
        },
      });
    }).toThrow(/tagValues/);
  });
});

describe('EC2InstanceRunningScheduler runtime durable logGroup', () => {
  it('overrides lambda runtime, durable execution, and log group settings', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    new EC2InstanceRunningScheduler(stack, 'Scheduler', {
      ...baseProps,
      runtime: {
        memorySize: 1024,
        timeout: Duration.minutes(10),
        maxConcurrency: 25,
      },
      durable: {
        executionTimeout: Duration.hours(4),
        retentionPeriod: Duration.days(7),
      },
      logGroup: {
        retention: logs.RetentionDays.ONE_YEAR,
        removalPolicy: RemovalPolicy.RETAIN,
      },
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 1024,
      Timeout: 600,
      DurableConfig: {
        ExecutionTimeout: 14400,
        RetentionPeriodInDays: 7,
      },
      Environment: {
        Variables: {
          PROCESS_RESOURCES_MAX_CONCURRENCY: '25',
        },
      },
    });
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: 365,
    });
    template.hasResource('AWS::Logs::LogGroup', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  it('throws when maxConcurrency is not a positive integer', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    expect(() => {
      new EC2InstanceRunningScheduler(stack, 'Scheduler', {
        ...baseProps,
        runtime: {
          maxConcurrency: 0,
        },
      });
    }).toThrow(/runtime.maxConcurrency/);
  });

  it('throws when statusChangeWaitSeconds is not a positive integer', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    expect(() => {
      new EC2InstanceRunningScheduler(stack, 'Scheduler', {
        ...baseProps,
        resourceWait: {
          statusChangeWaitSeconds: -1,
        },
      });
    }).toThrow(/resourceWait.statusChangeWaitSeconds/);
  });
});

describe('EC2InstanceRunningScheduler failureDetection', () => {
  it('does not create alarms by default', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    new EC2InstanceRunningScheduler(stack, 'Scheduler', {
      ...baseProps,
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::CloudWatch::Alarm', 0);
    template.resourceCountIs('AWS::Logs::MetricFilter', 0);
    template.resourceCountIs('AWS::SNS::Topic', 0);
  });

  it('creates failure detection alarms and log metric filters when enabled', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    new EC2InstanceRunningScheduler(stack, 'Scheduler', {
      ...baseProps,
      failureDetection: {
        enabled: true,
      },
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::CloudWatch::Alarm', 5);
    template.resourceCountIs('AWS::Logs::MetricFilter', 3);
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'Errors',
      Namespace: 'AWS/Lambda',
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'Throttles',
      Namespace: 'AWS/Lambda',
    });
    template.hasResourceProperties('AWS::Logs::MetricFilter', {
      FilterPattern: '"ResourceWaitFailed"',
      MetricTransformations: [{
        MetricNamespace: 'EC2InstanceRunningScheduler',
        MetricName: 'InstanceStatusFailure',
      }],
    });
    template.hasResourceProperties('AWS::Logs::MetricFilter', {
      FilterPattern: '"running-scheduler: notification post failed"',
      MetricTransformations: [{
        MetricNamespace: 'EC2InstanceRunningScheduler',
        MetricName: 'NotificationPostFailure',
      }],
    });
  });

  it('wires alarm actions when alarmTopic is provided', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const alarmTopic = new sns.Topic(stack, 'OpsAlerts');
    new EC2InstanceRunningScheduler(stack, 'Scheduler', {
      ...baseProps,
      failureDetection: {
        enabled: true,
        alarmTopic,
      },
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::SNS::Topic', 1);
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    const alarmActions = Object.values(alarms).map((alarm) => alarm.Properties?.AlarmActions);
    expect(alarmActions.every((actions) => Array.isArray(actions) && actions.length === 1)).toBe(true);
    expect(alarmActions.every((actions) => JSON.stringify(actions).includes('OpsAlerts'))).toBe(true);
  });

  it('accepts an imported SNS topic for alarm actions', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const alarmTopicArn = 'arn:aws:sns:ap-northeast-1:123456789012:ops-alerts';
    const alarmTopic = sns.Topic.fromTopicArn(stack, 'ImportedOpsAlerts', alarmTopicArn);
    new EC2InstanceRunningScheduler(stack, 'Scheduler', {
      ...baseProps,
      failureDetection: {
        enabled: true,
        alarmTopic,
      },
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::SNS::Topic', 0);
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmActions: [alarmTopicArn],
    });
  });
});

describe('EC2InstanceRunningScheduler notification', () => {
  it('throws when the Slack secret name is blank', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    expect(() => {
      new EC2InstanceRunningScheduler(stack, 'Scheduler', {
        ...baseProps,
        notification: {
          channel: 'slack',
          slackSecretName: '  ',
        },
      });
    }).toThrow(/slackSecretName/);
  });

  it('grants Slack secret read and sets the secret name when Slack is selected', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    new EC2InstanceRunningScheduler(stack, 'Scheduler', {
      ...baseProps,
      notification: {
        channel: 'slack',
        slackSecretName: 'test/slack',
      },
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          NOTIFICATION_CHANNEL: 'slack',
          SLACK_SECRET_NAME: 'test/slack',
        },
      },
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['secretsmanager:GetSecretValue']),
          }),
        ]),
      },
    });
  });

  it('grants sns:Publish on the provided topic and does not create a topic', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const topicArn = 'arn:aws:sns:ap-northeast-1:123456789012:ops-notify';
    new EC2InstanceRunningScheduler(stack, 'Scheduler', {
      ...baseProps,
      notification: {
        channel: 'sns',
        topic: sns.Topic.fromTopicArn(stack, 'NotifyTopic', topicArn),
      },
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::SNS::Topic', 0);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          NOTIFICATION_CHANNEL: 'sns',
          NOTIFICATION_TOPIC_ARN: topicArn,
        },
      },
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sns:Publish',
            Resource: topicArn,
          }),
        ]),
      },
    });
  });

  it('grants events:PutEvents on the provided custom bus', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    new EC2InstanceRunningScheduler(stack, 'Scheduler', {
      ...baseProps,
      notification: {
        channel: 'eventBridge',
        eventBus: events.EventBus.fromEventBusName(stack, 'NotifyBus', 'ops-bus'),
      },
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::Events::EventBus', 0);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          NOTIFICATION_CHANNEL: 'eventBridge',
          NOTIFICATION_EVENT_BUS_NAME: 'ops-bus',
        },
      },
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'events:PutEvents',
          }),
        ]),
      },
    });
  });
});
