const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const isProduction = process.env.NODE_ENV === "production";

// DB を最初に読み込み（.env 読み込み後に pool を初期化）
const pool = require("./db");

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const scanRoutes = require("./routes/scans");
const scanModule = require("./routes/scan");
const gscRoutes = require("./routes/gsc");
const strategyRoutes = require("./routes/strategy");
const { handleSitemapLast, handleSubmitSitemap } = require("./routes/sitemap");
const handleStart = scanModule.handleStart;
const handleResult = scanModule.handleResult;
const handleTrends = scanModule.handleTrends;

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

// リバースプロキシ経由時（nginx等）の HTTPS 判定用
app.set("trust proxy", 1);

app.use(helmet({ contentSecurityPolicy: false })); // CSP はフロントの都合で無効
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// API のみレート制限（DoS 対策・静的ファイルは除外）
const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 400,
  message: { error: "リクエストが多すぎます。しばらく待ってから再試行してください。" },
  standardHeaders: true,
  legacyHeaders: false,
});

// /api/* へのリクエストのみレート制限を適用
app.use("/api", apiRateLimiter);

// 診断: このサーバーが応答しているか確認
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, pid: process.pid, msg: "このサーバーが応答しています" });
});

// DB接続・保存の診断（scans, scan_pages, scan_links の確認）
app.get("/api/db-check", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    const [[scanRow]] = await pool.query(
      "SELECT id, status, target_url, updated_at FROM scans ORDER BY created_at DESC LIMIT 1"
    );
    const [[pageCount]] = await pool.query("SELECT COUNT(*) AS c FROM scan_pages");
    const [[linkCount]] = await pool.query("SELECT COUNT(*) AS c FROM scan_links").catch(() => [[{ c: 0 }]]);
    res.json({
      ok: true,
      db: "connected",
      latest_scan: scanRow || null,
      scan_pages_total: pageCount?.c ?? 0,
      scan_links_total: linkCount?.c ?? 0,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "DB error" });
  }
});

// trends API — /api/scans より先に登録（/:scanId に奪われないよう最優先）
app.get("/api/scans/trends", (req, res, next) =>
  handleTrends(req, res).catch(next)
);
app.get("/api/scan/trends", (req, res, next) =>
  handleTrends(req, res).catch(next)
);

// sitemap API（他ルートより先に登録。ハイフン path で問題が出る環境向けに sitemap_last も用意）
app.get("/api/sitemap-last", (req, res, next) =>
  handleSitemapLast(req, res).catch(next)
);
app.get("/api/sitemap_last", (req, res, next) =>
  handleSitemapLast(req, res).catch(next)
);
app.post("/api/submit-sitemap", (req, res, next) =>
  handleSubmitSitemap(req, res).catch(next)
);
app.post("/api/submit_sitemap", (req, res, next) =>
  handleSubmitSitemap(req, res).catch(next)
);

// SSRF 対策: プライベート・内部 IP へのアクセスを拒否
function isPrivateOrInternalAddress(hostname, ip) {
  if (!ip) return true;
  const parts = ip.split(".");
  if (parts.length === 4) {
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
  }
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  return false;
}

// GET /api/proxy?url= — モバイルプレビュー用（外部URLを取得して返す）
app.get("/api/proxy", async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl || typeof targetUrl !== "string") {
    return res.status(400).send(
      '<html><body style="font-family:sans-serif;padding:2rem;color:#64748b"><p>URLを選択してください。一覧の行をクリックするとプレビューが表示されます。</p></body></html>'
    );
  }
  try {
    const u = new URL(targetUrl);
    if (!["http:", "https:"].includes(u.protocol)) {
      return res.status(400).send('<html><body><p>http/https のみ許可</p></body></html>');
    }
    const hostname = u.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".local")) {
      return res.status(403).send('<html><body style="font-family:sans-serif;padding:2rem;color:#dc2626"><p>内部アドレスへのアクセスは許可されていません。</p></body></html>');
    }
    const dns = require("dns").promises;
    let addresses = [];
    try {
      addresses = await dns.resolve4(hostname);
    } catch {
      try {
        addresses = await dns.resolve6(hostname);
      } catch {
        return res.status(400).send('<html><body><p>ホスト名を解決できません</p></body></html>');
      }
    }
    for (const ip of addresses) {
      if (isPrivateOrInternalAddress(hostname, ip)) {
        return res.status(403).send('<html><body style="font-family:sans-serif;padding:2rem;color:#dc2626"><p>内部アドレスへのアクセスは許可されていません。</p></body></html>');
      }
    }
    const resp = await fetch(targetUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15" },
      redirect: "follow",
    });
    let html = await resp.text();
    // base タグ: 相対URL解決用（ディレクトリベースで設定）
    const baseUrl = new URL(targetUrl);
    const pathDir = baseUrl.pathname === "/" ? "/" : baseUrl.pathname.replace(/\/[^/]*$/, "/") || "/";
    const baseHref = baseUrl.origin + pathDir;
    const safeHref = baseHref.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    // link[href], script[src], img[src] の相対URLを絶対URLに書き換え（CSS/JS/画像が確実に読めるように）
    html = html.replace(
      /(<link[^>]+href=)(["'])(?!https?:|\/\/|data:)([^"']+)\2/gi,
      (_, p1, q, path) => p1 + q + new URL(path, baseHref).href + q
    );
    html = html.replace(
      /(<script[^>]+src=)(["'])(?!https?:|\/\/|data:)([^"']+)\2/gi,
      (_, p1, q, path) => p1 + q + new URL(path, baseHref).href + q
    );
    html = html.replace(
      /(<img[^>]+src=)(["'])(?!https?:|\/\/|data:)([^"']+)\2/gi,
      (_, p1, q, path) => p1 + q + new URL(path, baseHref).href + q
    );
    const injectTags = `<base href="${safeHref}"><meta name="viewport" content="width=320, initial-scale=1">`;
    if (/<head(\s[^>]*)?>/i.test(html)) {
      html = html.replace(/<head(\s[^>]*)?>/i, `<head$1>${injectTags}`);
    } else {
      html = html.replace(/<html(\s[^>]*)?>/i, `<html$1><head>${injectTags}</head>`);
    }
    res.set("Content-Type", resp.headers.get("content-type") || "text/html; charset=utf-8");
    res.send(html);
  } catch (e) {
    console.error("[proxy]", e.message);
    const msg = isProduction ? "プロキシでエラーが発生しました。" : e.message;
    res.status(502).send(`<html><body style="font-family:sans-serif;padding:2rem;color:#dc2626"><p>Proxy Error: ${msg}</p></body></html>`);
  }
});

// 診断用（開発時のみ・本番では 404）
if (!isProduction) {
  app.get("/api/debug-db", async (req, res) => {
    const env = {
      DB_HOST: process.env.DB_HOST ? "✓" : "✗",
      DB_USER: process.env.DB_USER ? "✓" : "✗",
      DB_NAME: process.env.DB_NAME ? "✓" : "✗"
    };
    try {
      await pool.query("SELECT 1");
      return res.json({ env, db: "OK" });
    } catch (e) {
      return res.status(500).json({ env, db: "NG", error: e.message });
    }
  });
  app.get("/api/debug-gsc-env", (req, res) => {
    res.json({
      GOOGLE_CLIENT_ID: (process.env.GOOGLE_CLIENT_ID || "").trim() ? "set" : "not set",
      GOOGLE_CLIENT_SECRET: (process.env.GOOGLE_CLIENT_SECRET || "").trim() ? "set" : "not set",
    });
  });
}

// 認証API
app.use("/api/auth", authRoutes);

// 管理API（admin/master のみ）
app.use("/api/admin", adminRoutes);

// GET /api/companies — クライアント一覧（seo.html の Client 選択用）
// admin/master: 全件、user: 自社のみ
app.get("/api/companies", async (req, res, next) => {
  try {
    const { getUserWithContext, isAdmin } = require("./services/accessControl");
    const user = await getUserWithContext(req);
    if (!user) {
      return res.status(401).json({ error: "unauthorized" });
    }

    let rows;
    if (isAdmin(user)) {
      [rows] = await pool.query(
        "SELECT id, name FROM companies ORDER BY name ASC"
      );
    } else if (user.company_id) {
      [rows] = await pool.query(
        "SELECT id, name FROM companies WHERE id = ? ORDER BY name ASC",
        [user.company_id]
      );
    } else {
      rows = [];
    }

    return res.json(rows || []);
  } catch (e) {
    console.error("[api/companies]", e?.message || e);
    next(e);
  }
});

// スキャン開始のレート制限（負荷・濫用防止）
const scanStartLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: { error: "スキャンの開始が多すぎます。5分後に再試行してください。" },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/scans/start, GET /api/scans/result/:id を先に登録
app.post("/api/scan-start", scanStartLimiter, (req, res, next) =>
  handleStart(req, res).catch(next)
);
app.get("/api/scans/result/:id", (req, res, next) =>
  handleResult(req, res).catch(next)
);
app.use("/api/scans", scanRoutes);
app.use("/api/gsc", gscRoutes);
app.use("/api/strategy", strategyRoutes);

// GET /api/link-analysis?scan_id=X — user もアクセス可能（/api/scans/:id/link-analysis へリダイレクト）
app.get("/api/link-analysis", (req, res) => {
  const scanId = req.query.scan_id;
  if (!scanId) {
    return res.status(400).json({ error: "scan_id が必要です" });
  }
  res.redirect(`/api/scans/${encodeURIComponent(scanId)}/link-analysis`);
});

// 静的ファイルを配信
app.use(express.static(path.join(__dirname, "public")));

// /admin で admin.html を返す
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// 未処理エラーをキャッチ
app.use((err, req, res, next) => {
  console.error("[Express] 未処理エラー:", err?.message || err);
  console.error("[Express] パス:", req.method, req.path);
  const msg = isProduction ? "Internal Server Error" : (err?.message || "Internal Server Error");
  res.status(500).json({ success: false, error: msg });
});

(async () => {
  try {
    await pool.query("SELECT 1");
    console.log("[DB] 接続OK");
  } catch (e) {
    console.error("[DB] 起動時接続失敗:", e.message);
    console.error("→ .env の DB_HOST, DB_USER, DB_PASSWORD, DB_NAME を確認してください");
  }
  try {
    await pool.query("ALTER TABLE scans ADD COLUMN gsc_property_url VARCHAR(512) NULL");
    console.log("[DB] scans.gsc_property_url 確認OK");
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") {
      console.warn("[DB] gsc_property_url 追加スキップ:", e.message);
    }
  }
  try {
    await pool.query("ALTER TABLE scans ADD COLUMN error_message VARCHAR(500) NULL");
    console.log("[DB] scans.error_message 確認OK");
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") {
      console.warn("[DB] error_message 追加スキップ:", e.message);
    }
  }
  try {
    await pool.query("ALTER TABLE scans ADD COLUMN started_at DATETIME NULL");
    console.log("[DB] scans.started_at 確認OK");
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") {
      console.warn("[DB] started_at 追加スキップ:", e.message);
    }
  }
  try {
    await pool.execute(`CREATE TABLE IF NOT EXISTS companies (
      id INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    )`);
    console.log("[DB] companies 確認OK");
  } catch (e) {
    if (e.code !== "ER_TABLE_EXISTS_ERROR") console.warn("[DB] companies スキップ:", e.message);
  }
  try {
    await pool.query("ALTER TABLE users ADD COLUMN company_id INT NULL");
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") { /* ignore */ }
  }
  try {
    await pool.execute(`CREATE TABLE IF NOT EXISTS company_urls (
      id INT NOT NULL AUTO_INCREMENT,
      company_id INT NOT NULL,
      url VARCHAR(2048) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_company_url (company_id, url(500)),
      KEY idx_company_urls_company (company_id),
      CONSTRAINT fk_company_urls_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    )`);
    console.log("[DB] company_urls 確認OK");
  } catch (e) {
    if (e.code !== "ER_TABLE_EXISTS" && e.code !== "ER_TABLE_EXISTS_ERROR") console.warn("[DB] company_urls スキップ:", e?.message);
  }
  try {
    await pool.execute(`CREATE TABLE IF NOT EXISTS user_url_access (
      user_id INT NOT NULL,
      url_id INT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, url_id),
      KEY idx_user_url_access_url (url_id),
      CONSTRAINT fk_user_url_access_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_user_url_access_url FOREIGN KEY (url_id) REFERENCES company_urls(id) ON DELETE CASCADE
    )`);
    console.log("[DB] user_url_access 確認OK");
  } catch (e) {
    if (e.code !== "ER_TABLE_EXISTS" && e.code !== "ER_TABLE_EXISTS_ERROR") console.warn("[DB] user_url_access スキップ:", e?.message);
  }
  // company_url_id カラムの場合は url_id にリネーム（既存DB互換）
  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM user_url_access");
    const hasUrlId = cols.some((c) => c.Field === "url_id");
    const hasCompanyUrlId = cols.some((c) => c.Field === "company_url_id");
    if (!hasUrlId && hasCompanyUrlId) {
      await pool.query("ALTER TABLE user_url_access CHANGE company_url_id url_id INT NOT NULL");
      console.log("[DB] user_url_access.company_url_id → url_id リネームOK");
    }
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") console.warn("[DB] user_url_access カラム確認スキップ:", e?.message);
  }
  try {
    await pool.query("ALTER TABLE users ADD COLUMN invitation_token VARCHAR(64) NULL");
    await pool.query("ALTER TABLE users ADD COLUMN invitation_expires_at DATETIME NULL");
    console.log("[DB] users.invitation_token 確認OK");
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") {
      console.warn("[DB] invitation_token 追加スキップ:", e.message);
    }
  }
  try {
    await pool.query("ALTER TABLE auth_codes ADD COLUMN one_time_token VARCHAR(64) NULL");
    console.log("[DB] auth_codes.one_time_token 確認OK");
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") {
      console.warn("[DB] one_time_token 追加スキップ:", e.message);
    }
  }
  try {
    await pool.query("ALTER TABLE scan_pages ADD COLUMN score_breakdown TEXT NULL");
    console.log("[DB] scan_pages.score_breakdown 確認OK");
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") {
      console.warn("[DB] score_breakdown 追加スキップ:", e.message);
    }
  }
  try {
    await pool.execute(`CREATE TABLE IF NOT EXISTS scan_links (
      id INT NOT NULL AUTO_INCREMENT,
      scan_id VARCHAR(36) NOT NULL,
      from_url TEXT NOT NULL,
      to_url TEXT NOT NULL,
      PRIMARY KEY (id),
      KEY idx_scan_links_scan (scan_id)
    )`);
    console.log("[DB] scan_links 確認OK");
  } catch (e) {
    if (e.code !== "ER_TABLE_EXISTS_ERROR") console.warn("[DB] scan_links スキップ:", e?.message);
  }
  try {
    await pool.execute(`CREATE TABLE IF NOT EXISTS scan_history (
      id INT NOT NULL AUTO_INCREMENT,
      scan_id VARCHAR(36) NOT NULL,
      avg_score INT NULL,
      page_count INT NOT NULL DEFAULT 0,
      critical_issues INT NOT NULL DEFAULT 0,
      recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_scan_history_scan (scan_id)
    )`);
    console.log("[DB] scan_history 確認OK");
  } catch (e) {
    if (e.code !== "ER_TABLE_EXISTS_ERROR") console.warn("[DB] scan_history スキップ:", e?.message);
  }
  try {
    await pool.query("ALTER TABLE oauth_states MODIFY COLUMN state VARCHAR(128) NOT NULL");
    console.log("[DB] oauth_states.state 拡張OK");
  } catch (e) {
    if (e.code !== "ER_NO_SUCH_TABLE" && e.code !== "ER_BAD_FIELD_ERROR") {
      console.warn("[DB] oauth_states.state 拡張スキップ:", e.message);
    }
  }
  try {
    await pool.execute(`CREATE TABLE IF NOT EXISTS scan_google_tokens (
      scan_id VARCHAR(36) NOT NULL,
      user_id INT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      expiry_date BIGINT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (scan_id)
    )`);
    console.log("[DB] scan_google_tokens 確認OK");
  } catch (e) {
    if (e.code !== "ER_TABLE_EXISTS_ERROR") {
      console.warn("[DB] scan_google_tokens 作成スキップ:", e.message);
    }
  }
  try {
    await pool.execute(`CREATE TABLE IF NOT EXISTS strategy_keywords (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id INT NOT NULL,
      keyword VARCHAR(255) NOT NULL,
      intent VARCHAR(50) DEFAULT NULL,
      relevance INT DEFAULT 0,
      \`rank\` INT DEFAULT 0,
      is_ai TINYINT(1) DEFAULT 0,
      accepted TINYINT(1) DEFAULT 0,
      url VARCHAR(500) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_strategy_company (company_id),
      KEY idx_strategy_accepted (company_id, accepted)
    )`);
    console.log("[DB] strategy_keywords テーブル確認OK");
  } catch (e) {
    if (e.code !== "ER_TABLE_EXISTS_ERROR") {
      console.warn("[DB] strategy_keywords 作成スキップ:", e.message);
    }
  }

  // 前回異常終了で running/queued のまま残ったスキャンの復旧
  // - scan_pages にデータあり → completed に復旧（結果を保持）
  // - データなし → failed にリセット
  try {
    const [withPages] = await pool.query(
      `SELECT s.id FROM scans s
       INNER JOIN (SELECT scan_id, COUNT(*) AS cnt FROM scan_pages GROUP BY scan_id) p ON s.id = p.scan_id
       WHERE s.status IN ('running', 'queued') AND p.cnt > 0`
    );
    for (const row of withPages || []) {
      const [[avgRow]] = await pool.query(
        `SELECT ROUND(AVG(score)) AS avg_score FROM scan_pages WHERE scan_id = ?`,
        [row.id]
      );
      const avg = avgRow?.avg_score ?? null;
      await pool.query(
        `UPDATE scans SET status = 'completed', avg_score = ?, error_message = NULL, updated_at = NOW() WHERE id = ?`,
        [avg, row.id]
      );
      console.log(`[DB] scan ${row.id} を completed に復旧（ページデータあり）`);
    }
    const [r] = await pool.query(
      `UPDATE scans SET status = 'failed', error_message = '前回の実行が中断されました。再スキャンしてください。' 
       WHERE status IN ('running', 'queued')`
    );
    if (r?.affectedRows > 0) {
      console.log(`[DB] ${r.affectedRows} 件の stuck スキャン（データなし）を failed にリセット`);
    }
  } catch (e) {
    console.warn("[DB] stuck スキャン復旧 スキップ:", e?.message);
  }

  // company_urls の重複統合（https://o-eighty.jp と https://o-eighty.jp/ を同一とみなす）
  try {
    const { normalizeUrlForKey } = require("./services/userUrlAccess");
    const [rows] = await pool.query(
      "SELECT id, company_id, url FROM company_urls ORDER BY company_id, id"
    );
    const byKey = new Map(); // (company_id, canonical_url) -> [rows]
    for (const r of rows || []) {
      const key = `${r.company_id}\t${normalizeUrlForKey(r.url)}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(r);
    }
    for (const [, group] of byKey) {
      if (group.length <= 1) continue;
      const keep = group.find((r) => normalizeUrlForKey(r.url) === r.url) || group[0];
      const dupes = group.filter((r) => r.id !== keep.id);
      const [cols] = await pool.query("SHOW COLUMNS FROM user_url_access");
      const urlIdCol = cols?.find((c) => c.Field === "url_id" || c.Field === "company_url_id")?.Field || "url_id";
      for (const dup of dupes) {
        const [ua] = await pool.query(
          `SELECT user_id FROM user_url_access WHERE ${urlIdCol} = ?`,
          [dup.id]
        );
        for (const u of ua || []) {
          await pool.query(
            `INSERT IGNORE INTO user_url_access (user_id, ${urlIdCol}) VALUES (?, ?)`,
            [u.user_id, keep.id]
          ).catch(() => {});
        }
        await pool.query(`DELETE FROM user_url_access WHERE ${urlIdCol} = ?`, [dup.id]);
        await pool.query("DELETE FROM company_urls WHERE id = ?", [dup.id]);
        console.log(`[DB] company_urls 統合: ${dup.url} → ${keep.url} (id=${keep.id})`);
      }
    }
  } catch (e) {
    console.warn("[DB] company_urls 重複統合 スキップ:", e?.message);
  }

  const server = app.listen(port, () => {
    console.log(`server running on :${port} (PID: ${process.pid})`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n[エラー] ポート ${port} は既に使用中です。`);
      console.error("→ npm start を使うと自動で既存プロセスを停止します\n");
    }
    process.exit(1);
  });
})();

