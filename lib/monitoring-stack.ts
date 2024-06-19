import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';


export class PipelineMonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const pipelineName = 'testing-app-pipeline';
    const logGroupName = `/aws/codepipeline/${pipelineName}`;

     // Create CloudWatch Log Group
    const logGroup = new logs.LogGroup(this, 'PipelineLogGroup', {
      logGroupName: logGroupName,
      retention: logs.RetentionDays.ONE_MONTH, // Adjust retention as needed
    });

    // Create DynamoDB table for storing start times
    const table = new dynamodb.Table(this, 'PipelineExecutionTable', {
      partitionKey: { name: 'executionId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change as needed
    });


    // Create a Lambda function to process logs and calculate duration
    const logProcessor = new lambda.Function(this, 'LogProcessor', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const { CloudWatchClient, PutMetricDataCommand } = require("@aws-sdk/client-cloudwatch");
        const { DynamoDBClient, GetItemCommand, PutItemCommand } = require("@aws-sdk/client-dynamodb");
        const { CloudWatchLogsClient, CreateLogStreamCommand, PutLogEventsCommand } = require("@aws-sdk/client-cloudwatch-logs");

        const cloudwatch = new CloudWatchClient();
        const dynamodb = new DynamoDBClient();
        const cloudwatchLogs = new CloudWatchLogsClient();

        const tableName = process.env.TABLE_NAME;
        const logGroupName = process.env.LOG_GROUP_NAME;

        exports.handler = async (event) => {
          console.log("Received event:", JSON.stringify(event, null, 2));

          if (!event.detail || !event.detail['execution-id']) {
            console.error("Missing execution-id in event detail:", JSON.stringify(event.detail, null, 2));
            return;
          }

          const message = event.detail;
          const { 'execution-id': executionId, pipeline, state } = message;
          const timestamp = new Date(event.time).getTime();

          const logParams = {
            logGroupName: logGroupName,
            logStreamName: executionId,
            logEvents: [
              {
                timestamp: timestamp,
                message: JSON.stringify(message)
              }
            ]
          };

          try {
            await cloudwatchLogs.send(new CreateLogStreamCommand({ logGroupName: logGroupName, logStreamName: executionId }));
          } catch (error) {
            if (error.name !== 'ResourceAlreadyExistsException') {
              console.error("Error creating log stream:", error);
              throw error;
            }
          }

          try {
            await cloudwatchLogs.send(new PutLogEventsCommand(logParams));
          } catch (error) {
            console.error("Error putting log events:", error);
            throw error;
          }

          if (state === 'STARTED') {
            try {
              await dynamodb.send(new PutItemCommand({
                TableName: tableName,
                Item: {
                  executionId: { S: executionId },
                  startTime: { N: String(timestamp) }
                }
              }));
            } catch (error) {
              console.error("Error putting item to DynamoDB:", error);
              throw error;
            }
          } else if (state === 'SUCCEEDED' || state === 'FAILED') {
            let result;
            try {
              result = await dynamodb.send(new GetItemCommand({
                TableName: tableName,
                Key: { executionId: { S: executionId } }
              }));
            } catch (error) {
              console.error("Error getting item from DynamoDB:", error);
              throw error;
            }

            if (result.Item) {
              const startTime = Number(result.Item.startTime.N);
              const duration = (timestamp - startTime) / 1000; // Convert to seconds

              const params = {
                MetricData: [{
                  MetricName: 'PipelineExecutionDuration',
                  Dimensions: [
                    { Name: 'PipelineName', Value: pipeline }
                  ],
                  Unit: 'Seconds',
                  Value: duration
                }],
                Namespace: 'PipelineMetrics'
              };

              try {
                await cloudwatch.send(new PutMetricDataCommand(params));
              } catch (error) {
                console.error("Error putting metric data to CloudWatch:", error);
                throw error;
              }
            }
          }
        };
      `),
      environment: {
        TABLE_NAME: table.tableName,
        LOG_GROUP_NAME: logGroupName,
      }
    });

    table.grantReadWriteData(logProcessor);
    logGroup.grantWrite(logProcessor);

    // Create EventBridge Rule to capture CodePipeline start and end events
    const eventRule = new events.Rule(this, 'PipelineEventRule', {
      eventBus : events.EventBus.fromEventBusName(this, 'EventBus', 'monitoring-central-event-bus'),
      eventPattern: {
        source: ['aws.codepipeline'],
        detailType: ['CodePipeline Pipeline Execution State Change'],
        detail: {
          pipeline: [pipelineName],
          state: ['STARTED', 'SUCCEEDED', 'FAILED']
        }
      }
    });

    eventRule.addTarget(new targets.LambdaFunction(logProcessor));


    // Add CloudWatch Logs as a target
    eventRule.addTarget(new targets.CloudWatchLogGroup(logGroup));


    // Create Metric Filters for Success and Failure
    const successMetricFilter = new logs.MetricFilter(this, 'PipelineSuccessFilter', {
      logGroup: logGroup,
      filterPattern: logs.FilterPattern.literal('{ $.detail.state = "SUCCEEDED" }'),
      metricNamespace: 'PipelineMetrics',
      metricName: 'PipelineSuccess',
      metricValue: '1',
    });

    const failureMetricFilter = new logs.MetricFilter(this, 'PipelineFailureFilter', {
      logGroup: logGroup,
      filterPattern: logs.FilterPattern.literal('{ $.detail.state = "FAILED" }'),
      metricNamespace: 'PipelineMetrics',
      metricName: 'PipelineFailure',
      metricValue: '1',
    });

    // Create a KMS key
    const key = new kms.Key(this, 'LambdaKMSKey', {
      enableKeyRotation: true,
      alias : 'pipeline-monitoring-lambda-key'
    });

    // Create the Lambda function
    const lambdaFunction = new lambda.Function(this, 'PipelineNotificationLambda', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromInline(`
        import json
        import urllib3
        import os
        import boto3
        from base64 import b64decode

        ENCRYPTED = os.environ['WEBHOOK_URL']
        DECRYPTED = boto3.client('kms').decrypt(
            CiphertextBlob=b64decode(ENCRYPTED),
            EncryptionContext={'LambdaFunctionName': os.environ['AWS_LAMBDA_FUNCTION_NAME']}
        )['Plaintext'].decode('utf-8')

        def lambda_handler(event, context):
            print(event)
            webhook_url = DECRYPTED

            detail = event['detail']
            pipeline_name = detail['pipeline']
            execution_id = detail['execution-id']
            state = detail['state']
            account_id = event['account']
            region = event['region']

            if state == "STARTED":
                message = f"Pipeline *{pipeline_name}* in account *{account_id}* in region *{region}* has entered the state *STARTED* with execution ID *{execution_id}*."
            elif state == "SUCCEEDED":
                message = f"Pipeline *{pipeline_name}* in account *{account_id}* in region *{region}* has *SUCCEEDED* with execution ID *{execution_id}*."
            elif state == "FAILED":
                message = f"Pipeline *{pipeline_name}* in account *{account_id}* in region *{region}* has *FAILED* with execution ID *{execution_id}*."
            elif state == "CANCELED":
                message = f"Pipeline *{pipeline_name}* in account *{account_id}* in region *{region}* has been *CANCELED* with execution ID *{execution_id}*."
            else:
                message = f"Pipeline *{pipeline_name}* in account *{account_id}* in region *{region}* has entered an unknown state *{state}* with execution ID *{execution_id}*."

            http = urllib3.PoolManager()
            response = http.request(
                'POST',
                webhook_url,
                body=json.dumps({'text': message}),
                headers={'Content-Type': 'application/json'}
            )

            return {
                'statusCode': 200,
                'body': json.dumps('Notification sent to Slack')
            }
      `),
      environment: {
        WEBHOOK_URL: 'AQICAHh7f+qMN2lIJaeD9Vn+CyEaXwPED9Es7fZqD944Sz0XcgExsGCwV9Fq3nSQM0mFxwfuAAAAsTCBrgYJKoZIhvcNAQcGoIGgMIGdAgEAMIGXBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDK9wohfgYsaxlEYfGAIBEIBq/ID6gDGUvuZgqesdEXfa6k6EjYK2GfzErUwo4kUfMGzTb3MIYHQrzYDxv4+8TWcxjXhXv8pFBLjpJiPs04SMbsBAP0HAZeOFkdQCqxZ0nd77U0DFzScz+bc5aHTqxfxGbhh5ombUqU+Pqw==',
      },
    });

    // Grant the Lambda function permissions to use the KMS key
    key.grantDecrypt(lambdaFunction);

    // Add permissions for the Lambda function to access KMS
    lambdaFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt'],
      resources: [key.keyArn],
    }));

    eventRule.addTarget(new targets.LambdaFunction(lambdaFunction));

    // Create SNS Topic for pipeline failure notifications
    const snsTopic = new sns.Topic(this, 'PipelineFailureTopic', {
      displayName: 'Pipeline Failure Notifications'
    });

    // Add an email subscription to the SNS topic (replace with your email)
    snsTopic.addSubscription(new sns_subscriptions.EmailSubscription('andreszcarbajal@gmail.com'));

    // Create CloudWatch Alarm for pipeline failures
    const failureAlarm = new cloudwatch.Alarm(this, 'PipelineFailureAlarm', {
      metric: failureMetricFilter.metric(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Alarm when the pipeline execution fails',
      actionsEnabled: true
    });

    // Add the SNS topic as the alarm action
    failureAlarm.addAlarmAction(new actions.SnsAction(snsTopic));

    // Create CloudWatch Dashboard
    const dashboard = new cloudwatch.Dashboard(this, 'PipelineDashboard', {
      dashboardName: 'PipelineDashboard',
    });

    // Add widgets to the dashboard
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Pipeline Executions',
        left: [
          new cloudwatch.Metric({
            namespace: 'PipelineMetrics',
            metricName: 'PipelineSuccess',
            statistic: 'Sum',
          }),
          new cloudwatch.Metric({
            namespace: 'PipelineMetrics',
            metricName: 'PipelineFailure',
            statistic: 'Sum',
          }),
        ],
      })
    );

    dashboard.addWidgets(
      new cloudwatch.SingleValueWidget({
        title: 'Pipeline Success Count',
        metrics: [
          new cloudwatch.Metric({
            namespace: 'PipelineMetrics',
            metricName: 'PipelineSuccess',
            statistic: 'Sum',
          }),
        ],
      })
    );

    dashboard.addWidgets(
      new cloudwatch.SingleValueWidget({
        title: 'Pipeline Failure Count',
        metrics: [
          new cloudwatch.Metric({
            namespace: 'PipelineMetrics',
            metricName: 'PipelineFailure',
            statistic: 'Sum',
          }),
        ],
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Pipeline Duration',
        left: [
          new cloudwatch.Metric({
            namespace: 'PipelineMetrics',
            metricName: 'PipelineExecutionDuration',
            statistic: 'Average',
          }),
        ],
      })
    );
  }
}



