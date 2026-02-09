import json
import boto3

def handler(event, context):
    print("BeforeInstall Hook triggered")
    print(json.dumps(event, indent=2))
    
    # デプロイ情報を取得
    service_arn = event.get('serviceArn', 'N/A')
    target_revision = event.get('targetServiceRevisionArn', 'N/A')
    
    print(f"ServiceArn: {service_arn}")
    print(f"TargetServiceRevisionArn: {target_revision}")
    
    # ここでデプロイ前のカスタムロジックを実装
    # 例: 通知、検証、準備処理など
    
    # ECS Blue/Greenデプロイメントに必要な返り値
    return {
        "hookStatus": "SUCCEEDED"  # または "FAILED" でデプロイを中止
    }
