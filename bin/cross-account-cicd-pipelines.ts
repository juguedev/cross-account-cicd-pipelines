#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PipelineStack } from '../lib/pipeline-stack';
import { PipelineUtilsStack } from '../lib/pipeline-utils-stack';
import {
  TARGET_ACCOUNT,
  TARGET_REGION,
  DEVOPS_ACCOUNT,
  DEVOPS_REGION
} from '../config/parameters_dev';

const env_target = { account: TARGET_ACCOUNT, region: TARGET_REGION };
const env_devops = { account: DEVOPS_ACCOUNT, region: DEVOPS_REGION };

const app = new cdk.App();

const pipelineStack = new PipelineStack(app, "pipelineStack", {
  env: env_devops,
  env_name: "dev",
  prefix: "testing"
});

const pipelineUtilsStack = new PipelineUtilsStack(app, "pipelineUtilsStack", {
  env: env_devops,
  env_name: "dev",
  prefix: "testing"
});

pipelineStack.addDependency(pipelineUtilsStack)

app.synth();