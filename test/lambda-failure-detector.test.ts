import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { createLambdaFailureDetector } from '../src';

describe('createLambdaFailureDetector', () => {
  const createStackWithFunction = () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const logGroup = new logs.LogGroup(stack, 'LogGroup');
    const lambdaFunction = new lambda.Function(stack, 'Fn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => ({});'),
      logGroup,
    });
    return { stack, logGroup, lambdaFunction };
  };

  it('returns undefined when failureDetection is omitted or disabled', () => {
    const { stack, logGroup, lambdaFunction } = createStackWithFunction();

    expect(createLambdaFailureDetector(stack, 'DisabledOmitted', {
      lambdaFunction,
      logGroup,
    })).toBeUndefined();

    expect(createLambdaFailureDetector(stack, 'DisabledFalse', {
      failureDetection: { enabled: false },
      lambdaFunction,
      logGroup,
    })).toBeUndefined();

    Template.fromStack(stack).resourceCountIs('AWS::CloudWatch::Alarm', 0);
  });

  it('creates platform Errors alarm and log-filter alarms when enabled', () => {
    const { stack, logGroup, lambdaFunction } = createStackWithFunction();
    const alarmTopic = new sns.Topic(stack, 'Alerts');

    const detector = createLambdaFailureDetector(stack, 'Detector', {
      failureDetection: { enabled: true, alarmTopic },
      lambdaFunction,
      logGroup,
      logFilters: [{
        id: 'CustomFailure',
        filterPattern: '"CustomFailure"',
        metricNamespace: 'TestNamespace',
        metricName: 'CustomFailure',
      }],
    });

    expect(detector).toBeDefined();
    expect(detector?.findLogFilterAlarm('CustomFailure')).toBe(detector?.logFilterAlarms[0]?.alarm);
    expect(detector?.findLogFilterAlarm('Missing')).toBeUndefined();

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::CloudWatch::Alarm', 2);
    template.resourceCountIs('AWS::Logs::MetricFilter', 1);
    template.hasResourceProperties('AWS::Logs::MetricFilter', {
      FilterPattern: '"CustomFailure"',
      MetricTransformations: [{
        MetricNamespace: 'TestNamespace',
        MetricName: 'CustomFailure',
      }],
    });
  });
});
