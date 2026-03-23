# 重複ページ タスク生成ロジック（改善版）

## 1. URLパラメータ重複（fix_url_param_dup_*）

### URLの収集
```
対象URL = scan_pages のURL ∪ GSC のURL（GSC連携時のみ）
```

### パラメータの分類・フィルタリング

| 種別 | 例 | タスク化 |
|------|-----|---------|
| トラッキング系 | utm_source, utm_medium, fbclid, gclid | ✅ する |
| セッション系 | sessionid, sid, token | ✅ する |
| ページネーション系 | page, p, offset | ❌ しない |
| ソート・フィルター系 | sort, order, filter | ❌ しない |
| その他（不明） | - | ⚠️ `DUPLICATE_TASK_INCLUDE_OTHER_PARAMS=1` で切替可 |

### 重複排除・冪等性
- 正規化URL（パラメータ除去後の origin+pathname）で1タスクのみ
- タスクID = `fix_url_param_dup_{正規化URLのハッシュ}`
- 再生成時は UPSERT（増殖しない）

---

## 2. タイトル重複（fix_dup_title_*）

### 判定ロジック
```
正規化タイトル = lowercase(trim(title))
同一正規化タイトルが 2ページ以上 → 1タスク生成（タイトル単位）
```

### 冪等性
- タスクID = `fix_dup_title_{正規化タイトルのハッシュ}`
- 再生成時は UPSERT

### フォールバック
- `title` カラムなし → 判定スキップ、WARNING ログ出力
