import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Network } from './constructs/network';
import { Ecs } from './constructs/ecs';
import { Ecspresso } from './constructs/ecspresso';

export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    const containerPort = 8000;

    const network = new Network(this, 'Network', {
      containerPort,
    });

    const ecs = new Ecs(this, 'Ecs', {
      vpc: network.vpc,
      albSg: network.albSg,
      containerPort,
    });

    new Ecspresso(this, 'Ecspresso', {
      network,
      ecs,
    });
  }
}
