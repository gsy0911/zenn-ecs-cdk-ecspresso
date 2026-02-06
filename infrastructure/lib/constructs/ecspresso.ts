import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { Network } from "./network";
import { Ecs } from "./ecs";

export interface EcspressoProps {
  network: Network;
  ecs: Ecs;
}

export class Ecspresso extends Construct {
  constructor(scope: Construct, id: string, props: EcspressoProps) {
    super(scope, id);

    const { network, ecs } = props;

    // ECR Repository
    const repository = new ecr.Repository(this, "Repository", {
      repositoryName: "zenn-ecs-cdk-ecspresso-repo",
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For demonstration purposes
      autoDeleteImages: true,
    });

    // Task Execution Role
    const executionRole = new iam.Role(this, "ExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy",
        ),
      ],
    });

    // Log Group
    const logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: "/ecs/zenn-ecs-cdk-ecspresso-task",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Outputs for ecspresso
    new cdk.CfnOutput(this, "ClusterName", {
      value: ecs.cluster.clusterName,
    });

    new cdk.CfnOutput(this, "ServiceSecurityGroupId", {
      value: network.ecsSg.securityGroupId,
    });

    new cdk.CfnOutput(this, "TargetGroupArn", {
      value: ecs.targetGroup.targetGroupArn,
    });

    new cdk.CfnOutput(this, "EcrRepositoryUri", {
      value: repository.repositoryUri,
    });

    new cdk.CfnOutput(this, "TaskExecutionRoleArn", {
      value: executionRole.roleArn,
    });

    new cdk.CfnOutput(this, "LogGroupName", {
      value: logGroup.logGroupName,
    });

    new cdk.CfnOutput(this, "PrivateSubnet1", {
      value: network.vpc.privateSubnets[0].subnetId,
    });

    new cdk.CfnOutput(this, "PrivateSubnet2", {
      value: network.vpc.privateSubnets[1].subnetId,
    });
  }
}
