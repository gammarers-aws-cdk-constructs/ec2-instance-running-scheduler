import { awscdk, javascript, github } from 'projen';
const project = new awscdk.AwsCdkConstructLibrary({
  author: 'yicr',
  authorAddress: 'yicr@users.noreply.github.com',
  cdkVersion: '2.232.0',
  defaultReleaseBranch: 'main',
  typescriptVersion: '5.9.x',
  jsiiVersion: '5.9.x',
  name: 'ec2-instance-running-scheduler',
  packageManager: javascript.NodePackageManager.YARN_CLASSIC,
  projenrcTs: true,
  repositoryUrl: 'https://github.com/gammarers-aws-cdk-constructs/ec2-instance-running-scheduler.git',
  devDeps: [
    '@aws/durable-execution-sdk-js@^1',
    '@aws-sdk/client-ec2@^3',
    '@aws-sdk/client-resource-groups-tagging-api@^3',
    '@slack/web-api@^6',
    '@types/aws-lambda@^8',
    'aws-lambda-secret-fetcher@^0.3',
    'aws-sdk-client-mock@^2',
    'aws-sdk-client-mock-jest@^2',
    'safe-env-getter@^0.2',
  ],
  releaseToNpm: false,
  // npmTrustedPublishing: true,
  npmAccess: javascript.NpmAccess.PUBLIC,
  mergify: true,
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
project.synth();