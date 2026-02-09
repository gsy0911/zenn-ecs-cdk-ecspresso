# Pipeline Construct 使用方法

## 概要

`Pipeline` constructは、CodePipeline V2を使用してGitHubからソースコードを取得し、CodeBuildでDockerイメージをビルド・プッシュ・デプロイを行うパイプラインを構築します。

## 主な機能

- **CodePipeline V2**: パイプライン変数をサポート
- **IMAGE_TAG変数**: ビルド時にカスタムイメージタグを指定可能
- **GitHub統合**: CodeStar Connectionsを使用したGitHub連携
- **CodeBuild**: Dockerイメージのビルドとecspressoによるデプロイ
- **自動デプロイ**: GitHubへのプッシュをトリガーに自動実行

## 前提条件

### 1. GitHub接続の作成

CodePipeline用のGitHub接続を事前に作成する必要があります。

```bash
# AWS Consoleで作成するか、CLIで作成
aws codestar-connections create-connection \
  --provider-type GitHub \
  --connection-name github-connection
```

接続ARNをメモしておいてください（例: `arn:aws:codestar-connections:ap-northeast-1:123456789012:connection/xxxxx`）

**重要**: 接続を作成後、AWSコンソールで接続を承認する必要があります。

## 使い方

### infrastructure-stack.tsに追加

```typescript
import { Pipeline } from "./constructs/pipeline";

export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const env = "dev";
    const containerPort = 8000;

    // 既存のリソース
    const network = new Network(this, "Network", { containerPort });
    const ecs = new Ecs(this, "Ecs", {
      env,
      vpc: network.vpc,
      albSg: network.albSg,
      containerPort,
    });
    const ecspresso = new Ecspresso(this, "Ecspresso", {
      env,
      network,
      ecs,
    });

    // パイプラインを追加
    new Pipeline(this, "Pipeline", {
      env,
      ecrRepository: ecspresso.repository, // ECRリポジトリを取得できるようにEcspressoを修正する必要あり
      ecsCluster: ecs.cluster,
      githubOwner: "your-github-username",
      githubRepo: "your-repo-name",
      githubBranch: "main",
      githubConnectionArn: "arn:aws:codestar-connections:ap-northeast-1:123456789012:connection/xxxxx",
    });
  }
}
```

### デプロイ

```bash
cd infrastructure
npm run build
npx cdk deploy
```

## パイプラインの実行

### 1. 自動実行（推奨）

GitHubのブランチにプッシュすると自動的にパイプラインが実行されます。

```bash
git add .
git commit -m "Update application"
git push origin main
```

### 2. 手動実行（デフォルトタグ）

```bash
aws codepipeline start-pipeline-execution \
  --name zenn-ecs-cdk-ecspresso-pipeline-dev
```

### 3. 手動実行（カスタムタグ指定）

```bash
aws codepipeline start-pipeline-execution \
  --name zenn-ecs-cdk-ecspresso-pipeline-dev \
  --variables name=IMAGE_TAG,value=v1.0.0
```

または、AWSコンソールから実行し、変数を指定することもできます。

## パイプライン変数

### IMAGE_TAG

- **デフォルト値**: `latest`
- **説明**: DockerイメージのタグとしてECRにプッシュされます
- **使用箇所**: 
  - CodeBuildの環境変数
  - Dockerイメージタグ
  - ecspressoデプロイ時の環境変数

## BuildSpec

パイプラインは以下のビルドステップを実行します：

1. **pre_build**: ECRログイン
2. **build**: Dockerイメージのビルドとタグ付け
3. **post_build**: ECRへのプッシュとecspressoによるデプロイ

## 環境変数

CodeBuildで利用可能な環境変数：

- `AWS_REGION`: AWSリージョン
- `AWS_ACCOUNT_ID`: AWSアカウントID
- `ECR_REPOSITORY_URI`: ECRリポジトリURI
- `IMAGE_TAG`: パイプライン変数から渡されるイメージタグ
- `CLUSTER_NAME`: ECSクラスター名
- `ENV`: 環境名（dev/stg/prod）

## 権限

CodeBuildプロジェクトには以下の権限が付与されます：

- ECRへのプッシュ/プル
- ECSサービスの更新
- ターゲットグループとリスナーの操作
- IAM PassRole（ECSタスク用）
- CloudFormationスタックの読み取り（ecspresso用）

## トラブルシューティング

### GitHub接続が未承認

エラー: `Connection is not in AVAILABLE state`

**解決策**: AWSコンソールでCodeStar Connections > Connections から接続を選択し、「Update pending connection」をクリックして承認してください。

### ecspressoのインストール

CodeBuildでecspressoを使用するため、以下をbuildspecに追加することも検討してください：

```yaml
install:
  commands:
    - curl -sL https://github.com/kayac/ecspresso/releases/latest/download/ecspresso_linux_amd64.tar.gz | tar xz
    - mv ecspresso /usr/local/bin/
```

### パイプライン変数が反映されない

CodePipeline V2であることを確認してください。V1ではパイプライン変数がサポートされていません。

```typescript
pipelineType: codepipeline.PipelineType.V2
```

## CI/CDワークフロー例

```
GitHub Push → CodePipeline起動
              ↓
         Source Stage (GitHub)
              ↓
         Build Stage (CodeBuild)
              ↓
         1. ECRログイン
         2. Dockerビルド (IMAGE_TAG)
         3. ECRプッシュ
         4. ecspresso deploy
              ↓
         ECS Blue/Greenデプロイ
```

## 参考リンク

- [AWS CodePipeline V2](https://docs.aws.amazon.com/codepipeline/latest/userguide/pipeline-types.html)
- [CodeStar Connections](https://docs.aws.amazon.com/dtconsole/latest/userguide/welcome-connections.html)
- [ecspresso](https://github.com/kayac/ecspresso)
