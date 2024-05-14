#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PipelineStack } from '../lib/pipeline-stack';
import { PipelineUtilsStack } from '../lib/pipeline-utils-stack';
const env_target  = { account: '', region: '' };
const env_devops = { account: '', region: '' };

const app = new cdk.App();

const pipelineStack = new PipelineStack(app, "pipelineStack", {
    env: env_devops,
    env_name: "dev",
    prefix: "testing"
});

const pipelineUtilsStack = new PipelineUtilsStack(app, "MyWestCdkStack", {
  env: env_devops,
  env_name: "dev",
  prefix: "testing"
});

pipelineStack.addDependency(pipelineUtilsStack)

app.synth();