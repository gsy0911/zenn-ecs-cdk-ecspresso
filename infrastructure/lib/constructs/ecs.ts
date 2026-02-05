import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Duration } from 'aws-cdk-lib';

export interface EcsProps {
  vpc: ec2.Vpc;
  albSg: ec2.SecurityGroup;
  containerPort: number;
}

export class Ecs extends Construct {
  public readonly cluster: ecs.Cluster;
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly listener: elbv2.ApplicationListener;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: EcsProps) {
    super(scope, id);

    const { vpc, albSg } = props;

    // ECS Cluster
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: 'zenn-ecs-cdk-ecspresso-cluster',
      containerInsights: true,
    });

    // ALB
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    // ALB Listener
    this.listener = this.alb.addListener('Listener', {
      port: 80,
    });

    // Target Group
    // Note: This target group will be used by the ECS Service managed by ecspresso
    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc,
      port: props.containerPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      deregistrationDelay: Duration.seconds(30),
      healthCheck: {
        path: '/',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
        timeout: Duration.seconds(5),
        interval: Duration.seconds(10),
      },
    });

    this.listener.addTargetGroups('DefaultTarget', {
      targetGroups: [this.targetGroup],
    });
  }
}
