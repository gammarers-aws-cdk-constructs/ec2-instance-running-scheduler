# EC2 Instance Running Scheduler (CDK v2)

[![npm version](https://img.shields.io/npm/v/ec2-instance-running-scheduler?style=flat-square)](https://www.npmjs.com/package/ec2-instance-running-scheduler)
[![license](https://img.shields.io/npm/l/ec2-instance-running-scheduler?style=flat-square)](https://www.npmjs.com/package/ec2-instance-running-scheduler)
[![Node.js](https://img.shields.io/node/v/ec2-instance-running-scheduler?style=flat-square)](https://www.npmjs.com/package/ec2-instance-running-scheduler)
[![build](https://img.shields.io/github/actions/workflow/status/gammarers-aws-cdk-constructs/ec2-instance-running-scheduler/build.yml?label=build&style=flat-square)](https://github.com/gammarers-aws-cdk-constructs/ec2-instance-running-scheduler/actions/workflows/build.yml)

[![View on Construct Hub](https://constructs.dev/badge?package=ec2-instance-running-scheduler)](https://constructs.dev/packages/ec2-instance-running-scheduler)

AWS CDK construct library that starts and stops EC2 instances on a cron schedule using EventBridge Scheduler and a Durable Execution Lambda. Tagged instances are discovered account-wide, started or stopped in parallel, waited until stable, and reported to Slack via Secrets Manager.

## Features

- **Tag-based targeting** – Select EC2 instances by tag key and values (e.g. `Schedule` / `YES`) via `tag:GetResources`.
- **EventBridge Scheduler** – Separate cron rules for start and stop, with per-rule timezone (`aws-cdk-lib` `TimeZone`).
- **Durable Lambda** – One Lambda with AWS Lambda Durable Execution (`step`, `wait`, `map`, child contexts per instance) for long-running workflows without Step Functions.
- **Stable-state waiting** – After start/stop, waits and re-describes until `running` or `stopped`, with configurable wait limits (`resourceWait`).
- **Configurable Lambda runtime** – Memory, invoke timeout, and bounded concurrency via `runtime`; Durable timeout and retention via `durable`.
- **Slack notifications** – Parent message plus threaded updates per instance; credentials from Secrets Manager JSON (`token`, `channel`).
- **Optional failure detection** – Opt-in CloudWatch alarms via `failureDetection` (`enabled` / optional `alarmTopic`). Uses `LambdaFailureDetector` for platform Lambda `Errors` plus scheduler-specific log filters (`ResourceWaitFailed`, Slack post failures, other handler `ERROR` logs). The construct never creates an SNS topic.
- **Scheduling toggle** – Enable or disable both schedules without removing the stack (`enableScheduling`).

## How it works

1. Tag EC2 instances in the same account and region with the `targetResource` tag key and one of the tag values **before** enabling schedules.
2. EventBridge Scheduler invokes the Lambda alias on the start/stop cron with `Params.TagKey`, `Params.TagValues`, and `Params.Mode` (`Start` or `Stop`).
3. The Durable handler discovers matching instances via the Resource Groups Tagging API, then starts or stops them in parallel (bounded by `runtime.maxConcurrency`).
4. For each instance it waits (`resourceWait`) until the desired stable state, or fails with a `ResourceWaitFailed:*` error.
5. Slack receives a summary and per-instance thread updates when the secret is configured.
6. When `failureDetection.enabled` is `true`, CloudWatch alarms cover Lambda platform errors and the scheduler log filters above. Pass `failureDetection.alarmTopic` to attach SNS actions to an existing topic.

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

Use the **construct** `EC2InstanceRunningScheduler` when embedding the scheduler in an existing stack or other CDK scope.

```typescript
import * as cdk from 'aws-cdk-lib';
import { TimeZone } from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { EC2InstanceRunningScheduler } from 'ec2-instance-running-scheduler';

const app = new cdk.App();
const stack = new cdk.Stack(app, 'MyStack');

const alarmTopic = new sns.Topic(stack, 'OpsAlerts');

new EC2InstanceRunningScheduler(stack, 'EC2InstanceRunningScheduler', {
  targetResource: {
    tagKey: 'Schedule',
    tagValues: ['YES'],
  },
  secrets: {
    slackSecretName: 'my-slack-secret',
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
  enableScheduling: true,
  resourceWait: {
    maxLoopCount: 120,
    maxElapsedSeconds: 3600,
    statusChangeWaitSeconds: 15,
  },
  runtime: {
    memorySize: 1024,
    timeout: cdk.Duration.minutes(15),
    maxConcurrency: 20,
  },
  durable: {
    executionTimeout: cdk.Duration.hours(4),
    retentionPeriod: cdk.Duration.days(7),
  },
  logGroup: {
    retention: logs.RetentionDays.ONE_YEAR,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
  },
  failureDetection: {
    enabled: true,
    alarmTopic,
  },
});
```

Use the **stack** `EC2InstanceRunningScheduleStack` when deploying the scheduler as its own stack. It accepts the same targeting, schedules, secrets, enable flag, and failure detection as the construct (plus standard `StackProps`). For `resourceWait`, `runtime`, `durable`, and `logGroup`, use the construct directly.

```typescript
import * as cdk from 'aws-cdk-lib';
import { TimeZone } from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import { EC2InstanceRunningScheduleStack } from 'ec2-instance-running-scheduler';

const app = new cdk.App();

const alarmTopic = sns.Topic.fromTopicArn(
  app,
  'OpsAlerts',
  'arn:aws:sns:ap-northeast-1:123456789012:ops-alerts',
);

new EC2InstanceRunningScheduleStack(app, 'EC2InstanceRunningScheduleStack', {
  targetResource: {
    tagKey: 'Schedule',
    tagValues: ['YES'],
  },
  secrets: {
    slackSecretName: 'my-slack-secret',
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
  enableScheduling: true,
  failureDetection: {
    enabled: true,
    alarmTopic,
  },
});
```

## Options

### EC2InstanceRunningScheduler

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `targetResource` | `TargetResource` | Yes | Tag key and values used to select EC2 instances. |
| `secrets` | `Secrets` | Yes | Secrets Manager secret for Slack (`slackSecretName`). |
| `startSchedule` | `Schedule` | No | Cron for starting instances (default: `50 7 ? * MON-FRI *` in `Etc/UTC`). |
| `stopSchedule` | `Schedule` | No | Cron for stopping instances (default: `5 19 ? * MON-FRI *` in `Etc/UTC`). |
| `enableScheduling` | `boolean` | No | Whether both scheduler rules are enabled (default: `true`). |
| `resourceWait` | `ResourceWaitLimits` | No | Per-instance wait caps (see below). |
| `runtime` | `RunningSchedulerRuntimeProps` | No | Lambda memory, invoke timeout, and map concurrency. |
| `durable` | `RunningSchedulerDurableProps` | No | Durable execution timeout and history retention. |
| `logGroup` | `RunningSchedulerLogGroupProps` | No | Function log group retention and removal policy. |
| `failureDetection` | `RunningSchedulerFailureDetectionProps` | No | Optional CloudWatch alarms and log-based metrics (see below). |

### EC2InstanceRunningScheduleStack

Includes `targetResource`, `secrets`, `startSchedule`, `stopSchedule`, `enableScheduling`, `failureDetection`, and standard `StackProps`. Does **not** expose `resourceWait`, `runtime`, `durable`, or `logGroup`; use `EC2InstanceRunningScheduler` when you need custom wait, Lambda, Durable, or log settings.

### TargetResource

- `tagKey` – Tag key used to select instances (e.g. `Schedule`). Required on each target instance before schedules run.
- `tagValues` – Tag values that must match (e.g. `['YES']`). At least one value is required.

### Schedule

- `timezone` – `TimeZone` from `aws-cdk-lib` (e.g. `TimeZone.ASIA_TOKYO`, `TimeZone.ETC_UTC`).
- `minute` – Cron minute (`0`–`59`).
- `hour` – Cron hour (`0`–`23`).
- `week` – Cron day-of-week field (e.g. `MON-FRI`).

### Secrets

- `slackSecretName` – Name of the AWS Secrets Manager secret. The Lambda expects JSON with **`token`** (Slack bot token) and **`channel`** (channel ID or name for `chat.postMessage`).

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
- `removalPolicy` – Log group removal policy (default: **`RemovalPolicy.DESTROY`**).

### RunningSchedulerFailureDetectionProps

Extends `LambdaFailureDetection` (`enabled` / `alarmTopic`). Alarms are created only when `enabled` is `true`. Internally uses `LambdaFailureDetector` with scheduler-specific log filters. The construct does **not** create an SNS topic.

- `enabled` – When `true`, creates four CloudWatch alarms and three log metric filters (default: disabled when omitted).
- `alarmTopic` – Optional `sns.ITopic` for alarm actions. When omitted, alarms are created without SNS actions.

When enabled:

| Alarm | Trigger |
|-------|---------|
| Lambda errors | `AWS/Lambda` `Errors` metric (platform) |
| Instance status failure | Log filter: `ResourceWaitFailed` |
| Slack post failure | Log filter: `running-scheduler: Slack post failed` |
| Durable execution failure | Other handler `ERROR` logs (excluding the above) |

Custom metrics use the `EC2InstanceRunningScheduler` namespace. Access created alarms via `EC2InstanceRunningScheduler.failureDetection` when enabled.

## API

See [API.md](./API.md).

## Requirements

- **Node.js** ≥ 20.0.0 (for developing or synthesizing CDK apps that depend on this package).
- **aws-cdk-lib** ^2.232.0 and **constructs** ^10.5.1 (peer dependencies).
- **AWS** – EventBridge Scheduler; Lambda with Durable Execution (Node.js **24.x** runtime in the construct); Parameters and Secrets Lambda Extension; EC2 (`DescribeInstances`, `StartInstances`, `StopInstances`); Resource Groups Tagging API (`tag:GetResources`); Secrets Manager.

## License

This project is licensed under the (Apache-2.0) License.
