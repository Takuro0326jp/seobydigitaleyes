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

// 全体レート制限（DoS 対策）
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: { error: "リクエストが多すぎます。しばらく待ってから再試行してください。" },
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// 診断: このサーバーが応答しているか確認
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, pid: process.pid, msg: "このサーバーが応答しています" });
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
    await pool.query("ALTER TABLE scan_pages ADD COLUMN score_breakdown TEXT NULL");
    console.log("[DB] scan_pages.score_breakdown 確認OK");
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") {
      console.warn("[DB] score_breakdown 追加スキップ:", e.message);
    }
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

