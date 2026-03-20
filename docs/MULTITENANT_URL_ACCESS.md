# マルチテナント + URL単位アクセス制御

## 概要

ユーザーは所属企業内で「許可されたURLのみ」閲覧できる。

- **Aさん**: URL①のみ閲覧可能
- **Bさん**: URL①②閲覧可能
- **admin/master**: 制限なし

## DB構成

| テーブル | 説明 |
|----------|------|
| `users` | company_id で企業に所属 |
| `companies` | 企業マスタ |
| `company_urls` | 企業ごとのURL登録 |
| `user_url_access` | ユーザーごとの閲覧可能URL (user_id, url_id) |
| `scans` | company_id, target_url を持つ |

## マイグレーション

```bash
npm run migrate:multitenant
```

## アクセス制御ルール

1. **一般ユーザー**: 同じ company_id かつ user_url_access に紐づくURLのスキャンのみ閲覧可能
2. **admin/master**: 制限なし
3. **スキャン作成時**: target_url が company_urls に存在しない場合は自動登録し、作成者にアクセス権を付与

## 管理API（admin/master のみ）

- `GET /api/admin/companies/:id/urls` - 企業のURL一覧
- `POST /api/admin/companies/:id/urls` - 企業にURLを追加
- `GET /api/admin/users/:id/url-access` - ユーザーの閲覧可能URL一覧
- `PATCH /api/admin/users/:id` - company_id, url_ids で更新可能

## セットアップ例

1. 企業を作成: `POST /api/admin/companies` { name: "株式会社A" }
2. 企業にURLを登録: `POST /api/admin/companies/1/urls` { url: "https://example.com" }
3. ユーザーを作成: `POST /api/admin/users` { email, password, company_id: 1 }
4. ユーザーにURLアクセスを付与: `PATCH /api/admin/users/1` { url_ids: [1] }
