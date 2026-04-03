#!/usr/bin/env bash
# digital-eyes.site などの A レコードを EC2 のパブリック IP（推奨: Elastic IP）に向ける。
# Amazon Route 53 のホストゾーンがある場合のみ使えます。
#
# それ以外（お名前.com / Cloudflare / Google Domains 等）の場合:
#   管理画面で「A レコード」を EC2 の Elastic IP に変更する。
#   CDN を使う場合はオリジンを同じ IP に合わせる。
#
# 使い方:
#   export AWS_PROFILE=default
#   export ROUTE53_ZONE_ID=Zxxxxxxxx
#   export RECORD_NAME=digital-eyes.site.   # 末尾のドット必須
#   export TARGET_IP=52.195.168.63          # Elastic IP 推奨
#   bash scripts/route53-upsert-a.sh
#
# ゾーン ID の調べ方:
#   aws route53 list-hosted-zones --query "HostedZones[?Name=='digital-eyes.site.'].Id" --output text
#
set -euo pipefail

: "${ROUTE53_ZONE_ID:?環境変数 ROUTE53_ZONE_ID を設定（例: Z1234567890ABC）}"
: "${RECORD_NAME:?環境変数 RECORD_NAME を設定（例: digital-eyes.site. 末尾ドット付き）}"
: "${TARGET_IP:?環境変数 TARGET_IP を設定（EC2 の Elastic IP）}"

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

# shellcheck disable=SC2016
printf '%s\n' '{
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "'"${RECORD_NAME//\"/\\\"}"'",
      "Type": "A",
      "TTL": 300,
      "ResourceRecords": [{"Value": "'"${TARGET_IP//\"/\\\"}"'"}]
    }
  }]
}' > "$TMP"

aws route53 change-resource-record-sets \
  --hosted-zone-id "$ROUTE53_ZONE_ID" \
  --change-batch "file://$TMP"

echo "OK: UPSERT A $RECORD_NAME -> $TARGET_IP (TTL 300)"
