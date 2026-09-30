import { ProjenCdkConstructLibrary } from '@gammarers/projen-projects';
import { awscdk } from 'projen';
const project = new ProjenCdkConstructLibrary({
  cdkVersion: '2.232.0',
  defaultReleaseBranch: 'main',
  name: 'ec2-instance-running-scheduler',
  repositoryUrl: 'https://github.com/gammarers-aws-cdk-constructs/ec2-instance-running-scheduler.git',
  description: 'AWS CDK construct library that starts and stops EC2 instances on a cron schedule using EventBridge Scheduler and a Durable Execution Lambda. Tagged instances are discovered account-wide, started or stopped in parallel, waited until stable, and reported to Slack via Secrets Manager.',
  keywords: ['cdk', 'ec2', 'scheduler', 'durable', 'execution', 'lambda', 'slack'],
  devDeps: [
    '@gammarers/projen-projects@^0.4.0',
    '@aws/durable-execution-sdk-js@^1.1.7',
    '@aws-sdk/client-ec2@^3.1111.0',
    '@aws-sdk/client-resource-groups-tagging-api@^3.1111.0',
    '@slack/web-api@^6.13.0',
    '@types/aws-lambda@^8.10.162',
    'aws-sdk-client-mock@^2.2.0',
    'aws-sdk-client-mock-jest@^2.2.0',
    'strict-env-resolver@^0.7.2',
    'aws-lambda-secret-fetcher@^0.8.1',
  ],
  releaseToNpm: true,
  npmTrustedPublishing: true,
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