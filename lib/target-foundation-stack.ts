import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

interface TargetProps extends cdk.StackProps {
    env_name: string,
    prefix: string,
    env_devops: cdk.Environment
}

export class TargetStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: TargetProps) {
        super(scope, id, props);

        // Crear un CodeCommit repository
        const cross_account_role = new iam.Role(
            this,
            props.prefix + "-cross-env-role",
            {
                roleName: props.prefix + "-cross-env-role",
                assumedBy: new iam.AccountPrincipal(props.env_devops.account)
            }
        )

        const deployPolicy = new iam.Policy(
            this,
            props.prefix + "-cross-account-deploy-policy",
            {
                policyName: props.prefix + "-cross-account-deploy-policy",
                statements: [
                    new iam.PolicyStatement({
                        actions: ['sts:AssumeRole'],
                        resources: ["arn:aws:iam::" + props.env_devops.account + ":role/cdk-*"],
                        effect: iam.Effect.ALLOW,
                    }),
                ],
            });

        cross_account_role.attachInlinePolicy(deployPolicy);



    }
}
