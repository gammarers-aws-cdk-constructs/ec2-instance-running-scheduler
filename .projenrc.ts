import { awscdk, javascript, github } from 'projen';
const project = new awscdk.AwsCdkConstructLibrary({
  author: 'yicr',
  authorAddress: 'yicr@users.noreply.github.com',
  cdkVersion: '2.232.0',
  defaultReleaseBranch: 'main',
  typescriptVersion: '6.0.x',
  jsiiVersion: '6.0.x',
  name: 'ec2-instance-running-scheduler',
  packageManager: javascript.NodePackageManager.NPM,
  projenrcTs: true,
  repositoryUrl: 'https://github.com/gammarers-aws-cdk-constructs/ec2-instance-running-scheduler.git',
  description: 'AWS CDK construct library that starts and stops EC2 instances on a cron schedule using EventBridge Scheduler and a Durable Execution Lambda. The handler discovers instances with the Resource Groups Tagging API, issues start/stop, waits until each instance reaches a stable target state (durable step / wait), processes multiple instances in parallel (bounded concurrency), and posts Slack summary and per-instance thread messages using a secret from Secrets Manager. The Lambda emits structured application logs alongside JSON platform logs.',
  keywords: ['cdk', 'ec2', 'scheduler', 'durable', 'execution', 'lambda', 'slack'],
  devDeps: [
    '@aws/durable-execution-sdk-js@^1.1.7',
    '@aws-sdk/client-ec2@^3.1111.0',
    '@aws-sdk/client-resource-groups-tagging-api@^3.1111.0',
    '@slack/web-api@^6.13.0',
    '@types/aws-lambda@^8.10.162',
    'aws-lambda-secret-fetcher@^0.6.1',
    'aws-sdk-client-mock@^2.2.0',
    'aws-sdk-client-mock-jest@^2.2.0',
    'strict-env-resolver@^0.5.1',
  ],
  releaseToNpm: true,
  npmTrustedPublishing: true,
  npmAccess: javascript.NpmAccess.PUBLIC,
  minNodeVersion: '20.0.0',
  workflowNodeVersion: '24.x',
  depsUpgradeOptions: {
    workflowOptions: {
      labels: ['auto-approve', 'auto-merge'],
      schedule: javascript.UpgradeDependenciesSchedule.WEEKLY,
    },
  },
  githubOptions: {
    projenCredentials: github.GithubCredentials.fromApp({
      permissions: {
        pullRequests: github.workflows.AppPermission.WRITE,
        contents: github.workflows.AppPermission.WRITE,
        workflows: github.workflows.AppPermission.WRITE,
      },
    }),
  },
  autoApproveOptions: {
    allowedUsernames: [
      'gammarers-projen-upgrade-bot[bot]',
      'yicr',
    ],
  },
  jestOptions: {
    extraCliOptions: ['--silent'],
  },
  tsconfigDev: {
    compilerOptions: {
      strict: true,
    },
  },
  lambdaOptions: {
    // target node.js runtime
    runtime: awscdk.LambdaRuntime.NODEJS_24_X,
    bundlingOptions: {
      // list of node modules to exclude from the bundle
      externals: ['@aws-sdk/*'],
      sourcemap: true,
    },
  },
});
project.eslint?.allowDevDeps('src/funcs/running-scheduler-wait-env.ts');
project.synth();