import * as cdk from 'aws-cdk-lib';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import { Construct } from 'constructs';
import { Pipeline, PipelineType, Artifact } from 'aws-cdk-lib/aws-codepipeline';
import * as s3 from 'aws-cdk-lib/aws-s3';
import {
    CodeBuildAction,
    CodeCommitSourceAction,
} from 'aws-cdk-lib/aws-codepipeline-actions';
import {
    Project,
} from 'aws-cdk-lib/aws-codebuild'

export interface PipelineStackProps extends cdk.StackProps {
    env_name: string,
    prefix: string
}

export class PipelineStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: PipelineStackProps) {
        super(scope, id, props);

        // Crear un CodeCommit repository
        const source_repo = new codecommit.Repository(this, 'AppRepository', {
            repositoryName: props.prefix + "-app-repo",
        });

        // Crear el bucket S3 para los Artefactos
        const s3ArtifactsBucket = new s3.Bucket(this, 'S3Bucket', {
            bucketName: props.prefix + '-app-pipeline-artifacts',
            enforceSSL: true,
            accessControl: s3.BucketAccessControl.PRIVATE,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            encryption: s3.BucketEncryption.S3_MANAGED,
        });

        const linter_project = Project.fromProjectName(
            this,
            props.prefix + "-linting-codebuild",
            props.prefix + "-linting-codebuild"
        )

        const sourceArtifact = new Artifact(props.prefix + "-source-input-artifact");
        // CodeStarConnections action
        const source_action = new CodeCommitSourceAction({
            actionName: 'SOURCE',
            repository: source_repo,
            output: sourceArtifact
        });


        // CodeBuild action Linting
        const linting_action = new CodeBuildAction({
            actionName: props.prefix + 'linting-action',
            project: linter_project,
            input: sourceArtifact,
        });


        // Create CodePipeline
        new Pipeline(this, 'AppPipeline', {
            pipelineName: props.prefix + '-app-pipeline',
            pipelineType: PipelineType.V1,
            artifactBucket: s3ArtifactsBucket,
            stages: [
                {
                    stageName: props.prefix + "-source-stage",
                    actions: [source_action],
                },
                {
                    stageName: props.prefix + "-linting-stage",
                    actions: [linting_action],
                },
            ],
        });
    }
}
