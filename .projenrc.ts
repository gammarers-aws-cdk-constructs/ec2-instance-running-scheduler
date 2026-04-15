import { awscdk, javascript } from 'projen';
const project = new awscdk.AwsCdkConstructLibrary({
  author: 'yicr',
  authorAddress: 'yicr@users.noreply.github.com',
  cdkVersion: '2.189.1',
  defaultReleaseBranch: 'main',
  jsiiVersion: '~5.9.0',
  name: 'ec2-instance-running-scheduler',
  packageManager: javascript.NodePackageManager.NPM,
  projenrcTs: true,
  repositoryUrl: 'https://github.com/gammarers-aws-cdk-constructs/ec2-instance-running-scheduler.git',
  releaseToNpm: false,
  npmAccess: javascript.NpmAccess.PUBLIC,
});
project.synth();