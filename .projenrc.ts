import { ProjenCdkConstructLibrary } from '@gammarers/projen-projects';
const project = new ProjenCdkConstructLibrary({
  cdkVersion: '2.232.0',
  defaultReleaseBranch: 'main',
  name: 'ec2-instance-running-scheduler',
  repositoryUrl: 'https://github.com/gammarers-aws-cdk-constructs/ec2-instance-running-scheduler.git',
  description: 'AWS CDK construct library that starts and stops tagged EC2 instances on a cron schedule with EventBridge Scheduler and a Durable Execution Lambda, and optionally reports results to CloudWatch Logs, Slack, Amazon SNS, or an EventBridge custom bus.',
  keywords: ['cdk', 'ec2', 'scheduler', 'durable', 'execution', 'lambda', 'slack', 'sns', 'eventbridge'],
  peerDeps: [
    'lambda-failure-detector@^0.2.1',
  ],
  devDeps: [
    '@gammarers/projen-projects@^0.6.2',
    '@aws/durable-execution-sdk-js@^1.1.7',
    '@aws-sdk/client-ec2@^3.1111.0',
    '@aws-sdk/client-eventbridge@^3.1111.0',
    '@aws-sdk/client-resource-groups-tagging-api@^3.1111.0',
    '@aws-sdk/client-sns@^3.1111.0',
    '@slack/web-api@^6.13.0',
    '@smithy/node-http-handler@^4.12.1',
    '@types/aws-lambda@^8.10.162',
    'aws-sdk-client-mock@^2.2.0',
    'aws-sdk-client-mock-jest@^2.2.0',
    'strict-env-resolver@^0.8.2',
    'aws-lambda-secret-fetcher@^0.9.1',
  ],
  releaseToNpm: true,
  npmTrustedPublishing: true,
});
// Lambda handlers under src/funcs bundle devDependencies and are not part of the published construct API.
project.eslint?.allowDevDeps('src/funcs/**/*.ts');
project.synth();