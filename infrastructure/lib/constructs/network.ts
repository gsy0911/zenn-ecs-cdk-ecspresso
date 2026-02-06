import { Construct } from "constructs";
import { aws_ec2, CfnOutput } from "aws-cdk-lib";

export interface NetworkProps {
  containerPort?: number;
}

export class Network extends Construct {
  public readonly vpc: aws_ec2.Vpc;
  public readonly albSg: aws_ec2.SecurityGroup;
  public readonly ecsSg: aws_ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkProps = {}) {
    super(scope, id);

    const containerPort = props.containerPort || 8000;

    // VPC
    this.vpc = new aws_ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: aws_ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "Private",
          subnetType: aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Security Group for ALB
    this.albSg = new aws_ec2.SecurityGroup(this, "AlbSg", {
      vpc: this.vpc,
      allowAllOutbound: true,
      description: "Security Group for Application Load Balancer",
    });
    this.albSg.addIngressRule(
      aws_ec2.Peer.anyIpv4(),
      aws_ec2.Port.tcp(80),
      "Allow HTTP traffic from anywhere",
    );

    // Security Group for ECS Tasks
    this.ecsSg = new aws_ec2.SecurityGroup(this, "EcsSg", {
      vpc: this.vpc,
      allowAllOutbound: true,
      description: "Security Group for ECS Tasks",
    });
    // Allow traffic from ALB
    this.ecsSg.addIngressRule(
      this.albSg,
      aws_ec2.Port.tcp(containerPort),
      "Allow traffic from ALB",
    );

    new CfnOutput(this, "PrivateSubnet1", {
      key: "PrivateSubnet1",
      value: this.vpc.privateSubnets[0].subnetId,
    });

    new CfnOutput(this, "PrivateSubnet2", {
      key: "PrivateSubnet2",
      value: this.vpc.privateSubnets[1].subnetId,
    });

    new CfnOutput(this, "PublicSubnet1", {
      key: "PublicSubnet1",
      value: this.vpc.publicSubnets[0].subnetId,
    });

    new CfnOutput(this, "PublicSubnet2", {
      key: "PublicSubnet2",
      value: this.vpc.publicSubnets[1].subnetId,
    });
  }
}
