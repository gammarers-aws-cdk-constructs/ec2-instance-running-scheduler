# AWS EC2 Instance Running Scheduler

[![GitHub](https://img.shields.io/github/license/gammarers-aws-cdk-constructs/aws-ec2-instance-running-scheduler?style=flat-square)](https://github.com/gammarers-aws-cdk-constructs/aws-ec2-instance-running-scheduler/blob/main/LICENSE)
[![npm (scoped)](https://img.shields.io/npm/v/aws-ec2-instance-running-scheduler?style=flat-square)](https://www.npmjs.com/package/aws-ec2-instance-running-scheduler)
[![GitHub Workflow Status (branch)](https://img.shields.io/github/actions/workflow/status/gammarers-aws-cdk-constructs/aws-ec2-instance-running-scheduler/release.yml?branch=main&label=release&style=flat-square)](https://github.com/gammarers-aws-cdk-constructs/aws-ec2-instance-running-scheduler/actions/workflows/release.yml)
[![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/gammarers-aws-cdk-constructs/aws-ec2-instance-running-scheduler?sort=semver&style=flat-square)](https://github.com/gammarers-aws-cdk-constructs/aws-ec2-instance-running-scheduler/releases)

[![View on Construct Hub](https://constructs.dev/badge?package=aws-ec2-instance-running-scheduler)](https://constructs.dev/packages/aws-ec2-instance-running-scheduler)

AWS CDK construct that starts and stops EC2 instances on a cron schedule using **EventBridge Scheduler** and a **Durable Execution Lambda**. The handler discovers instances with the **Resource Groups Tagging API**, runs start/stop and **polls until the instance reaches the target state** (durable `step` / `wait`), processes **multiple instances in parallel** (bounded concurrency), and posts **Slack** summary and per-instance thread messages using a secret from **Secrets Manager**. The Lambda emits **structured application logs** (invocation, EC2 transitions, Slack steps, completion) alongside JSON platform logs.

## Features

- **Tag-based targeting** – Select EC2 instances by tag key and values (e.g. `Schedule` / `YES`) via `tag:GetResources`.
- **EventBridge Scheduler** – Separate cron rules for start and stop, with per-rule timezone (`aws-cdk-lib` `TimeZone`).
- **Durable Lambda** – One Lambda with AWS Lambda Durable Execution (`step`, `wait`, `map`, child contexts per instance) for long-running workflows without Step Functions.
- **Stable-state polling** – After start/stop, the function waits and re-describes instances until `running` (start mode) or `stopped` (stop mode), or until a terminal error.
- **Slack notifications** – Required for a successful run: parent message plus threaded updates per instance; credentials come from Secrets Manager (`token` and `channel` JSON). The secret name is passed as **`SLACK_SECRET_NAME`** on the function (from `secrets.slackSecretName`) and validated at runtime via **safe-env-getter**.
- **Structured logging** – The handler uses the durable execution **`ctx.logger`** for traceable JSON application logs (e.g. invocation, describe/start/stop/wait loops, target count, Slack posts, errors before instance state failures).
- **Scheduling toggle** – Enable or disable both schedules without removing the stack (`enableScheduling`).
- **Configurable schedules** – Optional cron overrides for start and stop (`minute`, `hour`, `week`, `timezone`); sensible defaults if omitted.
- **IAM and observability** – EC2 and tagging API permissions, Slack secret read grant, **Parameters and Secrets Lambda Extension** (configured on the function for secret access patterns), JSON logging with configurable system/application levels, and a dedicated log group (construct defaults).

## Installation

**npm**

```bash
npm install aws-ec2-instance-running-scheduler
```

**yarn**

```bash
yarn add aws-ec2-instance-running-scheduler
```

**pnpm**

```bash
pnpm add aws-ec2-instance-running-scheduler
```

## Usage

Use the **construct** `EC2InstanceRunningScheduler` when embedding the scheduler in an existing stack or other CDK scope.

```typescript
import * as cdk from 'aws-cdk-lib';
import { TimeZone } from 'aws-cdk-lib';
import { EC2InstanceRunningScheduler } from 'aws-ec2-instance-running-scheduler';

const app = new cdk.App();
const stack = new cdk.Stack(app, 'MyStack');

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
});
```

Use the **stack** `EC2InstanceRunningScheduleStack` when deploying the scheduler as its own stack. It accepts the **same scheduler options** as the construct (plus standard `StackProps` such as `env`).

```typescript
import * as cdk from 'aws-cdk-lib';
import { TimeZone } from 'aws-cdk-lib';
import { EC2InstanceRunningScheduleStack } from 'aws-ec2-instance-running-scheduler';

const app = new cdk.App();

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
});
```

EventBridge Scheduler invokes the Lambda with `Params.TagKey`, `Params.TagValues`, and `Params.Mode` (`Start` or `Stop`); the construct wires this for you. The function environment includes **`SLACK_SECRET_NAME`** set to `secrets.slackSecretName`.

## Options

These options apply to **`EC2InstanceRunningScheduler`** and to **`EC2InstanceRunningScheduleStack`** (stack props include them alongside `StackProps`).

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `targetResource` | `TargetResource` | Yes | Tag key and values used to select EC2 instances. |
| `secrets` | `Secrets` | Yes | Identifies the Secrets Manager secret used for Slack (`slackSecretName`). |
| `startSchedule` | `Schedule` | No | Cron for starting instances (default: `50 7 ? * MON-FRI *` in `Etc/UTC`). |
| `stopSchedule` | `Schedule` | No | Cron for stopping instances (default: `5 19 ? * MON-FRI *` in `Etc/UTC`). |
| `enableScheduling` | `boolean` | No | Whether both scheduler rules are enabled (default: `true`). |

### TargetResource

- `tagKey` – Tag key used to select instances (e.g. `Schedule`).
- `tagValues` – Tag values that must match (e.g. `['YES']`).

### Schedule

- `timezone` – `TimeZone` from `aws-cdk-lib` (e.g. `TimeZone.ASIA_TOKYO`, `TimeZone.ETC_UTC`).
- `minute` – Cron minute (`0`–`59`).
- `hour` – Cron hour (`0`–`23`).
- `week` – Cron day-of-week field (e.g. `MON-FRI`).

### Secrets

- `slackSecretName` – Name of the AWS Secrets Manager secret. The Lambda expects JSON with **`token`** (Slack bot token) and **`channel`** (channel ID or name for `chat.postMessage`). The construct sets **`SLACK_SECRET_NAME`** on the function to this value; the handler reads and validates it at runtime (via **safe-env-getter**).

## Requirements

- **Node.js** ≥ 20.0.0 (for developing or synthesizing CDK apps that depend on this package).
- **aws-cdk-lib** ^2.232.0 and **constructs** ^10.5.1 (peer dependencies).
- **AWS** – EventBridge Scheduler; Lambda with **Durable Execution** (requires **Node.js 22+** in the deployment region—runtime is the latest Node.js available in the region per the construct), a **live alias**, **Parameters and Secrets Lambda Extension**; EC2 (describe/start/stop); Resource Groups Tagging API; Secrets Manager. The deployed function uses **arm64**, Durable Execution–compatible IAM and settings, and a bundled handler that loads secrets via **aws-lambda-secret-fetcher**.

## License

This project is licensed under the Apache-2.0 License.
