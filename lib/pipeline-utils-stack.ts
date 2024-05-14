import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  PipelineProject,
  LinuxBuildImage,
  BuildSpec
} from 'aws-cdk-lib/aws-codebuild'
import * as iam from 'aws-cdk-lib/aws-iam';

interface PipelineUtilsProps extends cdk.StackProps {
  prefix: string,
  env_name: string
}

export class PipelineUtilsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineUtilsProps) {
    super(scope, id, props);



    const linting_project = new PipelineProject(this, props.prefix + "-linting-codebuild", {
      projectName: props.prefix + "-linting-codebuild",
      environment: {
        buildImage: LinuxBuildImage.STANDARD_7_0,
      },
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              nodejs: '18',
            },
            commands: ['node -v'],
          },
          build: {
            commands: ['cd ./cdk-code', 'npm install', 'npm run eslint'],
          },
        },
      }),
    });

    // Crear un CodeBuild para Security
    const cfn_nag_project = new PipelineProject(this, props.prefix + "-cfn-nag-codebuild", {
      projectName: props.prefix + "-cfn-nag-codebuild",
      environment: {
        buildImage: LinuxBuildImage.STANDARD_7_0,
      },
      timeout: cdk.Duration.minutes(100),
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              ruby: '3.2',
            },
            commands: ['gem install cfn-nag'],
          },
          build: {
            commands: [
              'cd ./cdk-code',
              'find ./cdk.out -type f -name "*.template.json" | xargs -I {} cfn_nag_scan --deny-list-path cfn-nag-deny-list.yml --input-path {}',
            ],
          },
        },
      }),
    });

    // Crear un CodeBuild para Security
    const git_secrets_project = new PipelineProject(this, props.prefix + "-git-secrets-codebuild", {
      projectName: props.prefix + "-git-secrets-codebuild",
      environment: {
        buildImage: LinuxBuildImage.STANDARD_7_0,
      },
      timeout: cdk.Duration.minutes(100),
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              python: '3.11',
            },
            commands: [
              "BASIC_FOLDER=$(pwd)",
              'git clone https://github.com/awslabs/git-secrets.git',
              'cd git-secrets',
              'sudo make install'
            ],
          },
          build: {
            commands: [
              'git secrets --register-aws --global',
              'cd "$BASIC_FOLDER"',
              `  git rev-parse --git-dir > /dev/null 2>&1 || {
                             git init --quiet
                             git add -A .
                          }
                          `,
              "git secrets --add --allowed 'config/*'",
              "git secrets --scan"
            ],
          },
        },
      }),
    });


    // Crear un CodeBuild para Synth
    const build_project = new PipelineProject(this, props.prefix + "-build-codebuild", {
      projectName: props.prefix + "-build-codebuild",
      environment: {
        buildImage: LinuxBuildImage.STANDARD_7_0,
      },
      timeout: cdk.Duration.minutes(100),
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              nodejs: '18',
            },
            commands: [
              'node -v',
              'sudo npm install -g aws-cdk'
            ],
          },
          build: {
            commands: [
              'npm install',
              `cdk synth -c config=${props.env_name}`
            ],
          },
        },
        artifacts: {
          'base-directory': '.',
          files: ['**/*'],
          'exclude-paths': ['node_modules/**'],
        },
      }),
    });

    const deploy_project = new PipelineProject(this, props.prefix + "-deploy-codebuild", {
      projectName: props.prefix + "-deploy-codebuild",
      environment: {
        buildImage: LinuxBuildImage.STANDARD_7_0,
      },
      timeout: cdk.Duration.minutes(100),
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              nodejs: '18',
            },
            commands: [
              'node -v',
              'sudo npm install -g aws-cdk'
            ],
          },
          build: {
            commands: [
              'npm install',
              `cdk deploy --all -c config=${props.env_name} --method=direct --require-approval never`,
            ],
          },
        },
      }),
    });
    /*
        deploy_project.addToRolePolicy(
          new iam.PolicyStatement({
            actions: ['sts:AssumeRole'],
            resources: ['*'],
          })
        );
    */

  }
}
