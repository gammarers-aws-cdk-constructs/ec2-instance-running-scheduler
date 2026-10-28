# EC2 Instance Running Scheduler (CDK v2)

[![npm version](https://img.shields.io/npm/v/ec2-instance-running-scheduler?style=flat-square)](https://www.npmjs.com/package/ec2-instance-running-scheduler)
[![license](https://img.shields.io/npm/l/ec2-instance-running-scheduler?style=flat-square)](https://www.npmjs.com/package/ec2-instance-running-scheduler)
[![Node.js](https://img.shields.io/node/v/ec2-instance-running-scheduler?style=flat-square)](https://www.npmjs.com/package/ec2-instance-running-scheduler)
[![build](https://img.shields.io/github/actions/workflow/status/gammarers-aws-cdk-constructs/ec2-instance-running-scheduler/build.yml?label=build&style=flat-square)](https://github.com/gammarers-aws-cdk-constructs/ec2-instance-running-scheduler/actions/workflows/build.yml)

[![View on Construct Hub](https://constructs.dev/badge?package=ec2-instance-running-scheduler)](https://constructs.dev/packages/ec2-instance-running-scheduler)

AWS CDK construct library that starts and stops tagged EC2 instances on a cron schedule with EventBridge Scheduler and a Durable Execution Lambda, and optionally reports results to CloudWatch Logs, Slack, Amazon SNS, or an EventBridge custom bus.

## Features

- **Tag-based targeting** – Select EC2 instances by tag key and values (e.g. `Schedule` / `YES`) via `tag:GetResources`.
- **EventBridge Scheduler** – Separate cron rules for start and stop, with per-rule timezone (`aws-cdk-lib` `TimeZone`).
- **Durable Lambda** – One Lambda with AWS Lambda Durable Execution (`step`, `wait`, `map`, child contexts per instance) for long-running workflows without Step Functions.
- **Stable-state waiting** – After start/stop, waits and re-describes until `running` or `stopped`, with configurable wait limits (`resourceWait`).
- **Configurable Lambda runtime** – Memory, invoke timeout, and bounded concurrency via `runtime`; Durable timeout and retention via `durable`.
- **Optional notification** – Omit `notification` to log only. Otherwise choose one channel: Slack (parent message and thread replies), Amazon SNS (one plain-text message, including email subscriptions), or an EventBridge custom bus (one JSON event). A send failure is logged and does not fail the instance run.
- **Optional failure detection** – Opt-in CloudWatch alarms via `failureDetection` (`enabled` / optional `alarmTopic`). Uses [`lambda-failure-detector`](https://www.npmjs.com/package/lambda-failure-detector) for platform Lambda `Errors` and `Throttles`, plus scheduler-specific log filters (`ResourceWaitFailed`, notification send failures, other handler `ERROR` logs). The construct never creates an SNS topic for alarms.
- **Scheduling toggle** – Enable or disable both schedules without removing the stack (`enableScheduling`).

## How it works

1. Tag EC2 instances in the same account and region with the `targetResource` tag key and one of the tag values **before** enabling schedules.
2. EventBridge Scheduler invokes the Lambda alias on the start/stop cron with `Params.TagKey`, `Params.TagValues`, and `Params.Mode` (`Start` or `Stop`).
3. The Durable handler discovers matching instances via the Resource Groups Tagging API, then starts or stops them in parallel (bounded by `runtime.maxConcurrency`).
4. For each instance it waits (`resourceWait`) until the desired stable state, or fails with a `ResourceWaitFailed:*` error. Defaults are 90 loops, 1800 seconds, and 20 seconds between describes. Lambda invoke `timeout` defaults to 15 minutes. Durable `executionTimeout` defaults to 2 hours and `retentionPeriod` to 1 day.
5. When no instance matches, the run returns `TargetResourcesNotFound` and sends nothing.
6. When instances were processed, the selected channel reports the result:
   - **Omitted `notification`** – the same plain text is written to the function log. No Slack, SNS, or EventBridge permission is added.
   - **Slack** – a parent message, then one thread reply per instance. The secret is read with the Parameters and Secrets Lambda Extension.
   - **SNS** – one plain-text publish after every instance finishes. Email subscriptions show that text; HTML is not used.
   - **EventBridge** – one `PutEvents` call to the bus you pass. This construct does not create the bus or a rule.
7. A Slack, SNS, or EventBridge send failure is logged as `running-scheduler: notification post failed` and the run still completes. A Slack secret that is not JSON with `token` and `channel` throws.
8. When `failureDetection.enabled` is `true`, CloudWatch alarms cover Lambda `Errors`, Lambda `Throttles`, and the scheduler log filters above. Pass `failureDetection.alarmTopic` to attach SNS actions to an existing topic. That topic is separate from `notification`.

**Tag an instance (AWS CLI)**

```bash
aws ec2 create-tags \
  --resources i-0123456789abcdef0 \
  --tags Key=Schedule,Value=YES
```

Start/stop IAM is limited to instance ARNs in the stack account and region whose `aws:ResourceTag/<tagKey>` matches `tagValues`. `tag:GetResources` and `ec2:DescribeInstances` still use `Resource: *` because those APIs do not support resource-level permissions or resource-tag conditions.

## Installation

### npm

```bash
npm install ec2-instance-running-scheduler
```

### yarn

```bash
yarn add ec2-instance-running-scheduler
```

### pnpm

```bash
pnpm add ec2-instance-running-scheduler
```

## Usage

### Minimal deployable app

Use `EC2InstanceRunningScheduleStack` when you want a dedicated stack you can deploy as-is. With `notification` omitted, results are written to the function log only.

```typescript
import { App, TimeZone } from 'aws-cdk-lib';
import { EC2InstanceRunningScheduleStack } from 'ec2-instance-running-scheduler';

const app = new App();

new EC2InstanceRunningScheduleStack(app, 'EC2InstanceRunningScheduleStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  targetResource: {
    tagKey: 'Schedule',
    tagValues: ['YES'],
  },
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

app.synth();
```

Deploy checklist:

1. Install this package and peers (`aws-cdk-lib`, `constructs`, `lambda-failure-detector`) in your CDK app.
2. Tag each target instance with `Schedule=YES` in the same account and region before the schedules run.
3. From the CDK app: `npx cdk deploy EC2InstanceRunningScheduleStack`

### Embed in an existing stack

Use `EC2InstanceRunningScheduler` when the scheduler shares a stack with other resources. Put the SNS topic in that stack and subscribe the email protocol yourself. The construct grants `sns:Publish` on that topic and does not create the subscription. The message is plain text: the subject is `😆 Starts the scheduled EC2 Instance.` or `🥱 Stops the scheduled EC2 Instance.`, and the body is one block per instance (emoji, account, region, identifier, status).

```typescript
import * as cdk from 'aws-cdk-lib';
import { TimeZone } from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import { EC2InstanceRunningScheduler } from 'ec2-instance-running-scheduler';

const app = new cdk.App();
const stack = new cdk.Stack(app, 'MyStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

const mailTopic = new sns.Topic(stack, 'SchedulerMail');

new EC2InstanceRunningScheduler(stack, 'EC2InstanceRunningScheduler', {
  targetResource: {
    tagKey: 'Schedule',
    tagValues: ['YES'],
  },
  notification: {
    channel: 'sns',
    topic: mailTopic,
  },
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

app.synth();
```

Slack uses a secret you create before deploy. The construct grants read on that secret and attaches the Parameters and Secrets Lambda Extension. You do not add that permission yourself. The secret JSON is `{ "token": "<bot token>", "channel": "<channel id>" }`.

```typescript
notification: {
  channel: 'slack',
  slackSecretName: 'my-slack-secret',
},
```

An EventBridge custom bus works the same way: pass `channel: 'eventBridge'` and an `events.IEventBus`. The construct grants `events:PutEvents` on that bus and does not create the bus or a rule. The event source is `ec2-instance-running-scheduler` and the detail type is `EC2InstanceRunningScheduler.Completed`. The detail JSON includes `mode`, `subject`, `message`, and `instances`.

## Options

### EC2InstanceRunningScheduler

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `targetResource` | `TargetResource` | Yes | Tag key and values used to select EC2 instances. |
| `notification` | `RunningSchedulerNotification` | No | One channel: Slack, SNS, or EventBridge. Omit to log only. |
| `startSchedule` | `Schedule` | No | Cron for starting instances (default: `50 7 ? * MON-FRI *` in `Etc/UTC`). |
| `stopSchedule` | `Schedule` | No | Cron for stopping instances (default: `5 19 ? * MON-FRI *` in `Etc/UTC`). |
| `enableScheduling` | `boolean` | No | Whether both scheduler rules are enabled (default: `true`). |
| `resourceWait` | `ResourceWaitLimits` | No | Per-instance wait caps (see below). |
| `runtime` | `RunningSchedulerRuntimeProps` | No | Lambda memory, invoke timeout, and map concurrency. |
| `durable` | `RunningSchedulerDurableProps` | No | Durable execution timeout and history retention. |
| `logGroup` | `RunningSchedulerLogGroupProps` | No | Function log group retention and removal policy. |
| `failureDetection` | `RunningSchedulerFailureDetectionProps` | No | Optional CloudWatch alarms and log-based metrics (see below). |

### EC2InstanceRunningScheduleStack

Accepts every `EC2InstanceRunningScheduler` prop (`targetResource`, `notification`, `startSchedule`, `stopSchedule`, `enableScheduling`, `resourceWait`, `runtime`, `durable`, `logGroup`, `failureDetection`) plus standard `StackProps`. The stack forwards those scheduler fields to `EC2InstanceRunningScheduler`.

### TargetResource

- `tagKey` – Tag key used to select instances (e.g. `Schedule`). Required on each target instance before schedules run.
- `tagValues` – Tag values that must match (e.g. `['YES']`). At least one value is required.

### Schedule

- `timezone` – `TimeZone` from `aws-cdk-lib` (e.g. `TimeZone.ASIA_TOKYO`, `TimeZone.ETC_UTC`).
- `minute` – Cron minute (`0`–`59`).
- `hour` – Cron hour (`0`–`23`).
- `week` – Cron day-of-week field (e.g. `MON-FRI`).

### RunningSchedulerNotification

Pass one channel. Omit the prop to log only.

- `{ channel: 'slack', slackSecretName }` – Secrets Manager secret name. The Lambda expects JSON with **`token`** (Slack bot token) and **`channel`** (channel id for `chat.postMessage`). A blank name fails synthesis.
- `{ channel: 'sns', topic }` – Existing `sns.ITopic`. Email subscriptions receive one plain-text message per run.
- `{ channel: 'eventBridge', eventBus }` – Existing `events.IEventBus`. One `PutEvents` call per run.

### ResourceWaitLimits

Written to `PROCESS_RESOURCE_MAX_LOOP_COUNT`, `PROCESS_RESOURCE_MAX_ELAPSED_SECONDS`, and `PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS` on the running scheduler Lambda.

- `maxLoopCount` – Maximum describe/wait loop iterations per instance (default: **90**). Must be a positive integer when set.
- `maxElapsedSeconds` – Maximum wall-clock seconds spent waiting for one instance to stabilize (default: **1800**, 30 minutes). Must be a positive integer when set.
- `statusChangeWaitSeconds` – Seconds between describe iterations after start/stop or while transitioning (default: **20**). Must be a positive integer when set.

When a limit is exceeded during waiting, the handler throws an error with prefix `ResourceWaitFailed:` (`MaxLoopCountExceeded`, `MaxElapsedTimeExceeded`, or `UnexpectedInstanceState` for unknown EC2 states).

### RunningSchedulerRuntimeProps

Lambda invoke settings. Written `maxConcurrency` to `PROCESS_RESOURCES_MAX_CONCURRENCY`.

- `memorySize` – Memory in MB (default: **512**). Must be a positive integer when set.
- `timeout` – Lambda invoke timeout (default: **15 minutes**). AWS maximum is 15 minutes; durable waits continue under `durable.executionTimeout`.
- `maxConcurrency` – Max instances processed in parallel (default: **10**). Must be a positive integer when set. Increase with instance count.

### RunningSchedulerDurableProps

- `executionTimeout` – Maximum durable execution duration (default: **2 hours**). Increase when many instances wait in sequence of batches.
- `retentionPeriod` – Durable execution history retention (default: **1 day**).

### RunningSchedulerLogGroupProps

- `retention` – CloudWatch Logs retention (default: **`RetentionDays.THREE_MONTHS`**).
- `removalPolicy` – Log group removal policy (default: **`RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE`**). A failed create deletes the log group. After a successful create, stack deletion and replacement keep the logs (`DeletionPolicy: RetainExceptOnCreate`, `UpdateReplacePolicy: Retain`).

### RunningSchedulerFailureDetectionProps

Extends `LambdaFailureDetection` from `lambda-failure-detector` (`enabled` / `alarmTopic`). Alarms are created only when `enabled` is `true`. The scheduler adds its own log filters on top of that package's platform alarms. The construct does **not** create an SNS topic.

- `enabled` – When `true`, creates five CloudWatch alarms and three log metric filters (default: disabled when omitted).
- `alarmTopic` – Optional `sns.ITopic` for alarm actions. When omitted, alarms are created without SNS actions.

When enabled:

| Alarm | Trigger |
|-------|---------|
| Lambda errors | `AWS/Lambda` `Errors` metric (platform) |
| Lambda throttles | `AWS/Lambda` `Throttles` metric (platform) |
| Instance status failure | Log filter: `ResourceWaitFailed` |
| Notification post failure | Log filter: `running-scheduler: notification post failed` |
| Durable execution failure | Other handler `ERROR` logs (excluding the above) |

Custom metrics use the `EC2InstanceRunningScheduler` namespace. Access created alarms via `EC2InstanceRunningScheduler.failureDetection` when enabled.

## API

See [API.md](./API.md).

## Requirements

- **Node.js** ≥ 20.0.0 (for developing or synthesizing CDK apps that depend on this package).
- **aws-cdk-lib** ^2.232.0, **constructs** ^10.5.1, and **lambda-failure-detector** ^0.2.1 (peer dependencies).
- **AWS** – EventBridge Scheduler; Lambda with Durable Execution (Node.js **24.x** runtime in the construct); EC2 (`DescribeInstances`, `StartInstances`, `StopInstances`); Resource Groups Tagging API (`tag:GetResources`). Slack also needs Secrets Manager and the Parameters and Secrets Lambda Extension. SNS needs `sns:Publish` on the topic you pass. EventBridge needs `events:PutEvents` on the bus you pass. The construct adds those permissions for the channel you select.

## Notes

- Choose one notification channel. Logs, Slack, SNS, and EventBridge are not combined.
- The construct does not create an SNS topic, an email subscription, or an EventBridge bus. Alarm topics are also passed in and are separate from `notification`.
- SNS email is the plain-text `Message`. The `Subject` is the same parent line Slack uses. Emoji are included. HTML is not sent.
- A notification send failure does not fail the start/stop run. A Slack secret with the wrong JSON shape does.
- Start/stop IAM allows `ec2:StartInstances` and `ec2:StopInstances` only on instances in this account and region whose tag matches `targetResource`. Describe and tag lookup remain `Resource: *` because those APIs do not support resource-level permissions.

## Troubleshooting

- **No Slack message, email, or event** – The function log group (default retention three months) is the place to look. After a successful create, stack deletion keeps that group (`RetainExceptOnCreate`). Omit `notification` and the run only writes `running-scheduler: notification` there. If the tag matches nothing, the run returns `TargetResourcesNotFound` and does not send.
- **Slack fails before any instance starts** – The secret must be JSON with non-empty `token` and `channel`. That configuration error fails the run. A later `chat.postMessage` error is logged as `running-scheduler: notification post failed` and does not fail the run.
- **SNS topic has no email** – Add an email subscription on the topic you passed. The scheduler only publishes.

## License

This project is licensed under the (Apache-2.0) License.
