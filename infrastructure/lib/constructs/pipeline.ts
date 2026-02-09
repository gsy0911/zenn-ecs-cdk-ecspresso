import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";
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
  public readonly beforeInstallHook: lambda.Function;
  public readonly afterInstallHook: lambda.Function;
  public readonly beforeAllowTrafficHook: lambda.Function;
  public readonly afterAllowTrafficHook: lambda.Function;

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

    // Lambda Hooks for Blue/Green Deployment
    // BeforeInstall Hook
    this.beforeInstallHook = new lambda.Function(this, "BeforeInstallHook", {
      functionName: `ecs-bg-before-install-${env}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "before_install_hook.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "lambda"),
      ),
      timeout: cdk.Duration.minutes(5),
    });

    // AfterInstall Hook
    this.afterInstallHook = new lambda.Function(this, "AfterInstallHook", {
      functionName: `ecs-bg-after-install-${env}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "after_install_hook.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "lambda"),
      ),
      timeout: cdk.Duration.minutes(5),
    });

    // BeforeAllowTraffic Hook
    this.beforeAllowTrafficHook = new lambda.Function(
      this,
      "BeforeAllowTrafficHook",
      {
        functionName: `ecs-bg-before-allow-traffic-${env}`,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "before_allow_traffic_hook.handler",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "lambda"),
        ),
        timeout: cdk.Duration.minutes(5),
      },
    );

    // AfterAllowTraffic Hook
    this.afterAllowTrafficHook = new lambda.Function(
      this,
      "AfterAllowTrafficHook",
      {
        functionName: `ecs-bg-after-allow-traffic-${env}`,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "after_allow_traffic_hook.handler",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "lambda"),
        ),
        timeout: cdk.Duration.minutes(5),
      },
    );

    // Grant necessary permissions to Lambda functions
    const lambdaPermissions = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ecs:DescribeServices",
        "ecs:DescribeTaskDefinition",
        "ecs:DescribeTasks",
        "elasticloadbalancing:DescribeTargetHealth",
        "cloudwatch:PutMetricData",
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ],
      resources: ["*"],
    });

    this.beforeInstallHook.addToRolePolicy(lambdaPermissions);
    this.afterInstallHook.addToRolePolicy(lambdaPermissions);
    this.beforeAllowTrafficHook.addToRolePolicy(lambdaPermissions);
    this.afterAllowTrafficHook.addToRolePolicy(lambdaPermissions);

    // Grant ECS service permission to invoke Lambda hooks
    this.beforeInstallHook.grantInvoke(
      new iam.ServicePrincipal("ecs.amazonaws.com"),
    );
    this.afterInstallHook.grantInvoke(
      new iam.ServicePrincipal("ecs.amazonaws.com"),
    );
    this.beforeAllowTrafficHook.grantInvoke(
      new iam.ServicePrincipal("ecs.amazonaws.com"),
    );
    this.afterAllowTrafficHook.grantInvoke(
      new iam.ServicePrincipal("ecs.amazonaws.com"),
    );

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
          BEFORE_INSTALL_HOOK_ARN: {
            value: this.beforeInstallHook.functionArn,
          },
          AFTER_INSTALL_HOOK_ARN: {
            value: this.afterInstallHook.functionArn,
          },
          BEFORE_ALLOW_TRAFFIC_HOOK_ARN: {
            value: this.beforeAllowTrafficHook.functionArn,
          },
          AFTER_ALLOW_TRAFFIC_HOOK_ARN: {
            value: this.afterAllowTrafficHook.functionArn,
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

    // Grant Lambda invoke permissions for lifecycle hooks
    this.codeBuildProject.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["lambda:InvokeFunction"],
        resources: [
          this.beforeInstallHook.functionArn,
          this.afterInstallHook.functionArn,
          this.beforeAllowTrafficHook.functionArn,
          this.afterAllowTrafficHook.functionArn,
        ],
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

    // Lambda Hook ARNs for ecspresso
    new cdk.CfnOutput(this, "BeforeInstallHookArn", {
      key: "BeforeInstallHookArn",
      value: this.beforeInstallHook.functionArn,
    });

    new cdk.CfnOutput(this, "AfterInstallHookArn", {
      key: "AfterInstallHookArn",
      value: this.afterInstallHook.functionArn,
    });

    new cdk.CfnOutput(this, "BeforeAllowTrafficHookArn", {
      key: "BeforeAllowTrafficHookArn",
      value: this.beforeAllowTrafficHook.functionArn,
    });

    new cdk.CfnOutput(this, "AfterAllowTrafficHookArn", {
      key: "AfterAllowTrafficHookArn",
      value: this.afterAllowTrafficHook.functionArn,
    });
  }
}
