#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PipelineUtilsStack } from '../lib/pipeline-utils-stack';

const app = new cdk.App();
new PipelineUtilsStack(
  app,
  'PipelineUtilsStack',
  {
  
});