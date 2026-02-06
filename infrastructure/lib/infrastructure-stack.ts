import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Network } from "./constructs/network";
import { Ecs } from "./constructs/ecs";
import { Ecspresso } from "./constructs/ecspresso";
import { Pipeline } from "./constructs/pipeline";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";

export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    const containerPort = 8000;

    const network = new Network(this, "Network", {
      containerPort,
    });

    const ecs = new Ecs(this, "Ecs", {
      env: "dev",
      vpc: network.vpc,
      albSg: network.albSg,
      containerPort,
    });

    const ecspresso = new Ecspresso(this, "Ecspresso", {
      env: "dev",
      network,
      ecs,
    });

    new Pipeline(this, "Pipeline", {
      env: "dev",
      ecrRepository: ecspresso.repository,
      ecsCluster: ecs.cluster,
      githubOwner: "gsy0911",
      githubRepo: "zenn-ecs-cdk-ecspresso",
      githubBranch: "main",
      githubTokenSecretName: "GitHubFineGrainedToken-CodeBuild",
    });
  }
}
