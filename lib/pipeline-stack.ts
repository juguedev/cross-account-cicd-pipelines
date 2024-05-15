import * as cdk from 'aws-cdk-lib';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import { Construct } from 'constructs';
import { Pipeline, PipelineType, Artifact } from 'aws-cdk-lib/aws-codepipeline';
import * as s3 from 'aws-cdk-lib/aws-s3';
import {
    CodeBuildAction,
    CodeCommitSourceAction,
    ManualApprovalAction
} from 'aws-cdk-lib/aws-codepipeline-actions';
import {
    Project,
} from 'aws-cdk-lib/aws-codebuild'
import * as iam from 'aws-cdk-lib/aws-iam';

interface PipelineProps extends cdk.StackProps {
    env_name: string,
    prefix: string
}

export class PipelineStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: PipelineProps) {
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

        // Define the policy statement
        const codeBuildPolicyStatement = new iam.PolicyStatement({
            actions: [
                "s3:PutObject",
                "s3:GetObject",
                "s3:GetObjectVersion",
                "s3:GetBucketAcl",
                "s3:GetBucketLocation"
            ],
            resources: [
                s3ArtifactsBucket.bucketArn,
                `${s3ArtifactsBucket.bucketArn}/*`
            ],
            effect: iam.Effect.ALLOW,
            principals: [new iam.ServicePrincipal('codebuild.amazonaws.com')],
        });

        // Attach the policy statement to the bucket
        s3ArtifactsBucket.addToResourcePolicy(codeBuildPolicyStatement);

        const linter_project = Project.fromProjectName(
            this,
            props.prefix + "-linting-codebuild",
            props.prefix + "-linting-codebuild"
        )

        const cfn_nag_project = Project.fromProjectName(
            this,
            props.prefix + "-cfn-nag-codebuild",
            props.prefix + "-cfn-nag-codebuild"
        )

        const git_secrets_project = Project.fromProjectName(
            this,
            props.prefix + "-git-secrets-codebuild",
            props.prefix + "-git-secrets-codebuild",
        )

        const build_project = Project.fromProjectName(
            this,
            props.prefix + "-build-codebuild",
            props.prefix + "-build-codebuild",
        )

        const deploy_project = Project.fromProjectName(
            this,
            props.prefix + "-deploy-codebuild",
            props.prefix + "-deploy-codebuild",
        )


        const sourceArtifact = new Artifact(props.prefix + "-source-input-artifact");
        const source_action = new CodeCommitSourceAction({
            actionName: props.prefix + '-source',
            repository: source_repo,
            output: sourceArtifact
        });


        const linting_action = new CodeBuildAction({
            actionName: props.prefix + '-linting-action',
            project: linter_project,
            input: sourceArtifact,
        });

        const buildArtifact = new Artifact(props.prefix + "-build-artifact");
        const build_action = new CodeBuildAction({
            actionName: props.prefix + '-build-action',
            project: build_project,
            input: sourceArtifact,
            outputs: [buildArtifact],

        });


        const cfn_nag_action = new CodeBuildAction({
            actionName: props.prefix + '-cfn-nag-action',
            project: cfn_nag_project,
            input: buildArtifact,
        });


        const git_secrets_action = new CodeBuildAction({
            actionName: props.prefix + '-git-secrets-action',
            project: git_secrets_project,
            input: sourceArtifact,
        });


        const deploy_action = new CodeBuildAction({
            actionName: props.prefix + '-deploy-action',
            project: deploy_project,
            input: sourceArtifact,
        });


        const manual_action = new ManualApprovalAction({
            actionName: props.prefix + '-deploy-action',
            additionalInformation: `Apruebe este paso después de validar los security findings del stage anterior`
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
                {
                    stageName: props.prefix + "-build-stage",
                    actions: [build_action],
                },
                {
                    stageName: props.prefix + "-security-stage",
                    actions: [cfn_nag_action, git_secrets_action],
                },
                {
                    stageName: props.prefix + "-manual-stage",
                    actions: [manual_action],
                },
                {
                    stageName: props.prefix + "-deploy-stage",
                    actions: [deploy_action],
                },
            ],
        });

    }
}
