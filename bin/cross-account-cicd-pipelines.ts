#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PipelineUtilsStack } from '../lib/pipeline-utils-stack';
import { PipelineStack } from '../lib/pipelines-stack';

const app = new cdk.App();
const pipelineUtilsStack = new PipelineUtilsStack(
  app,
  'PipelineUtilsStack',
  {
    env_name: "dev",
    prefix: "testing"
  })
  ;

const pipelineStack = new PipelineStack(
    app,
    'PipelineStack',
    {
      env_name: "dev",
      prefix: "testing"
    })
    ;
  
    pipelineStack.addDependency(pipelineUtilsStack)