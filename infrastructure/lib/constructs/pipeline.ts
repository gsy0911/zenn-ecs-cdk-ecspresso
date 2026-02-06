import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import { Env } from "../type";

export interface PipelineProps {
  env: Env;
  ecrRepository: ecr.IRepository;
  ecsCluster: ecs.ICluster;
  githubOwner: string;
  githubRepo: string;
  githubBranch: string;
  githubTokenSecretName: string;
}

export class Pipeline extends Construct {
  public readonly pipeline: codepipeline.Pipeline;
  public readonly codeBuildProject: codebuild.Project;

  constructor(scope: Construct, id: string, props: PipelineProps) {
    super(scope, id);

    const {
      env,
      ecrRepository,
      ecsCluster,
      githubOwner,
      githubRepo,
      githubBranch,
      githubTokenSecretName,
    } = props;

    // CodeBuild Project
    this.codeBuildProject = new codebuild.Project(this, "BuildProject", {
      projectName: `zenn-ecs-cdk-ecspresso-build-${env}`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true, // Docker build requires privileged mode
        computeType: codebuild.ComputeType.SMALL,
        environmentVariables: {
          AWS_REGION: {
            value: cdk.Stack.of(this).region,
          },
          AWS_ACCOUNT_ID: {
            value: cdk.Stack.of(this).account,
          },
          ECR_REPOSITORY_URI: {
            value: ecrRepository.repositoryUri,
          },
          IMAGE_TAG: {
            value: "#{variables.IMAGE_TAG}",
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          },
          CLUSTER_NAME: {
            value: ecsCluster.clusterName,
          },
          ENV: {
            value: env,
          },
        },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          pre_build: {
            commands: [
              "echo Logging in to Amazon ECR...",
              "aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com",
              'echo "IMAGE_TAG: $IMAGE_TAG"',
            ],
          },
          build: {
            commands: [
              "echo Build started on `date`",
              "echo Building the Docker image...",
              "docker build -t $ECR_REPOSITORY_URI:$IMAGE_TAG .",
              "docker tag $ECR_REPOSITORY_URI:$IMAGE_TAG $ECR_REPOSITORY_URI:latest",
            ],
          },
          post_build: {
            commands: [
              "echo Build completed on `date`",
              "echo Pushing the Docker images...",
              "docker push $ECR_REPOSITORY_URI:$IMAGE_TAG",
              "docker push $ECR_REPOSITORY_URI:latest",
              "echo Deploying to ECS with ecspresso...",
              "ecspresso deploy --config ecspresso/ecspresso.yml",
            ],
          },
        },
      }),
    });

    // Grant permissions to CodeBuild
    ecrRepository.grantPullPush(this.codeBuildProject);

    // Grant ECS permissions for ecspresso
    this.codeBuildProject.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ecs:DescribeServices",
          "ecs:DescribeTaskDefinition",
          "ecs:DescribeTasks",
          "ecs:ListTasks",
          "ecs:RegisterTaskDefinition",
          "ecs:UpdateService",
          "ecs:CreateTaskSet",
          "ecs:UpdateServicePrimaryTaskSet",
          "ecs:DeleteTaskSet",
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:DescribeListeners",
          "elasticloadbalancing:ModifyListener",
          "elasticloadbalancing:DescribeRules",
          "elasticloadbalancing:ModifyRule",
        ],
        resources: ["*"],
      }),
    );

    // Grant IAM PassRole permission
    this.codeBuildProject.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["iam:PassRole"],
        resources: ["*"],
        conditions: {
          StringLike: {
            "iam:PassedToService": "ecs-tasks.amazonaws.com",
          },
        },
      }),
    );

    // Grant CloudFormation read permissions for ecspresso
    this.codeBuildProject.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "cloudformation:DescribeStacks",
          "cloudformation:GetTemplate",
          "cloudformation:ListStackResources",
        ],
        resources: ["*"],
      }),
    );

    // Source and Build artifacts
    const sourceOutput = new codepipeline.Artifact("SourceOutput");
    const buildOutput = new codepipeline.Artifact("BuildOutput");

    // Pipeline with V2 features
    const oauth = cdk.SecretValue.secretsManager(githubTokenSecretName, {
      jsonField: "Token",
    });
    this.pipeline = new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: `zenn-ecs-cdk-ecspresso-pipeline-${env}`,
      pipelineType: codepipeline.PipelineType.V2,
      variables: [
        new codepipeline.Variable({
          variableName: "IMAGE_TAG",
          defaultValue: "latest",
          description: "Docker image tag to build and deploy",
        }),
      ],
      stages: [
        {
          stageName: "Source",
          actions: [
            new codepipeline_actions.GitHubSourceAction({
              actionName: "GitHub_Source",
              owner: githubOwner,
              repo: githubRepo,
              branch: githubBranch,
              output: sourceOutput,
              oauthToken: oauth,
                trigger: codepipeline_actions.GitHubTrigger.NONE,
            }),
          ],
        },
        {
          stageName: "Build",
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: "Docker_Build_and_Deploy",
              project: this.codeBuildProject,
              input: sourceOutput,
              outputs: [buildOutput],
              environmentVariables: {
                IMAGE_TAG: {
                  value: "#{variables.IMAGE_TAG}",
                  type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                },
              },
            }),
          ],
        },
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, "PipelineName", {
      key: "PipelineName",
      value: this.pipeline.pipelineName,
    });

    new cdk.CfnOutput(this, "PipelineArn", {
      key: "PipelineArn",
      value: this.pipeline.pipelineArn,
    });

    new cdk.CfnOutput(this, "CodeBuildProjectName", {
      key: "CodeBuildProjectName",
      value: this.codeBuildProject.projectName,
    });
  }
}
