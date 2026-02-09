import json
import boto3

def handler(event, context):
    print("AfterInstall Hook triggered")
    print(json.dumps(event, indent=2))
    
    # 新しいタスクセットがインストールされた後の処理
    # 例: ヘルスチェック、初期化処理など
    
    # ECS Blue/Greenデプロイメントに必要な返り値
    return {
        "hookStatus": "SUCCEEDED"  # または "FAILED" でデプロイを中止
    }
