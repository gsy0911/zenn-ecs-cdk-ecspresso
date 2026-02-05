import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface NetworkProps {
  containerPort?: number;
}

export class Network extends Construct {
  public readonly vpc: ec2.Vpc;
  public readonly albSg: ec2.SecurityGroup;
  public readonly ecsSg: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkProps = {}) {
    super(scope, id);

    const containerPort = props.containerPort || 8000;

    // VPC
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Security Group for ALB
    this.albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc: this.vpc,
      allowAllOutbound: true,
      description: 'Security Group for Application Load Balancer',
    });
    this.albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP traffic from anywhere');

    // Security Group for ECS Tasks
    this.ecsSg = new ec2.SecurityGroup(this, 'EcsSg', {
      vpc: this.vpc,
      allowAllOutbound: true,
      description: 'Security Group for ECS Tasks',
    });
    // Allow traffic from ALB
    this.ecsSg.addIngressRule(this.albSg, ec2.Port.tcp(containerPort), 'Allow traffic from ALB');
  }
}
