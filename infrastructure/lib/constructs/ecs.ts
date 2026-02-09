import { Construct } from "constructs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Duration } from "aws-cdk-lib";
import { Env } from "../type";
import { aws_iam, CfnOutput } from "aws-cdk-lib";

export interface EcsProps {
  env: Env;
  vpc: ec2.Vpc;
  albSg: ec2.SecurityGroup;
  containerPort: number;
}

export class Ecs extends Construct {
  public readonly cluster: ecs.Cluster;
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly listener80: elbv2.ApplicationListener;
  public readonly listener8080: elbv2.ApplicationListener;
  public readonly targetGroupBlue: elbv2.ApplicationTargetGroup;
  public readonly targetGroupGreen: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: EcsProps) {
    super(scope, id);

    const { env, vpc, albSg } = props;

    // ECS Cluster
    this.cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      clusterName: `zenn-ecs-cdk-ecspresso-cluster-${env}`,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    // ALB
    this.alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    /**
     * DeployActionRole
     * see: https://docs.aws.amazon.com/ja_jp/AmazonECS/latest/developerguide/codedeploy_IAM_role.html
     */
    const deployRole = new aws_iam.Role(this, "DeployRole", {
      roleName: `ecs-blue-green-deploy-role-${env}`,
      assumedBy: new aws_iam.ServicePrincipal("ecs.amazonaws.com"),
      managedPolicies: [
        aws_iam.ManagedPolicy.fromManagedPolicyArn(
          this,
          "deployByEcs",
          "arn:aws:iam::aws:policy/AmazonECSInfrastructureRolePolicyForLoadBalancers",
        ),
      ],
      inlinePolicies: {
        policies: new aws_iam.PolicyDocument({
          statements: [
            new aws_iam.PolicyStatement({
              effect: aws_iam.Effect.ALLOW,
              resources: ["*"],
              actions: [
                "ecs:DescribeServices",
                "ecs:CreateTaskSet",
                "ecs:UpdateServicePrimaryTaskSet",
                "ecs:DeleteTaskSet",
                "elasticloadbalancing:DescribeTargetGroups",
                "elasticloadbalancing:DescribeListeners",
                "elasticloadbalancing:ModifyListener",
                "elasticloadbalancing:DescribeRules",
                "elasticloadbalancing:ModifyRule",
                "lambda:InvokeFunction",
                "cloudwatch:DescribeAlarms",
                "sns:Publish",
                "codedeploy:Get*",
                "codedeploy:RegisterApplicationRevision",
                "kms:Decrypt",
                "kms:DescribeKey",
              ],
            }),
            new aws_iam.PolicyStatement({
              effect: aws_iam.Effect.ALLOW,
              resources: ["*"],
              actions: ["iam:PassRole"],
              conditions: {
                StringLike: {
                  "iam:PassedToService": "ecs-tasks.amazonaws.com",
                },
              },
            }),
          ],
        }),
      },
    });

    // ALB Listener
    this.listener80 = this.alb.addListener("Listener", {
      port: 80,
      defaultAction: elbv2.ListenerAction.fixedResponse(503, {
        contentType: "text/plain",
        messageBody: "Service Unavailable",
      }),
    });
    this.listener8080 = this.alb.addListener("Listener8080", {
      port: 8080,
      defaultAction: elbv2.ListenerAction.fixedResponse(503, {
        contentType: "text/plain",
        messageBody: "Service Unavailable",
      }),
    });

    // Target Group
    // Note: This target group will be used by the ECS Service managed by ecspresso
    this.targetGroupBlue = new elbv2.ApplicationTargetGroup(
      this,
      "TargetGroupBlue",
      {
        targetGroupName: `ecspresso-tg-blue-${env}`,
        vpc,
        port: props.containerPort,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targetType: elbv2.TargetType.IP,
        deregistrationDelay: Duration.seconds(30),
        healthCheck: {
          path: "/",
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 2,
          timeout: Duration.seconds(5),
          interval: Duration.seconds(10),
        },
      },
    );
    this.targetGroupGreen = new elbv2.ApplicationTargetGroup(
      this,
      "TargetGroupGreen",
      {
        targetGroupName: `ecspresso-tg-green-${env}`,
        vpc,
        port: props.containerPort,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targetType: elbv2.TargetType.IP,
        deregistrationDelay: Duration.seconds(30),
        healthCheck: {
          path: "/",
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 2,
          timeout: Duration.seconds(5),
          interval: Duration.seconds(10),
        },
      },
    );

    // Listener Rules for Blue/Green deployment
    const productionListenerRule = new elbv2.ApplicationListenerRule(
      this,
      "ProductionListenerRule",
      {
        listener: this.listener80,
        priority: 1,
        conditions: [elbv2.ListenerCondition.pathPatterns(["/*"])],
        targetGroups: [this.targetGroupBlue],
      },
    );

    const testListenerRule = new elbv2.ApplicationListenerRule(
      this,
      "TestListenerRule",
      {
        listener: this.listener8080,
        priority: 1,
        conditions: [elbv2.ListenerCondition.pathPatterns(["/*"])],
        targetGroups: [this.targetGroupGreen],
      },
    );

    new CfnOutput(this, "ProductionListenerRuleArn", {
      key: "ProductionListenerRuleArn",
      value: productionListenerRule.listenerRuleArn,
    });
    new CfnOutput(this, "TestListenerRuleArn", {
      key: "TestListenerRuleArn",
      value: testListenerRule.listenerRuleArn,
    });
    new CfnOutput(this, "TargetGroupBlueArn", {
      key: "TargetGroupBlueArn",
      value: this.targetGroupBlue.targetGroupArn,
    });
    new CfnOutput(this, "TargetGroupGreenArn", {
      key: "TargetGroupGreenArn",
      value: this.targetGroupGreen.targetGroupArn,
    });
    new CfnOutput(this, "EcsBlueGreenDeployRoleArn", {
      key: "EcsBlueGreenDeployRoleArn",
      value: deployRole.roleArn,
    });
  }
}
