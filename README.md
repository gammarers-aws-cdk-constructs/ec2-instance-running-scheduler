# EC2 Instance Running Scheduler (AWS CDK v2)

[![GitHub](https://img.shields.io/github/license/gammarers-aws-cdk-constructs/ec2-instance-running-scheduler?style=flat-square)](https://github.com/gammarers-aws-cdk-constructs/ec2-instance-running-scheduler/blob/main/LICENSE)
[![npm](https://img.shields.io/npm/v/ec2-instance-running-scheduler?style=flat-square)](https://www.npmjs.com/package/ec2-instance-running-scheduler)
[![GitHub Workflow Status (branch)](https://img.shields.io/github/actions/workflow/status/gammarers-aws-cdk-constructs/ec2-instance-running-scheduler/release.yml?branch=main&label=release&style=flat-square)](https://github.com/gammarers-aws-cdk-constructs/ec2-instance-running-scheduler/actions/workflows/release.yml)
[![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/gammarers-aws-cdk-constructs/ec2-instance-running-scheduler?sort=semver&style=flat-square)](https://github.com/gammarers-aws-cdk-constructs/ec2-instance-running-scheduler/releases)

[![View on Construct Hub](https://constructs.dev/badge?package=ec2-instance-running-scheduler)](https://constructs.dev/packages/ec2-instance-running-scheduler)

AWS CDK construct library that starts and stops EC2 instances on a cron schedule using **EventBridge Scheduler** and a **Durable Execution Lambda**. The handler discovers instances with the **Resource Groups Tagging API**, issues start/stop, **waits until each instance reaches a stable target state** (durable `step` / `wait`), processes **multiple instances in parallel** (bounded concurrency), and posts **Slack** summary and per-instance thread messages using a secret from **Secrets Manager**. The Lambda emits **structured application logs** alongside JSON platform logs.

## Features

- **Tag-based targeting** – Select EC2 instances by tag key and values (e.g. `Schedule` / `YES`) via `tag:GetResources`.
- **EventBridge Scheduler** – Separate cron rules for start and stop, with per-rule timezone (`aws-cdk-lib` `TimeZone`).
- **Durable Lambda** – One Lambda with AWS Lambda Durable Execution (`step`, `wait`, `map`, child contexts per instance) for long-running workflows without Step Functions.
- **Stable-state waiting** – After start/stop, the function waits (`resourceWait.statusChangeWaitSeconds`, default **20** seconds between attempts) and re-describes instances until `running` (start mode) or `stopped` (stop mode).
- **Configurable wait limits** – Per-instance **max loop count**, **max elapsed time**, and **status-change wait interval** via `resourceWait` (default: 90 loops / 1800 seconds / 20 seconds). Failures use explicit `ResourceWaitFailed:*` messages instead of running until the Durable execution timeout (construct default: 2 hours; override with `durable.executionTimeout`).
- **Configurable Lambda runtime** – Memory, invoke timeout, and bounded instance concurrency via `runtime` (default: **512 MB** / **15 minutes** / **maxConcurrency 10**). Durable execution timeout and history retention via `durable` (default: **2 hours** / **1 day**).
- **Configurable logs** – Log group retention and removal policy via `logGroup` (default: **3 months**, `RemovalPolicy.DESTROY`).
- **Validated environment variables** – The bundled handler parses env vars with **strict-env-resolver** (`StrictEnvResolver`). `SLACK_SECRET_NAME` is required; wait limits and `maxConcurrency` must be **finite positive numbers** (`> 0`).
- **Slack notifications** – Parent message plus threaded updates per instance; credentials from Secrets Manager JSON (`token`, `channel`). The construct sets **`SLACK_SECRET_NAME`** on the function.
- **Structured logging** – Durable execution **`ctx.logger`** for traceable JSON application logs (invocation, describe/start/stop/wait loops, wait limit errors, Slack steps, completion).
- **Optional failure detection** – CloudWatch alarms and log-based metrics for Lambda errors, instance wait failures (`ResourceWaitFailed`), Slack post failures, and other handler `ERROR` logs. Optional SNS notifications via a caller-supplied topic (`failureDetection.alarmTopic`).
- **Scheduling toggle** – Enable or disable both schedules without removing the stack (`enableScheduling`).
- **Configurable schedules** – Optional cron overrides for start and stop (`minute`, `hour`, `week`, `timezone`); sensible defaults if omitted.
- **IAM and observability** – Start/stop is limited to EC2 instances in the stack account/region whose tags match `targetResource`. Slack secret read grant, **Parameters and Secrets Lambda Extension**, JSON logging, and a dedicated log group (override retention and removal policy via `logGroup`).

## Installation

**npm**

```bash
npm install ec2-instance-running-scheduler
```

**yarn**

```bash
yarn add ec2-instance-running-scheduler
```

**pnpm**

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

Use the **stack** `EC2InstanceRunningScheduleStack` when deploying the scheduler as its own stack. It accepts the same **targeting, schedules, secrets, enable flag, and failure detection** as the construct (plus standard `StackProps` such as `env`). For **`resourceWait`**, **`runtime`**, **`durable`**, and **`logGroup`**, use the construct directly or extend the stack in your app.

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

## Tag instances before scheduling

The scheduler only starts and stops EC2 instances that **already** have the tag key and one of the tag values in `targetResource`. Tag instances in the same account and region as the stack **before** enabling schedules.

**AWS CLI**

```bash
aws ec2 create-tags \
  --resources i-0123456789abcdef0 \
  --tags Key=Schedule,Value=YES
```

**Console** – EC2 → Instances → select the instance → Tags → Add `Schedule` = `YES` (or your `tagKey` / `tagValues`).

IAM for `ec2:StartInstances` and `ec2:StopInstances` is limited to:

- instance ARNs in the stack **account** and **region** (`arn:...:ec2:<region>:<account>:instance/*`)
- instances whose `aws:ResourceTag/<tagKey>` matches one of `tagValues`

An instance without the tag is not discovered by `tag:GetResources`, and start/stop is denied even if an instance ID is known. `tag:GetResources` and `ec2:DescribeInstances` still use `Resource: *` because those APIs do not support resource-level permissions or resource-tag conditions.

EventBridge Scheduler invokes the Lambda with `Params.TagKey`, `Params.TagValues`, and `Params.Mode` (`Start` or `Stop`); the construct wires this for you. The function environment includes:

| Variable | Source | Purpose |
|----------|--------|---------|
| `SLACK_SECRET_NAME` | `secrets.slackSecretName` | Secrets Manager secret for Slack (required) |
| `PROCESS_RESOURCE_MAX_LOOP_COUNT` | `resourceWait.maxLoopCount` (default `90`) | Max describe/wait iterations per instance |
| `PROCESS_RESOURCE_MAX_ELAPSED_SECONDS` | `resourceWait.maxElapsedSeconds` (default `1800`) | Max wall-clock seconds waiting for one instance |
| `PROCESS_RESOURCE_STATUS_CHANGE_WAIT_SECONDS` | `resourceWait.statusChangeWaitSeconds` (default `20`) | Seconds between describe/wait iterations |
| `PROCESS_RESOURCES_MAX_CONCURRENCY` | `runtime.maxConcurrency` (default `10`) | Max instances processed in parallel |

When you set wait limits via `resourceWait` or concurrency via `runtime.maxConcurrency`, the construct writes them as decimal integer strings. At invocation the handler parses them with **strict-env-resolver**; each value must be a **finite number greater than zero**. Missing `SLACK_SECRET_NAME` or invalid env values cause `StrictEnvValidationError` at the start of an invocation.

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
| `failureDetection` | `FailureDetectionAlarms` | No | Optional CloudWatch alarms and log-based metrics (see below). |

### EC2InstanceRunningScheduleStack

Includes `targetResource`, `secrets`, `startSchedule`, `stopSchedule`, `enableScheduling`, `failureDetection`, and standard `StackProps`. Does **not** expose `resourceWait`, `runtime`, `durable`, or `logGroup`; use `EC2InstanceRunningScheduler` when you need custom wait, Lambda, Durable, or log settings.

### TargetResource

- `tagKey` – Tag key used to select instances (e.g. `Schedule`). Required on each target instance before schedules run.
- `tagValues` – Tag values that must match (e.g. `['YES']`). At least one value is required.

See [Tag instances before scheduling](#tag-instances-before-scheduling).

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

### FailureDetectionAlarms

Optional operational failure detection. Alarms are created only when `enabled` is `true`.

- `enabled` – When `true`, creates four CloudWatch alarms and three log metric filters (default: disabled when omitted).
- `alarmTopic` – Optional `sns.ITopic` for alarm actions. The construct does **not** create an SNS topic; pass an existing or imported topic. When omitted, alarms are created without SNS actions.

When enabled, the construct creates:

| Alarm | Trigger |
|-------|---------|
| Lambda errors | `AWS/Lambda` `Errors` metric |
| Instance status failure | Log filter: `ResourceWaitFailed` |
| Slack post failure | Log filter: `running-scheduler: Slack post failed` |
| Durable execution failure | Other handler `ERROR` logs (excluding the above) |

Custom metrics are published under the `EC2InstanceRunningScheduler` namespace. Access the created alarms via `EC2InstanceRunningScheduler.failureDetection` when enabled.

## Requirements

- **Node.js** ≥ 20.0.0 (for developing or synthesizing CDK apps that depend on this package).
- **aws-cdk-lib** ^2.232.0 and **constructs** ^10.5.1 (peer dependencies).
- **AWS** – EventBridge Scheduler; Lambda with **Durable Execution** (Node.js **24.x** runtime in the construct; Durable Execution requires a supported Node.js runtime in your region), a **live alias**, **Parameters and Secrets Lambda Extension**; EC2 (`DescribeInstances`, `StartInstances`, `StopInstances`); Resource Groups Tagging API (`tag:GetResources`); Secrets Manager. The deployed function uses **arm64**, Durable Execution IAM policies, a 2-hour Durable execution timeout (construct default), and a bundled handler that loads secrets via **aws-lambda-secret-fetcher** (^0.7) and parses env vars via **strict-env-resolver** (^0.5). Secret fetch runs only inside Lambda (requires runtime `AWS_SESSION_TOKEN` and the extension layer); the library retries transient extension errors including cold-start "not ready" responses.

## License

This project is licensed under the Apache-2.0 License.
