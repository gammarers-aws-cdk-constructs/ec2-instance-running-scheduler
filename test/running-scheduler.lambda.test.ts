import { ExecutionStatus, LocalDurableTestRunner, type TestResult } from '@aws/durable-execution-sdk-js-testing';
import {
  DescribeInstancesCommand,
  type DescribeInstancesCommandOutput,
  EC2Client,
  InstanceStateName,
  StartInstancesCommand,
  StopInstancesCommand,
} from '@aws-sdk/client-ec2';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { GetResourcesCommand, ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { WebClient } from '@slack/web-api';
import { secretFetcher } from 'aws-lambda-secret-fetcher';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { handler } from '../src/funcs/running-scheduler.lambda';
import {
  NOTIFICATION_CHANNEL_ENV,
  NOTIFICATION_CHANNEL_EVENT_BRIDGE,
  NOTIFICATION_CHANNEL_SLACK,
  NOTIFICATION_CHANNEL_SNS,
  NOTIFICATION_EVENT_BUS_NAME_ENV,
  NOTIFICATION_TOPIC_ARN_ENV,
  PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV,
  PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV,
  PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS_ENV,
  PROCESS_RESOURCES_MAX_CONCURRENCY_ENV,
  SLACK_SECRET_NAME_ENV,
} from '../src/settings/consts';

const mockPostMessage = jest.fn();

jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn(() => ({
    chat: {
      postMessage: (...args: unknown[]) => mockPostMessage(...args),
    },
  })),
}));

jest.mock('aws-lambda-secret-fetcher', () => ({
  secretFetcher: {
    getSecretValue: jest.fn(),
  },
}));

const SLACK_TOKEN = 'xoxb-checkpoint-secret-token';
const SLACK_CHANNEL = 'C-CHECKPOINT-SECRET';
const THREAD_TS = '1700000000.000100';
const INSTANCE_ARN = 'arn:aws:ec2:ap-northeast-1:123456789012:instance/i-checkpoint123';
const INSTANCE_ID = 'i-checkpoint123';
const TOPIC_ARN = 'arn:aws:sns:ap-northeast-1:123456789012:scheduler-topic';
const EVENT_BUS_NAME = 'scheduler-bus';
const SLACK_TIMEOUT_MS = 30_000;
const SLACK_RETRY_COUNT = 2;

const ENV_KEYS = [
  NOTIFICATION_CHANNEL_ENV,
  SLACK_SECRET_NAME_ENV,
  NOTIFICATION_TOPIC_ARN_ENV,
  NOTIFICATION_EVENT_BUS_NAME_ENV,
  PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV,
  PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV,
  PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS_ENV,
  PROCESS_RESOURCES_MAX_CONCURRENCY_ENV,
] as const;

const ec2Mock = mockClient(EC2Client);
const taggingMock = mockClient(ResourceGroupsTaggingAPIClient);
const snsMock = mockClient(SNSClient);
const eventsMock = mockClient(EventBridgeClient);

const described = (stateName: InstanceStateName) => ({
  Reservations: [{ Instances: [{ State: { Name: stateName } }] }],
} satisfies Partial<DescribeInstancesCommandOutput>);

const startEvent = (mode: 'Start' | 'Stop' = 'Start') => ({
  Params: {
    TagKey: 'Schedule',
    TagValues: ['YES'],
    Mode: mode,
  },
});

const historyText = (execution: TestResult): string => JSON.stringify(execution.getHistoryEvents());

const mockedGetSecretValue = (): jest.Mock => {
  if (!jest.isMockFunction(secretFetcher.getSecretValue)) {
    throw new Error('secretFetcher.getSecretValue is not mocked');
  }
  return secretFetcher.getSecretValue;
};

const mockedWebClient = (): jest.Mock => {
  if (!jest.isMockFunction(WebClient)) {
    throw new Error('WebClient is not mocked');
  }
  return WebClient;
};

const clearSchedulerEnv = (): void => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  process.env[PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS_ENV] = '1';
  process.env[PROCESS_RESOURCES_MAX_CONCURRENCY_ENV] = '2';
};

const useSlack = (): void => {
  process.env[NOTIFICATION_CHANNEL_ENV] = NOTIFICATION_CHANNEL_SLACK;
  process.env[SLACK_SECRET_NAME_ENV] = 'slack/secret';
};

const useSns = (): void => {
  process.env[NOTIFICATION_CHANNEL_ENV] = NOTIFICATION_CHANNEL_SNS;
  process.env[NOTIFICATION_TOPIC_ARN_ENV] = TOPIC_ARN;
};

const useEventBridge = (): void => {
  process.env[NOTIFICATION_CHANNEL_ENV] = NOTIFICATION_CHANNEL_EVENT_BRIDGE;
  process.env[NOTIFICATION_EVENT_BUS_NAME_ENV] = EVENT_BUS_NAME;
};

const allowStartAndStop = (): void => {
  ec2Mock.on(StartInstancesCommand).resolves({});
  ec2Mock.on(StopInstancesCommand).resolves({});
};

const describeStates = (...states: readonly InstanceStateName[]): void => {
  ec2Mock.reset();
  let chain = ec2Mock.on(DescribeInstancesCommand);
  for (const state of states) {
    chain = chain.resolvesOnce(described(state));
  }
  const last = states[states.length - 1];
  if (last !== undefined) {
    chain.resolves(described(last));
  }
  allowStartAndStop();
};

let runner: LocalDurableTestRunner;

beforeAll(async () => {
  await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
  runner = new LocalDurableTestRunner({ handlerFunction: handler });
});

afterAll(async () => {
  await LocalDurableTestRunner.teardownTestEnvironment();
});

beforeEach(() => {
  runner.reset();
  ec2Mock.reset();
  taggingMock.reset();
  snsMock.reset();
  eventsMock.reset();
  mockPostMessage.mockReset();
  mockPostMessage.mockResolvedValue({ ok: true, ts: THREAD_TS });
  mockedGetSecretValue().mockReset();
  mockedGetSecretValue().mockResolvedValue({ token: SLACK_TOKEN, channel: SLACK_CHANNEL });
  mockedWebClient().mockClear();
  clearSchedulerEnv();
  ec2Mock.on(DescribeInstancesCommand).resolves(described('running'));
  allowStartAndStop();
  taggingMock.on(GetResourcesCommand).resolves({
    ResourceTagMappingList: [{ ResourceARN: INSTANCE_ARN }],
  });
  snsMock.on(PublishCommand).resolves({});
  eventsMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });
});

describe('running scheduler slack checkpoint', () => {
  it('keeps the thread timestamp and leaves the token and channel out of the history', async () => {
    useSlack();
    taggingMock.on(GetResourcesCommand).resolves({
      ResourceTagMappingList: [
        { ResourceARN: INSTANCE_ARN },
        { ResourceARN: undefined },
      ],
    });

    const execution = await runner.run({ payload: startEvent() });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(execution.getResult()).toEqual({
      status: 'Completed',
      processed: 1,
      results: [{
        identifier: INSTANCE_ID,
        account: '123456789012',
        region: 'ap-northeast-1',
        resource: INSTANCE_ARN,
        status: 'running',
      }],
    });
    const history = historyText(execution);
    expect(history).toContain(INSTANCE_ID);
    expect(history).toContain(THREAD_TS);
    expect(history).not.toContain(SLACK_TOKEN);
    expect(history).not.toContain(SLACK_CHANNEL);
    expect(runner.getOperation('post-slack-messages').getStepDetails()?.result).toBe(THREAD_TS);
    const names = execution.getOperations().map((operation) => operation.getName());
    expect(names).not.toContain('fetch-slack-secret');
    expect(names).toEqual([
      'get-target-resources',
      'post-slack-messages',
      undefined,
      'map-item-0',
      'resource-0',
      'resource-0-i-checkpoint123-wait-started-at',
      'resource-0-i-checkpoint123-wait-limit-check-0',
      'resource-0-i-checkpoint123-describe-0',
      'post-slack-child-messages',
    ]);
    expect(mockedWebClient()).toHaveBeenCalledTimes(2);
    expect(mockedWebClient()).toHaveBeenCalledWith(SLACK_TOKEN, {
      timeout: SLACK_TIMEOUT_MS,
      retryConfig: { retries: SLACK_RETRY_COUNT },
    });
    expect(mockPostMessage).toHaveBeenNthCalledWith(1, {
      channel: SLACK_CHANNEL,
      text: '😆 Starts the scheduled EC2 Instance.',
    });
    expect(mockPostMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      channel: SLACK_CHANNEL,
      thread_ts: THREAD_TS,
    }));
    expect(ec2Mock).not.toHaveReceivedCommand(StartInstancesCommand);
  });

  it.each([
    ['null', null],
    ['a string', 'not-json'],
    ['missing token', { channel: SLACK_CHANNEL }],
    ['missing channel', { token: SLACK_TOKEN }],
    ['an empty token', { token: '', channel: SLACK_CHANNEL }],
    ['an empty channel', { token: SLACK_TOKEN, channel: '' }],
    ['a non-string token', { token: 1, channel: SLACK_CHANNEL }],
    ['a non-string channel', { token: SLACK_TOKEN, channel: 1 }],
  ])('fails before start when the secret is %s', async (_label, secret) => {
    useSlack();
    mockedGetSecretValue().mockResolvedValue(secret);

    const execution = await runner.run({ payload: startEvent() });

    expect(execution.getStatus()).toBe(ExecutionStatus.FAILED);
    expect(execution.getError().errorMessage).toBe('Slack secret must contain token and channel.');
    expect(ec2Mock).not.toHaveReceivedCommand(DescribeInstancesCommand);
    expect(ec2Mock).not.toHaveReceivedCommand(StartInstancesCommand);
    const history = historyText(execution);
    expect(history).not.toContain(SLACK_TOKEN);
    expect(history).not.toContain(SLACK_CHANNEL);
  });

  it('continues when the parent post fails and the reply has no thread timestamp', async () => {
    useSlack();
    mockPostMessage.mockRejectedValueOnce(new Error('slack parent down'));

    const execution = await runner.run({ payload: startEvent() });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(runner.getOperation('post-slack-messages').getStepDetails()?.result).toBe('');
    expect(mockPostMessage).toHaveBeenNthCalledWith(2, expect.not.objectContaining({
      thread_ts: expect.anything(),
    }));
  });

  it('continues when Slack rejects the parent post with a non-Error', async () => {
    useSlack();
    mockPostMessage.mockRejectedValue('slack parent plain');

    const execution = await runner.run({ payload: startEvent() });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(historyText(execution)).not.toContain(SLACK_TOKEN);
  });

  it('continues when the thread reply fails', async () => {
    useSlack();
    mockPostMessage.mockResolvedValueOnce({ ok: true, ts: THREAD_TS });
    mockPostMessage.mockRejectedValueOnce(new Error('slack thread down'));

    const execution = await runner.run({ payload: startEvent() });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
  });

  it('treats a parent post without a timestamp as no thread', async () => {
    useSlack();
    mockPostMessage.mockResolvedValueOnce({ ok: true });

    const execution = await runner.run({ payload: startEvent() });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(mockPostMessage).toHaveBeenNthCalledWith(2, expect.not.objectContaining({
      thread_ts: expect.anything(),
    }));
  });
});

describe('running scheduler instance processing', () => {
  it('starts a stopped instance and reports logs', async () => {
    describeStates('stopped', 'running');

    const execution = await runner.run({ payload: startEvent('Start') });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(execution.getResult()).toEqual(expect.objectContaining({
      status: 'Completed',
      processed: 1,
    }));
    expect(ec2Mock).toHaveReceivedCommandWith(StartInstancesCommand, { InstanceIds: [INSTANCE_ID] });
    expect(ec2Mock).not.toHaveReceivedCommand(StopInstancesCommand);
    expect(execution.getOperations().map((operation) => operation.getName())).toContain('log-notification');
  });

  it('stops a running instance', async () => {
    describeStates('running', 'stopped');

    const execution = await runner.run({ payload: startEvent('Stop') });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(ec2Mock).toHaveReceivedCommandWith(StopInstancesCommand, { InstanceIds: [INSTANCE_ID] });
    expect(ec2Mock).not.toHaveReceivedCommand(StartInstancesCommand);
    const result = execution.getResult() as { results: Array<{ status: string }> };
    expect(result.results[0]?.status).toBe('stopped');
  });

  it('does not start an instance that is already running', async () => {
    const execution = await runner.run({ payload: startEvent('Start') });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(ec2Mock).not.toHaveReceivedCommand(StartInstancesCommand);
  });

  it('does not stop an instance that is already stopped', async () => {
    describeStates('stopped');

    const execution = await runner.run({ payload: startEvent('Stop') });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(ec2Mock).not.toHaveReceivedCommand(StopInstancesCommand);
  });

  it('waits while a start is pending', async () => {
    describeStates('pending', 'running');

    const execution = await runner.run({ payload: startEvent('Start') });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(ec2Mock).not.toHaveReceivedCommand(StartInstancesCommand);
    expect(ec2Mock).toHaveReceivedCommandTimes(DescribeInstancesCommand, 2);
  });

  it.each<InstanceStateName>(['stopping', 'shutting-down'])('waits while a stop is %s', async (state) => {
    describeStates(state, 'stopped');

    const execution = await runner.run({ payload: startEvent('Stop') });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(ec2Mock).not.toHaveReceivedCommand(StopInstancesCommand);
  });

  it('fails when the instance state is unexpected', async () => {
    describeStates('terminated');

    const execution = await runner.run({ payload: startEvent('Start') });

    expect(execution.getStatus()).toBe(ExecutionStatus.FAILED);
    expect(execution.getError().errorMessage).toContain('ResourceWaitFailed:UnexpectedInstanceState');
    expect(execution.getError().errorMessage).toContain(INSTANCE_ID);
  });

  it('fails when describe omits the state name', async () => {
    ec2Mock.reset();
    ec2Mock.on(DescribeInstancesCommand).resolves({ Reservations: [{ Instances: [{}] }] });
    allowStartAndStop();

    const execution = await runner.run({ payload: startEvent('Start') });

    expect(execution.getStatus()).toBe(ExecutionStatus.FAILED);
    expect(execution.getError().errorMessage).toContain('currentState=unknown');
  });

  it('fails when the wait loop count is exceeded', async () => {
    process.env[PROCESS_RESOURCE_MAX_LOOP_COUNT_ENV] = '1';
    describeStates('pending');

    const execution = await runner.run({ payload: startEvent('Start') });

    expect(execution.getStatus()).toBe(ExecutionStatus.FAILED);
    expect(execution.getError().errorMessage).toContain('ResourceWaitFailed:MaxLoopCountExceeded');
  });

  it('fails when the wait elapsed time is exceeded', async () => {
    process.env[PROCESS_RESOURCE_MAX_ELAPSED_SECONDS_ENV] = '1';
    describeStates('pending');
    let clock = 1_700_000_000_000;
    const dateNow = jest.spyOn(Date, 'now').mockImplementation(() => {
      clock += 1_500;
      return clock;
    });
    try {
      const execution = await runner.run({ payload: startEvent('Start') });
      expect(execution.getStatus()).toBe(ExecutionStatus.FAILED);
      expect(execution.getError().errorMessage).toContain('ResourceWaitFailed:MaxElapsedTimeExceeded');
      expect(execution.getError().errorMessage).toContain('currentState=unknown');
    } finally {
      dateNow.mockRestore();
    }
  });

  it('parses an instance id that is not a full ARN', async () => {
    taggingMock.on(GetResourcesCommand).resolves({
      ResourceTagMappingList: [{ ResourceARN: 'i-short' }],
    });
    ec2Mock.reset();
    ec2Mock.on(DescribeInstancesCommand).resolves(described('running'));
    allowStartAndStop();

    const execution = await runner.run({ payload: startEvent('Start') });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(execution.getResult()).toEqual(expect.objectContaining({
      results: [expect.objectContaining({
        identifier: 'i-short',
        account: '',
        region: '',
        resource: 'i-short',
      })],
    }));
  });

  it('returns TargetResourcesNotFound when the tag page is omitted', async () => {
    taggingMock.on(GetResourcesCommand).resolves({});

    const execution = await runner.run({ payload: startEvent() });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(execution.getResult()).toEqual({ status: 'TargetResourcesNotFound' });
    expect(mockedGetSecretValue()).not.toHaveBeenCalled();
  });

  it('returns TargetResourcesNotFound when no instance matches', async () => {
    taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [] });

    const execution = await runner.run({ payload: startEvent() });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(execution.getResult()).toEqual({ status: 'TargetResourcesNotFound' });
  });

  it('processes instances from every tag page', async () => {
    const secondArn = 'arn:aws:ec2:ap-northeast-1:123456789012:instance/i-page2';
    taggingMock.reset();
    taggingMock.on(GetResourcesCommand)
      .resolvesOnce({
        PaginationToken: 'page-2',
        ResourceTagMappingList: [{ ResourceARN: INSTANCE_ARN }],
      })
      .resolves({
        ResourceTagMappingList: [{ ResourceARN: secondArn }],
      });

    const execution = await runner.run({ payload: startEvent() });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(taggingMock).toHaveReceivedCommandTimes(GetResourcesCommand, 2);
    expect(taggingMock).toHaveReceivedNthCommandWith(2, GetResourcesCommand, { PaginationToken: 'page-2' });
    expect(execution.getResult()).toEqual(expect.objectContaining({
      processed: 2,
      results: [
        expect.objectContaining({ identifier: INSTANCE_ID }),
        expect.objectContaining({ identifier: 'i-page2' }),
      ],
    }));
  });

  it.each([
    ['omitted', undefined],
    ['missing Params', {}],
    ['missing TagKey', { Params: { TagValues: ['YES'], Mode: 'Start' } }],
    ['missing TagValues', { Params: { TagKey: 'Schedule', Mode: 'Start' } }],
    ['missing Mode', { Params: { TagKey: 'Schedule', TagValues: ['YES'] } }],
  ])('fails when the payload is %s', async (_label, payload) => {
    const execution = await runner.run({ payload });

    expect(execution.getStatus()).toBe(ExecutionStatus.FAILED);
    expect(execution.getError().errorMessage).toBe(
      'Invalid event: Params.TagKey, Params.TagValues, Params.Mode are required.',
    );
    expect(taggingMock).not.toHaveReceivedCommand(GetResourcesCommand);
  });
});

describe('running scheduler notifications', () => {
  it('publishes one SNS message and leaves the topic ARN out of the history', async () => {
    useSns();

    const execution = await runner.run({ payload: startEvent() });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(snsMock).toHaveReceivedCommandWith(PublishCommand, {
      TopicArn: TOPIC_ARN,
      Subject: '😆 Starts the scheduled EC2 Instance.',
      Message: expect.stringContaining(INSTANCE_ID),
    });
    const history = historyText(execution);
    expect(history).toContain(INSTANCE_ID);
    expect(history).not.toContain(TOPIC_ARN);
  });

  it('continues when SNS publish fails', async () => {
    useSns();
    snsMock.reset();
    snsMock.on(PublishCommand).rejects(new Error('sns down'));

    const execution = await runner.run({ payload: startEvent() });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
  });

  it('continues when SNS publish rejects a non-Error', async () => {
    useSns();
    snsMock.reset();
    snsMock.on(PublishCommand).callsFake(() => Promise.reject('sns plain'));

    const execution = await runner.run({ payload: startEvent() });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
  });

  it('publishes one EventBridge event', async () => {
    useEventBridge();
    describeStates('stopped');

    const execution = await runner.run({ payload: startEvent('Stop') });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(eventsMock).toHaveReceivedCommandWith(PutEventsCommand, {
      Entries: [expect.objectContaining({
        EventBusName: EVENT_BUS_NAME,
        Source: 'ec2-instance-running-scheduler',
        DetailType: 'EC2InstanceRunningScheduler.Completed',
      })],
    });
    expect(historyText(execution)).not.toContain(EVENT_BUS_NAME);
  });

  it('continues when PutEvents omits the failed entry count', async () => {
    useEventBridge();
    eventsMock.reset();
    eventsMock.on(PutEventsCommand).resolves({});

    const execution = await runner.run({ payload: startEvent() });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
  });

  it('continues when PutEvents reports an entry error', async () => {
    useEventBridge();
    eventsMock.reset();
    eventsMock.on(PutEventsCommand).resolves({
      FailedEntryCount: 1,
      Entries: [{ ErrorMessage: 'bus down' }],
    });

    const execution = await runner.run({ payload: startEvent() });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
  });

  it('continues when a failed PutEvents entry has no message', async () => {
    useEventBridge();
    eventsMock.reset();
    eventsMock.on(PutEventsCommand).resolves({
      FailedEntryCount: 1,
      Entries: [{}],
    });

    const execution = await runner.run({ payload: startEvent() });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
  });

  it('continues when PutEvents throws', async () => {
    useEventBridge();
    eventsMock.reset();
    eventsMock.on(PutEventsCommand).callsFake(() => Promise.reject(new Error('events down')));

    const execution = await runner.run({ payload: startEvent() });

    expect(execution.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
  });
});
