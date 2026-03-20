/**
 * strategy.js - キーワード戦略管理 API
 * GET /api/strategy, POST /api/strategy, POST /api/strategy/accept, DELETE /api/strategy/:id
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { getUserWithContext } = require("../services/accessControl");

const router = express.Router();

/** strategy_keywords テーブルがなければ自動作成 */
async function ensureStrategyTable() {
  const fallbackSql = `CREATE TABLE IF NOT EXISTS strategy_keywords (
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
  )`;
  const fullSql = path.join(__dirname, "..", "sql", "migration_strategy_keywords.sql");
  if (fs.existsSync(fullSql)) {
    try {
      const sql = fs.readFileSync(fullSql, "utf8");
      const stmts = sql.split(";").map((s) => s.trim()).filter((s) => s && !s.startsWith("--"));
      for (const stmt of stmts) {
        if (stmt) await pool.execute(stmt);
      }
      return;
    } catch (e) {
      if (e.code === "ER_DUP_KEYNAME" || e.code === "ER_DUP_FIELDNAME") return;
    }
  }
  await pool.execute(fallbackSql);
}

const INTENT_PATTERNS = {
  Comparative: ["比較", "おすすめ", "ランキング", "人気", "vs"],
  Transactional: ["価格", "予約", "注文", "購入", "申込", "資料請求"],
  Informational: ["とは", "方法", "やり方", "使い方", "まとめ", "基礎"],
};

function detectIntent(keyword) {
  const k = (keyword || "").toLowerCase();
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (patterns.some((p) => k.includes(p))) return intent;
  }
  return "Informational";
}

async function resolveCompanyId(user) {
  if (user && user.company_id) return user.company_id;
  try {
    const [rows] = await pool.query("SELECT id FROM companies ORDER BY id ASC LIMIT 1");
    return rows?.[0]?.id ?? null;
  } catch (e) {
    return null;
  }
}

/** GET /api/strategy?company_id=xxx - 一覧取得（company_id 省略時はユーザーの company を使用） */
router.get("/", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  let companyId = req.query.company_id ? parseInt(req.query.company_id, 10) : null;
  if (!companyId || isNaN(companyId)) {
    companyId = await resolveCompanyId(user);
  }
  if (!companyId) {
    return res.status(400).json({ error: "company_id が設定されていません。管理者に企業登録を依頼してください。" });
  }

  try {
    await ensureStrategyTable();

    const [rows] = await pool.query(
      `SELECT id, keyword, intent, relevance, \`rank\`, is_ai, accepted, url, created_at
       FROM strategy_keywords
       WHERE company_id = ?
       ORDER BY accepted DESC, \`rank\` ASC, relevance DESC, id ASC`,
      [companyId]
    );

    const list = (rows || []).map((r) => ({
      id: r.id,
      keyword: r.keyword,
      intent: r.intent || "Informational",
      relevance: r.relevance ?? 0,
      rank: r.rank ?? 0,
      is_ai: Boolean(r.is_ai),
      accepted: Boolean(r.accepted),
      url: r.url || null,
      created_at: r.created_at,
    }));

    res.json(list);
  } catch (e) {
    console.error("[strategy] GET error:", e.message);
    res.status(500).json({ error: "キーワード一覧の取得に失敗しました。" });
  }
});

/** POST /api/strategy - 追加 */
router.post("/", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const companyId = await resolveCompanyId(user);
  if (!companyId) {
    return res.status(400).json({ error: "company_id が設定されていません。" });
  }

  const keyword = (req.body?.keyword || "").trim();
  if (!keyword) {
    return res.status(400).json({ error: "keyword は必須です" });
  }

  const intent = (req.body?.intent || detectIntent(keyword)).trim() || detectIntent(keyword);
  const isAi = Boolean(req.body?.is_ai);
  const accepted = Boolean(req.body?.accepted);
  const url = (req.body?.url || "").trim() || null;

  try {
    await ensureStrategyTable();
    const [r] = await pool.query(
      `INSERT INTO strategy_keywords (company_id, keyword, intent, relevance, \`rank\`, is_ai, accepted, url)
       VALUES (?, ?, ?, 0, 0, ?, ?, ?)`,
      [companyId, keyword, intent, isAi ? 1 : 0, accepted ? 1 : 0, url]
    );

    res.status(201).json({
      id: r.insertId,
      keyword,
      intent,
      relevance: 0,
      rank: 0,
      is_ai: isAi,
      accepted,
      url,
    });
  } catch (e) {
    console.error("[strategy] POST error:", e.message);
    res.status(500).json({ error: "キーワードの追加に失敗しました。" });
  }
});

/** POST /api/strategy/accept - 承認 */
router.post("/accept", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const id = req.body?.id ? parseInt(req.body.id, 10) : null;
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "id は必須です" });
  }

  const companyId = await resolveCompanyId(user);
  if (!companyId) {
    return res.status(400).json({ error: "company_id が設定されていません。" });
  }

  try {
    const [r] = await pool.query(
      `UPDATE strategy_keywords SET accepted = 1 WHERE id = ? AND company_id = ?`,
      [id, companyId]
    );

    if (r.affectedRows === 0) {
      return res.status(404).json({ error: "キーワードが見つかりません" });
    }

    res.json({ success: true, id });
  } catch (e) {
    console.error("[strategy] accept error:", e.message);
    res.status(500).json({ error: "承認に失敗しました。" });
  }
});

/** DELETE /api/strategy/:id - 削除 */
router.delete("/:id", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: "無効な id です" });
  }

  const companyId = await resolveCompanyId(user);
  if (!companyId) {
    return res.status(400).json({ error: "company_id が設定されていません。" });
  }

  try {
    const [r] = await pool.query(
      `DELETE FROM strategy_keywords WHERE id = ? AND company_id = ?`,
      [id, companyId]
    );

    if (r.affectedRows === 0) {
      return res.status(404).json({ error: "キーワードが見つかりません" });
    }

    res.json({ success: true, id });
  } catch (e) {
    console.error("[strategy] DELETE error:", e.message);
    res.status(500).json({ error: "削除に失敗しました。" });
  }
});

/** POST /api/strategy/ai-proposals - GSC から AI 提案キーワードを取得して登録 */
router.post("/ai-proposals", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const companyId = await resolveCompanyId(user);
  if (!companyId) {
    return res.status(400).json({ error: "company_id が設定されていません。" });
  }

  const propertyUrl = (req.body?.propertyUrl || "").trim();
  if (!propertyUrl) {
    return res.status(400).json({
      error: "propertyUrl が必要です。GSC プロパティを指定してください。",
    });
  }

  const scanId = (req.body?.scanId || "").trim() || null;
  const { getUserIdFromRequest } = require("../services/session");
  const { getAuthenticatedClient, deleteTokensForUser, deleteTokensForScan } = require("../services/googleOAuth");
  const { searchconsole } = require("@googleapis/searchconsole");

  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "ログインが必要です" });

  const client = await getAuthenticatedClient(userId, req, scanId);
  if (!client) {
    return res.status(403).json({
      error: "Google アカウントが連携されていません。設定から「Google で連携」を実行してください。",
    });
  }

  let normalized = propertyUrl;
  if (!normalized.startsWith("sc-domain:") && !/^https?:\/\//i.test(normalized)) {
    normalized = `sc-domain:${normalized}`;
  } else if (/^https?:\/\//i.test(normalized)) {
    try {
      const u = new URL(normalized);
      u.hash = "";
      u.search = "";
      let p = u.pathname || "/";
      if (!p.endsWith("/")) p += "/";
      normalized = u.origin + p;
    } catch {
      normalized = propertyUrl;
    }
  }

  try {
    await ensureStrategyTable();

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);
    const startStr = startDate.toISOString().slice(0, 10);
    const endStr = endDate.toISOString().slice(0, 10);

    const gsc = searchconsole({ version: "v1", auth: client });
    const { data } = await gsc.searchanalytics.query({
      siteUrl: normalized,
      requestBody: {
        startDate: startStr,
        endDate: endStr,
        dimensions: ["query"],
        rowLimit: 500,
        aggregationType: "byPage",
      },
    });

    const rows = data.rows || [];
    const candidates = rows.filter((r) => {
      const impressions = r.impressions || 0;
      const position = parseFloat(r.position || 0);
      return impressions > 100 && position > 10;
    });

    const [existing] = await pool.query(
      "SELECT keyword FROM strategy_keywords WHERE company_id = ?",
      [companyId]
    );
    const existingSet = new Set(existing.map((r) => (r.keyword || "").toLowerCase().trim()));

    const added = [];
    for (const row of candidates) {
      const query = row.keys && row.keys[0] ? String(row.keys[0]).trim() : "";
      if (!query || existingSet.has(query.toLowerCase())) continue;

      const intent = detectIntent(query);
      await pool.query(
        `INSERT INTO strategy_keywords (company_id, keyword, intent, relevance, \`rank\`, is_ai, accepted)
         VALUES (?, ?, ?, 0, 0, 1, 0)`,
        [companyId, query, intent]
      );
      added.push({ keyword: query, intent });
      existingSet.add(query.toLowerCase());
    }

    res.json({ success: true, added: added.length, keywords: added });
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes("401") || msg.includes("invalid_grant")) {
      if (scanId) await deleteTokensForScan(scanId, userId);
      else await deleteTokensForUser(userId);
      return res.status(403).json({
        error: "Google 連携の有効期限が切れています。再度「Google で連携」を実行してください。",
      });
    }
    console.error("[strategy] ai-proposals error:", msg);
    res.status(500).json({
      error: "AI 提案の取得に失敗しました。",
      detail: process.env.NODE_ENV === "development" ? msg : undefined,
    });
  }
});

module.exports = router;
