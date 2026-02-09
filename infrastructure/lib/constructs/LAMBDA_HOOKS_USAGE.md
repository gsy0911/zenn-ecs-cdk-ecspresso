# ECS Blue/Green デプロイ Lambda Hooks 使用方法

## 概要

ECSネイティブのBlue/Greenデプロイ（deployment controller: ECS）時に、各ライフサイクルフェーズでLambda関数を実行できます。

## Lambda関数のコード配置

Lambda関数は個別のPythonファイルとして管理されています：

```
infrastructure/lib/constructs/lambda/
├── before_install_hook.py          # PRE_SCALE_UP
├── after_install_hook.py           # POST_SCALE_UP
├── before_allow_traffic_hook.py    # TEST_TRAFFIC_SHIFT
└── after_allow_traffic_hook.py     # POST_PRODUCTION_TRAFFIC_SHIFT
```

## ライフサイクルステージと対応関係

| ライフサイクルステージ | Lambda関数 | タイミング |
|---------------------|-----------|-----------|
| `PRE_SCALE_UP` | BeforeInstallHook | 新しいタスクセットのスケールアップ前 |
| `POST_SCALE_UP` | AfterInstallHook | 新しいタスクセットのスケールアップ後 |
| `TEST_TRAFFIC_SHIFT` | BeforeAllowTrafficHook | テストトラフィックシフト時 |
| `POST_PRODUCTION_TRAFFIC_SHIFT` | AfterAllowTrafficHook | 本番トラフィックシフト後 |

その他の利用可能なステージ：
- `POST_TEST_TRAFFIC_SHIFT`: テストトラフィックシフト後
- `PRODUCTION_TRAFFIC_SHIFT`: 本番トラフィックシフト時

## デプロイフロー

```
1. PRE_SCALE_UP (BeforeInstall Hook) 実行
   ↓
2. 新しいタスクセットをスケールアップ
   ↓
3. POST_SCALE_UP (AfterInstall Hook) 実行
   ↓
4. TEST_TRAFFIC_SHIFT (BeforeAllowTraffic Hook) 実行
   ↓
5. テストリスナーへトラフィックをシフト
   ↓
6. bakeTime待機 (デフォルト1分)
   ↓
7. 本番リスナーへトラフィックをシフト
   ↓
8. POST_PRODUCTION_TRAFFIC_SHIFT (AfterAllowTraffic Hook) 実行
   ↓
9. デプロイ完了
```

## 設定方法

### 1. ecs-service-def.jsonにlifecycleHooksを定義

```json
{
  "deploymentConfiguration": {
    "bakeTimeInMinutes": 1,
    "lifecycleHooks": [
      {
        "hookTargetArn": "{{ cfn_output `zenn-ecs-cdk-ecspresso` `BeforeInstallHookArn` }}",
        "lifecycleStages": ["PRE_SCALE_UP"],
        "roleArn": "{{ cfn_output `zenn-ecs-cdk-ecspresso` `EcsBlueGreenDeployRoleArn` }}"
      },
      {
        "hookTargetArn": "{{ cfn_output `zenn-ecs-cdk-ecspresso` `AfterInstallHookArn` }}",
        "lifecycleStages": ["POST_SCALE_UP"],
        "roleArn": "{{ cfn_output `zenn-ecs-cdk-ecspresso` `EcsBlueGreenDeployRoleArn` }}"
      },
      {
        "hookTargetArn": "{{ cfn_output `zenn-ecs-cdk-ecspresso` `BeforeAllowTrafficHookArn` }}",
        "lifecycleStages": ["TEST_TRAFFIC_SHIFT"],
        "roleArn": "{{ cfn_output `zenn-ecs-cdk-ecspresso` `EcsBlueGreenDeployRoleArn` }}"
      },
      {
        "hookTargetArn": "{{ cfn_output `zenn-ecs-cdk-ecspresso` `AfterAllowTrafficHookArn` }}",
        "lifecycleStages": ["POST_PRODUCTION_TRAFFIC_SHIFT"],
        "roleArn": "{{ cfn_output `zenn-ecs-cdk-ecspresso` `EcsBlueGreenDeployRoleArn` }}"
      }
    ],
    "maximumPercent": 200,
    "minimumHealthyPercent": 100,
    "strategy": "BLUE_GREEN"
  }
}
```

### 2. CDKデプロイ

```bash
cd infrastructure
npm run build
npx cdk deploy
```

これにより以下がデプロイされます：
- 4つのLambda関数（各ライフサイクルフック用）
- Lambda関数のARNがCloudFormation Outputとして出力
- ECSサービスからのLambda呼び出し権限を自動設定

### 3. ecspressoでサービスをデプロイ

```bash
cd ecspresso
ecspresso deploy --config ecspresso.yml
```

## Lambda関数のカスタマイズ

Lambda関数は個別のPythonファイルとして管理されているため、直接編集できます。

### 例: Slack通知を追加

```python
# infrastructure/lib/constructs/lambda/before_install_hook.py
import json
import boto3
import urllib3

http = urllib3.PoolManager()

def handler(event, context):
    print("BeforeInstall Hook triggered")
    print(json.dumps(event, indent=2))
    
    # Slack通知
    slack_url = "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
    message = {
        "text": f"🚀 Blue/Green デプロイ開始: {event.get('serviceArn')}"
    }
    
    http.request(
        'POST',
        slack_url,
        body=json.dumps(message),
        headers={'Content-Type': 'application/json'}
    )
    
    # ECS Blue/Greenデプロイメントに必要な返り値
    return {
        "hookStatus": "SUCCEEDED"
    }
```

編集後、CDKスタックを再デプロイ：

```bash
cd infrastructure
npm run build
npx cdk deploy
```

## Lambda関数のイベントペイロードと返り値

### イベントペイロード

各Lambda関数には以下の情報が渡されます（ECSネイティブB/G）：

```json
{
  "serviceArn": "arn:aws:ecs:us-west-2:1234567890:service/myCluster/myService",
  "targetServiceRevisionArn": "arn:aws:ecs:us-west-2:1234567890:service-revision/myCluster/myService/01275892",
  "testTrafficWeights": {
    "arn:aws:ecs:us-west-2:1234567890:service-revision/myCluster/myService/01275892": 100
  },
  "productionTrafficWeights": {
    "arn:aws:ecs:us-west-2:1234567890:service-revision/myCluster/myService/78652123": 100
  }
}
```

### 返り値（重要）

Lambda関数は以下の形式で返す必要があります：

```python
# デプロイを継続
return {
    "hookStatus": "SUCCEEDED"
}

# デプロイを中止（ロールバック）
return {
    "hookStatus": "FAILED"
}

# 処理継続中（再試行される）
return {
    "hookStatus": "IN_PROGRESS",
    "callBackDelay": 60  # オプション: 再試行までの秒数（デフォルト30秒）
}
```

**注意**: `Lifecycle`ではなく`hookStatus`が必要です。

## ユースケース例

### 1. Slack/Teams通知

```python
def handler(event, context):
    service_arn = event.get('serviceArn')
    target_revision = event.get('targetServiceRevisionArn')
    send_slack_notification(f"デプロイ中: {service_arn}")
    
    return {"hookStatus": "SUCCEEDED"}
```

### 2. ヘルスチェック

```python
import requests

def handler(event, context):
    # 新しいタスクセットのエンドポイントをチェック
    response = requests.get("http://test-endpoint:8080/health")
    
    if response.status_code != 200:
        # ヘルスチェック失敗時はデプロイを中止
        return {"hookStatus": "FAILED"}
    
    return {"hookStatus": "SUCCEEDED"}
```

### 3. データベースマイグレーション

```python
def handler(event, context):
    # POST_SCALE_UPフックで実行
    try:
        run_database_migrations()
    except Exception as e:
        print(f"Migration failed: {e}")
        return {"hookStatus": "FAILED"}
    
    return {"hookStatus": "SUCCEEDED"}
```

### 4. メトリクス監視

```python
import boto3

def handler(event, context):
    cloudwatch = boto3.client('cloudwatch')
    
    # メトリクスを取得して確認
    metrics = cloudwatch.get_metric_statistics(...)
    
    if metrics['Average'] > threshold:
        print("Metrics exceed threshold")
        return {"hookStatus": "FAILED"}
    
    return {"hookStatus": "SUCCEEDED"}
```

### 5. 長時間処理の場合（IN_PROGRESS）

```python
def handler(event, context):
    # 処理が完了していない場合
    if not is_ready():
        return {
            "hookStatus": "IN_PROGRESS",
            "callBackDelay": 60  # 60秒後に再実行
        }
    
    return {"hookStatus": "SUCCEEDED"}
```

## エラーハンドリング

Lambda関数がエラーを返す（例外を投げる）か、`"hookStatus": "FAILED"`を返すと、デプロイがロールバックします：

```python
def handler(event, context):
    try:
        # 検証ロジック
        if not validation_passed():
            # デプロイを中止
            return {"hookStatus": "FAILED"}
        
        return {"hookStatus": "SUCCEEDED"}
    except Exception as e:
        print(f"Error: {str(e)}")
        # 例外が発生した場合もデプロイが停止
        return {"hookStatus": "FAILED"}
```

## Lambda関数の権限

Lambda関数には以下の権限が自動的に付与されます：
- `ecs:DescribeServices`
- `ecs:DescribeTaskDefinition`
- `ecs:DescribeTasks`
- `elasticloadbalancing:DescribeTargetHealth`
- `cloudwatch:PutMetricData`
- CloudWatch Logs書き込み

追加の権限が必要な場合は、`pipeline.ts`で追加してください。

## デバッグ

### CloudWatch Logsで確認

```bash
# Lambda関数のログを確認
aws logs tail /aws/lambda/ecs-bg-before-install-dev --follow
aws logs tail /aws/lambda/ecs-bg-after-install-dev --follow
aws logs tail /aws/lambda/ecs-bg-before-allow-traffic-dev --follow
aws logs tail /aws/lambda/ecs-bg-after-allow-traffic-dev --follow
```

### ecspressoでデプロイ状況確認

```bash
ecspresso status --config ecspresso.yml
```

## 注意事項

- Lambda関数のタイムアウトはデフォルト5分
- 各フックは同期的に実行される
- フックが失敗するとデプロイ全体が停止する
- 複数のライフサイクルステージを1つのフックに割り当て可能

## 参考リンク

- [ecspresso Blue/Green Deployment](https://github.com/kayac/ecspresso?tab=readme-ov-file#bluegreen-deployment-with-ecs-deployment-controller)
- [ECS Blue/Green Deployments](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-blue-green.html)
- [ECS Deployment Lifecycle Hooks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-bluegreen.html#deployment-lifecycle-hooks)
