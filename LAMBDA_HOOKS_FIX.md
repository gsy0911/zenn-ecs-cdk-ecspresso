# Lambda Hooks 設定完了 ✅

## 概要

ECSネイティブのBlue/Greenデプロイメント（deployment controller: ECS）におけるライフサイクルフックの設定方法を説明します。

## 設定方法

### 1. Lambda関数の配置

Lambda関数のPythonコードは以下に配置されています：

```
infrastructure/lib/constructs/lambda/
├── before_install_hook.py
├── after_install_hook.py
├── before_allow_traffic_hook.py
└── after_allow_traffic_hook.py
```

### 2. ECSサービス定義にlifecycleHooksを設定

`ecspresso/ecs-service-def.json`の`deploymentConfiguration`に`lifecycleHooks`を定義：

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

### 3. ライフサイクルステージの対応

| ライフサイクルステージ | Lambda関数 | タイミング |
|---------------------|-----------|-----------|
| `PRE_SCALE_UP` | BeforeInstallHook | 新しいタスクセットのスケールアップ前 |
| `POST_SCALE_UP` | AfterInstallHook | 新しいタスクセットのスケールアップ後 |
| `TEST_TRAFFIC_SHIFT` | BeforeAllowTrafficHook | テストトラフィックシフト時 |
| `POST_PRODUCTION_TRAFFIC_SHIFT` | AfterAllowTrafficHook | 本番トラフィックシフト後 |

### 4. デプロイ

```bash
# CDKスタックをデプロイ
cd infrastructure
npm run build
npx cdk deploy

# ecspressoでサービスを作成/更新
cd ../ecspresso
ecspresso deploy --config ecspresso.yml
```

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

## Lambda関数のカスタマイズ

Lambda関数のコードを直接編集してカスタマイズできます：

```python
# infrastructure/lib/constructs/lambda/before_install_hook.py
import json
import boto3

def handler(event, context):
    print("BeforeInstall Hook triggered")
    print(json.dumps(event, indent=2))
    
    # カスタムロジックを追加
    # 例: Slack通知、検証処理など
    
    return {
        'statusCode': 200,
        'body': json.dumps('BeforeInstall hook completed successfully')
    }
```

編集後、CDKスタックを再デプロイ：

```bash
cd infrastructure
npm run build
npx cdk deploy
```

## デバッグ

### CloudWatch Logsで確認

```bash
# 各Lambda関数のログを確認
aws logs tail /aws/lambda/ecs-bg-before-install-dev --follow
aws logs tail /aws/lambda/ecs-bg-after-install-dev --follow
aws logs tail /aws/lambda/ecs-bg-before-allow-traffic-dev --follow
aws logs tail /aws/lambda/ecs-bg-after-allow-traffic-dev --follow
```

## 参考リンク

- [ecspresso Blue/Green Deployment](https://github.com/kayac/ecspresso?tab=readme-ov-file#bluegreen-deployment-with-ecs-deployment-controller)
- [Amazon ECS blue/green deployments](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-blue-green.html)
