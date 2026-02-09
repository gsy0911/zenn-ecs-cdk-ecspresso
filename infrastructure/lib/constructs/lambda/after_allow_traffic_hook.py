import json
import boto3

def handler(event, context):
    print("AfterAllowTraffic Hook triggered")
    print(json.dumps(event, indent=2))
    
    # トラフィック切り替え後の処理
    # 例: メトリクス確認、通知、クリーンアップなど
    
    # ECS Blue/Greenデプロイメントに必要な返り値
    return {
        "hookStatus": "SUCCEEDED"  # または "FAILED" でデプロイを中止
    }
