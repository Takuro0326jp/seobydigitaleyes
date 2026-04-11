/**
 * strategy.js - キーワード戦略管理 API
 * GET /api/strategy, POST /api/strategy, POST /api/strategy/accept, DELETE /api/strategy/:id
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const { getUserWithContext, canAccessScan, isAdmin } = require("../services/accessControl");

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

/**
 * 戦略APIのスコープ: scan 指定時はそのスキャンの企業＋scan_id で分離（全アカウント同一 company 問題を防ぐ）
 * @param {string|null|undefined} scanIdRaw - scans.id (UUID)
 */
async function resolveStrategyContext(user, scanIdRaw) {
  const scanId = (scanIdRaw || "").trim() || null;
  if (!scanId) {
    const companyId = await resolveCompanyId(user);
    if (!companyId) {
      return {
        ok: false,
        status: 400,
        error:
          "company_id が設定されていません。他タブから SEO Strategy を開き直すか、URL に ?scan=サイトID を付けてください。",
      };
    }
    return { ok: true, companyId, scanId: null };
  }

  const [[scan]] = await pool.query(
    "SELECT id, company_id, user_id FROM scans WHERE id = ? LIMIT 1",
    [scanId]
  );
  if (!scan) {
    return { ok: false, status: 404, error: "スキャン（サイト）が見つかりません。" };
  }

  const allowed = await canAccessScan(user.id, user.company_id, user.role, scanId);
  if (!allowed) {
    return { ok: false, status: 403, error: "このサイトの戦略データにアクセスできません。" };
  }

  let companyId = scan.company_id != null ? parseInt(scan.company_id, 10) : null;
  if (!companyId || isNaN(companyId)) {
    const [[owner]] = await pool.query("SELECT company_id FROM users WHERE id = ? LIMIT 1", [scan.user_id]);
    companyId = owner?.company_id != null ? parseInt(owner.company_id, 10) : null;
  }
  if (!companyId || isNaN(companyId)) {
    companyId = user.company_id != null ? parseInt(user.company_id, 10) : null;
  }
  if (!companyId || isNaN(companyId)) {
    companyId = await resolveCompanyId(user);
  }
  if (!companyId || isNaN(companyId)) {
    return { ok: false, status: 400, error: "企業IDを解決できませんでした。" };
  }

  return { ok: true, companyId, scanId };
}

function scanFilterClause(scanId) {
  if (!scanId) return { sql: "", params: [] };
  /** NULL scan_id は旧データで全サイトに共有表示されていたため、サイト指定時は一致する行のみ */
  return { sql: " AND scan_id = ?", params: [scanId] };
}

/** GET /api/strategy?scan=xxx&company_id=xxx - 一覧（scan 必須: 未指定時は空。管理者のみ ?company_id= で全件可） */
router.get("/", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const scanParam = (req.query.scan || req.query.scanId || "").trim() || null;
  const overrideCid = req.query.company_id ? parseInt(req.query.company_id, 10) : null;
  const adminCompanyDump =
    !scanParam && overrideCid && !isNaN(overrideCid) && isAdmin(user);

  /** scan なしだと company 全件になり全ドメインで同じ一覧になるため、管理者の明示用途以外は返さない */
  if (!scanParam && !adminCompanyDump) {
    return res.json([]);
  }

  let ctx;
  if (adminCompanyDump) {
    ctx = { ok: true, companyId: overrideCid, scanId: null };
  } else {
    ctx = await resolveStrategyContext(user, scanParam);
  }
  if (!ctx.ok) {
    return res.status(ctx.status).json({ error: ctx.error });
  }
  let { companyId, scanId } = ctx;

  const { sql: scanSql, params: scanParams } = scanFilterClause(scanId);

  try {
    await ensureStrategyTable();

    let rows = [];
    try {
      [rows] = await pool.query(
        `SELECT id, keyword, intent, relevance, \`rank\`, is_ai, accepted, url, created_at,
                search_volume, competition, ai_reason, status, scan_id, excluded_at
         FROM strategy_keywords
         WHERE company_id = ?${scanSql}
         ORDER BY accepted DESC, \`rank\` ASC, relevance DESC, id ASC`,
        [companyId, ...scanParams]
      );
    } catch (colErr) {
      if (colErr.code === "ER_BAD_FIELD_ERROR") {
        [rows] = await pool.query(
          `SELECT id, keyword, intent, relevance, \`rank\`, is_ai, accepted, url, created_at
           FROM strategy_keywords WHERE company_id = ?${scanSql} ORDER BY accepted DESC, \`rank\` ASC, relevance DESC, id ASC`,
          [companyId, ...scanParams]
        );
      } else throw colErr;
    }

    const list = (rows || []).map((r) => {
      const status = r.status || (r.accepted ? "active" : r.excluded_at ? "excluded" : "pending");
      return {
        id: r.id,
        keyword: r.keyword,
        intent: r.intent || "Informational",
        relevance: r.relevance ?? 0,
        rank: r.rank ?? 0,
        is_ai: Boolean(r.is_ai),
        accepted: Boolean(r.accepted),
        url: r.url || null,
        created_at: r.created_at,
        search_volume: r.search_volume ?? null,
        competition: r.competition || null,
        ai_reason: r.ai_reason || null,
        status,
        scan_id: r.scan_id || null,
      };
    });

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

  const scanParam = (req.body?.scanId || req.body?.scan || "").trim() || null;
  if (!scanParam) {
    return res.status(400).json({
      error:
        "サイトごとに登録するため scanId が必要です。対象サイトを選んでから追加してください。",
    });
  }
  const ctx = await resolveStrategyContext(user, scanParam);
  if (!ctx.ok) {
    return res.status(ctx.status).json({ error: ctx.error });
  }
  const { companyId, scanId } = ctx;

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
    let r;
    try {
      [r] = await pool.query(
        `INSERT INTO strategy_keywords (company_id, scan_id, keyword, intent, relevance, \`rank\`, is_ai, accepted, url, status)
         VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
        [companyId, scanId, keyword, intent, isAi ? 1 : 0, accepted ? 1 : 0, url, accepted ? "active" : "pending"]
      );
    } catch (insErr) {
      if (insErr.code === "ER_BAD_FIELD_ERROR") {
        [r] = await pool.query(
          `INSERT INTO strategy_keywords (company_id, keyword, intent, relevance, \`rank\`, is_ai, accepted, url)
           VALUES (?, ?, ?, 0, 0, ?, ?, ?)`,
          [companyId, keyword, intent, isAi ? 1 : 0, accepted ? 1 : 0, url]
        );
      } else throw insErr;
    }

    const insertId = r?.insertId;
    if (accepted && insertId) {
      try {
        const [t] = await pool.query("SHOW TABLES LIKE 'keyword_watchlist'");
        if (t && t.length > 0) {
          await pool.query(
            `INSERT INTO keyword_watchlist (company_id, scan_id, strategy_keyword_id, keyword, source, intent, status)
             VALUES (?, ?, ?, ?, ?, ?, 'active')`,
            [companyId, scanId, insertId, keyword, isAi ? "ai" : "manual", intent]
          );
        }
      } catch (_) {}
    }

    res.status(201).json({
      id: insertId,
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

/** POST /api/strategy/accept - 承認（単体） */
router.post("/accept", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const id = req.body?.id ? parseInt(req.body.id, 10) : null;
  if (!id || isNaN(id)) return res.status(400).json({ error: "id は必須です" });

  const scanParam = (req.body?.scanId || req.body?.scan || "").trim() || null;
  const ctx = await resolveStrategyContext(user, scanParam);
  if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });
  const { companyId, scanId } = ctx;

  try {
    const scanClause = scanId != null ? " AND scan_id = ?" : "";
    const qparams = scanId != null ? [id, companyId, scanId] : [id, companyId];
    const [[kw]] = await pool.query(
      `SELECT id, keyword, intent, search_volume, competition, ai_reason, scan_id FROM strategy_keywords WHERE id = ? AND company_id = ?${scanClause}`,
      qparams
    );
    if (!kw) return res.status(404).json({ error: "キーワードが見つかりません" });

    await pool.query(
      `UPDATE strategy_keywords SET accepted = 1, status = 'active' WHERE id = ? AND company_id = ?`,
      [id, companyId]
    );

    try {
      const [rows] = await pool.query("SHOW TABLES LIKE 'keyword_watchlist'");
      if (rows && rows.length > 0) {
        await pool.query(
          `INSERT INTO keyword_watchlist (company_id, scan_id, strategy_keyword_id, keyword, source, intent, search_volume, competition, ai_reason, status)
           VALUES (?, ?, ?, ?, 'ai', ?, ?, ?, ?, 'active')`,
          [companyId, scanId, id, kw.keyword, kw.intent, kw.search_volume, kw.competition, kw.ai_reason]
        );
      }
    } catch (ew) {
      if (ew.code !== "ER_NO_SUCH_TABLE") console.warn("[strategy] watchlist insert skip:", ew?.message);
    }

    res.json({ success: true, id });
  } catch (e) {
    console.error("[strategy] accept error:", e.message);
    res.status(500).json({ error: "承認に失敗しました。" });
  }
});

/** POST /api/strategy/accept-bulk - 一括承認 */
router.post("/accept-bulk", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x) => parseInt(x, 10)).filter((n) => !isNaN(n)) : [];
  if (ids.length === 0) return res.status(400).json({ error: "ids 配列が必要です" });

  const scanParam = (req.body?.scanId || req.body?.scan || "").trim() || null;
  const ctx = await resolveStrategyContext(user, scanParam);
  if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });
  const { companyId, scanId } = ctx;

  try {
    const scanClause = scanId != null ? " AND scan_id = ?" : "";
    const qparams = scanId != null ? [ids, companyId, scanId] : [ids, companyId];
    const [rows] = await pool.query(
      `SELECT id, keyword, intent, search_volume, competition, ai_reason FROM strategy_keywords WHERE id IN (?) AND company_id = ? AND accepted = 0${scanClause}`,
      qparams
    );

    for (const kw of rows || []) {
      await pool.query(
        `UPDATE strategy_keywords SET accepted = 1, status = 'active' WHERE id = ? AND company_id = ?`,
        [kw.id, companyId]
      );
      try {
        const [t] = await pool.query("SHOW TABLES LIKE 'keyword_watchlist'");
        if (t && t.length > 0) {
          await pool.query(
            `INSERT INTO keyword_watchlist (company_id, scan_id, strategy_keyword_id, keyword, source, intent, search_volume, competition, ai_reason, status)
             VALUES (?, ?, ?, ?, 'ai', ?, ?, ?, ?, 'active')`,
            [companyId, scanId, kw.id, kw.keyword, kw.intent, kw.search_volume, kw.competition, kw.ai_reason]
          );
        }
      } catch (_) {}
    }

    res.json({ success: true, count: (rows || []).length });
  } catch (e) {
    console.error("[strategy] accept-bulk error:", e.message);
    res.status(500).json({ error: "一括承認に失敗しました。" });
  }
});

/** DELETE /api/strategy/:id - 却下（除外リストへ追加、次回AI提案から除外） */
router.delete("/:id", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) return res.status(400).json({ error: "無効な id です" });

  const scanParam = (req.query.scan || req.query.scanId || "").trim() || null;
  const ctx = await resolveStrategyContext(user, scanParam);
  if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });
  const { companyId, scanId } = ctx;

  const scanClause = scanId != null ? " AND scan_id = ?" : "";

  try {
    const upParams = scanId != null ? [id, companyId, scanId] : [id, companyId];
    const [r] = await pool.query(
      `UPDATE strategy_keywords SET status = 'excluded', excluded_at = NOW() WHERE id = ? AND company_id = ?${scanClause}`,
      upParams
    );

    if (r.affectedRows === 0) {
      const delParams = scanId != null ? [id, companyId, scanId] : [id, companyId];
      const [r2] = await pool.query(
        `DELETE FROM strategy_keywords WHERE id = ? AND company_id = ?${scanClause}`,
        delParams
      );
      if (r2.affectedRows === 0) return res.status(404).json({ error: "キーワードが見つかりません" });
    }

    res.json({ success: true, id });
  } catch (e) {
    console.error("[strategy] reject error:", e.message);
    res.status(500).json({ error: "却下に失敗しました。" });
  }
});

/** POST /api/strategy/ai-proposals - GSC から AI 提案キーワードを取得して登録 */
router.post("/ai-proposals", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const scanParam = (req.body?.scanId || req.body?.scan || "").trim() || null;
  if (!scanParam) {
    return res.status(400).json({
      error:
        "サイトごとに提案するため scanId が必要です。検証サイト一覧から対象を選び、SEO Strategy を開いてから実行してください。",
    });
  }
  const ctx = await resolveStrategyContext(user, scanParam);
  if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });
  const { companyId, scanId } = ctx;

  const propertyUrl = (req.body?.propertyUrl || "").trim();
  if (!propertyUrl) {
    return res.status(400).json({
      error: "propertyUrl が必要です。GSC プロパティを指定してください。",
    });
  }
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

    const { sql: exScanSql, params: exScanParams } = scanFilterClause(scanId);
    const [existing] = await pool.query(
      `SELECT keyword FROM strategy_keywords WHERE company_id = ? AND (status IS NULL OR status != 'excluded')${exScanSql}`,
      [companyId, ...exScanParams]
    );
    const existingSet = new Set(existing.map((r) => (r.keyword || "").toLowerCase().trim()));

    const added = [];
    for (const row of candidates) {
      const query = row.keys && row.keys[0] ? String(row.keys[0]).trim() : "";
      if (!query || existingSet.has(query.toLowerCase())) continue;

      const intent = detectIntent(query);
      const impressions = row.impressions || 0;
      const position = parseFloat(row.position || 0);
      const searchVolume = Math.min(impressions * 3, 100000);
      const competition = position > 20 ? "high" : position > 10 ? "medium" : "low";
      const aiReason = `インプレッション${impressions}回・平均順位${position.toFixed(1)}位で改善余地あり`;

      try {
        await pool.query(
          `INSERT INTO strategy_keywords (company_id, scan_id, keyword, intent, relevance, \`rank\`, is_ai, accepted, search_volume, competition, ai_reason, status)
           VALUES (?, ?, ?, ?, 0, 0, 1, 0, ?, ?, ?, 'pending')`,
          [companyId, scanId, query, intent, searchVolume, competition, aiReason]
        );
      } catch (insE) {
        if (insE.code === "ER_BAD_FIELD_ERROR") {
          await pool.query(
            `INSERT INTO strategy_keywords (company_id, keyword, intent, relevance, \`rank\`, is_ai, accepted, search_volume, competition, ai_reason, status)
             VALUES (?, ?, ?, 0, 0, 1, 0, ?, ?, ?, 'pending')`,
            [companyId, query, intent, searchVolume, competition, aiReason]
          );
        } else throw insE;
      }
      added.push({ keyword: query, intent, search_volume: searchVolume, competition, ai_reason: aiReason });
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

/** GET /api/strategy/watchlist - 監視リスト（承認済みキーワード） */
router.get("/watchlist", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const scanParam = (req.query.scan || req.query.scanId || "").trim() || null;
  const overrideCid = req.query.company_id ? parseInt(req.query.company_id, 10) : null;
  const adminCompanyDump =
    !scanParam && overrideCid && !isNaN(overrideCid) && isAdmin(user);
  if (!scanParam && !adminCompanyDump) return res.json([]);

  let ctx;
  if (adminCompanyDump) {
    ctx = { ok: true, companyId: overrideCid, scanId: null };
  } else {
    ctx = await resolveStrategyContext(user, scanParam);
  }
  if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });
  const { companyId, scanId } = ctx;

  try {
    const [rows] = await pool.query(
      `SELECT kw.id, kw.keyword, kw.intent, kw.search_volume, kw.competition, kw.ai_reason, kw.created_at
       FROM keyword_watchlist kw
       WHERE kw.company_id = ? AND kw.status = 'active'
         AND (? IS NULL OR kw.scan_id = ?)
       ORDER BY kw.created_at DESC`,
      [companyId, scanId, scanId]
    );

    const list = (rows || []).map((r) => ({
      id: r.id,
      keyword: r.keyword,
      intent: r.intent || "Informational",
      search_volume: r.search_volume,
      competition: r.competition,
      ai_reason: r.ai_reason,
      created_at: r.created_at,
    }));

    res.json(list);
  } catch (e) {
    if (e.code === "ER_NO_SUCH_TABLE") return res.json([]);
    console.error("[strategy] watchlist error:", e.message);
    res.status(500).json({ error: "監視リストの取得に失敗しました。" });
  }
});

/** GET /api/strategy/ranks - 順位履歴 */
router.get("/ranks", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const scanParam = (req.query.scan || req.query.scanId || "").trim() || null;
  const overrideCid = req.query.company_id ? parseInt(req.query.company_id, 10) : null;
  const adminCompanyDump =
    !scanParam && overrideCid && !isNaN(overrideCid) && isAdmin(user);
  if (!scanParam && !adminCompanyDump) return res.json([]);

  let ctx;
  if (adminCompanyDump) {
    ctx = { ok: true, companyId: overrideCid, scanId: null };
  } else {
    ctx = await resolveStrategyContext(user, scanParam);
  }
  if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });
  const { companyId, scanId } = ctx;

  try {
    const [[hasRh]] = await pool.query("SHOW TABLES LIKE 'rank_history'").catch(() => [[null]]);
    let rows = [];
    let histByKw = {};

    const [watchRows] = await pool.query(
      `SELECT id, keyword, search_volume FROM keyword_watchlist
       WHERE company_id = ? AND status = 'active'
         AND (? IS NULL OR scan_id = ?)
       ORDER BY keyword`,
      [companyId, scanId, scanId]
    );
    rows = watchRows || [];

    if (hasRh) {
      const [histRows] = await pool.query(
        `SELECT rh.keyword_id, rh.\`rank\`, rh.scanned_at FROM rank_history rh
         INNER JOIN keyword_watchlist kw ON rh.keyword_id = kw.id
         WHERE kw.company_id = ? AND (? IS NULL OR kw.scan_id = ?)
         ORDER BY rh.scanned_at DESC`,
        [companyId, scanId, scanId]
      ).catch(() => [[]]);

      for (const h of histRows || []) {
        if (!histByKw[h.keyword_id]) histByKw[h.keyword_id] = [];
        histByKw[h.keyword_id].push({ rank: h.rank, scanned_at: h.scanned_at });
      }
    }

    const list = rows.map((r) => {
      const recs = (histByKw[r.id] || []).slice(0, 4);
      const curr = recs[0]?.rank ?? null;
      const prev = recs[1]?.rank ?? null;
      const delta = curr != null && prev != null ? prev - curr : null;
      let status = "out";
      if (curr != null) {
        if (prev == null) status = "new";
        else if (delta >= 5) status = "up";
        else if (delta <= -5) status = "drop";
        else if (Math.abs(delta) < 2) status = "flat";
        else status = "move";
      }
      return {
        id: r.id,
        keyword: r.keyword,
        search_volume: r.search_volume,
        current_rank: curr,
        previous_rank: prev,
        delta,
        status,
        records: recs,
      };
    });

    res.json(list);
  } catch (e) {
    if (e.code === "ER_NO_SUCH_TABLE") return res.json([]);
    console.error("[strategy] ranks error:", e.message);
    res.status(500).json({ error: "順位データの取得に失敗しました。" });
  }
});

/** GET /api/strategy/recommendations - 対策レコメンド（簡易版） */
router.get("/recommendations", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const scanParam = (req.query.scan || req.query.scanId || "").trim() || null;
  const overrideCid = req.query.company_id ? parseInt(req.query.company_id, 10) : null;
  const adminCompanyDump =
    !scanParam && overrideCid && !isNaN(overrideCid) && isAdmin(user);
  if (!scanParam && !adminCompanyDump) return res.json([]);

  let ctx;
  if (adminCompanyDump) {
    ctx = { ok: true, companyId: overrideCid, scanId: null };
  } else {
    ctx = await resolveStrategyContext(user, scanParam);
  }
  if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error });
  const { companyId, scanId } = ctx;

  try {
    const [tables] = await pool.query("SHOW TABLES LIKE 'keyword_watchlist'");
    if (!tables || tables.length === 0) return res.json([]);

    let hasGa = false;
    try {
      const [t] = await pool.query("SHOW TABLES LIKE 'generated_articles'");
      hasGa = t && t.length > 0;
    } catch (_) {}

    const [rows] = await pool.query(
      `SELECT kw.id, kw.keyword, kw.search_volume,
              (SELECT rh.\`rank\` FROM rank_history rh WHERE rh.keyword_id = kw.id ORDER BY rh.scanned_at DESC LIMIT 1) AS current_rank
              ${hasGa ? ", (SELECT 1 FROM generated_articles ga WHERE ga.keyword_id = kw.id LIMIT 1) AS has_article" : ""}
       FROM keyword_watchlist kw
       WHERE kw.company_id = ? AND kw.status = 'active'
         AND (? IS NULL OR kw.scan_id = ?)`,
      [companyId, scanId, scanId]
    );

    const recs = [];
    for (const r of rows || []) {
      const rank = r.current_rank;
      if (rank == null || rank > 20) {
        recs.push({
          type: "create_article",
          priority: "high",
          keyword: r.keyword,
          keyword_id: r.id,
          has_article: hasGa && !!r.has_article,
        });
      } else if (rank > 10 && rank <= 20) {
        recs.push({ type: "enhance_content", priority: "medium", keyword: r.keyword, keyword_id: r.id });
      }
    }
    res.json(recs.slice(0, 10));
  } catch (e) {
    if (e.code === "ER_NO_SUCH_TABLE") return res.json([]);
    res.status(500).json({ error: "レコメンドの取得に失敗しました。" });
  }
});

/** POST /api/strategy/article-outlines - 記事構成案生成 */
router.post("/article-outlines", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const keyword = (req.body?.keyword || "").trim();
  const keywordId = req.body?.keyword_id ? parseInt(req.body.keyword_id, 10) : null;
  const intent = req.body?.intent || "Informational";

  if (!keyword) return res.status(400).json({ error: "keyword は必須です" });

  try {
    const { generateArticleOutlines } = require("../services/articleGeneration");
    const outlines = await generateArticleOutlines(keyword, intent);
    res.json({ keyword, keyword_id: keywordId, outlines });
  } catch (e) {
    console.error("[strategy] article-outlines error:", e.message);
    res.status(500).json({ error: e.message || "記事構成案の生成に失敗しました。" });
  }
});

/** POST /api/strategy/article-body - 記事本文生成 */
router.post("/article-body", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const keyword = (req.body?.keyword || "").trim();
  const outline = req.body?.outline;
  const keywordId = req.body?.keyword_id ? parseInt(req.body.keyword_id, 10) : null;
  if (!keyword || !outline) return res.status(400).json({ error: "keyword と outline は必須です" });

  try {
    const { generateArticleBody } = require("../services/articleGeneration");
    const companyInfo = ""; // TODO: 会社情報を設定画面から取得
    const body = await generateArticleBody(keyword, outline, companyInfo);

    let articleId = null;
    if (keywordId) {
      try {
        const [t] = await pool.query("SHOW TABLES LIKE 'generated_articles'");
        if (t && t.length > 0) {
          const [existing] = await pool.query(
            "SELECT id FROM generated_articles WHERE keyword_id = ? ORDER BY created_at DESC LIMIT 1",
            [keywordId]
          );
          const outlineJson = JSON.stringify(outline);
          if (existing && existing.length > 0) {
            await pool.query(
              "UPDATE generated_articles SET outline_json = ?, body = ?, status = 'draft' WHERE id = ?",
              [outlineJson, body, existing[0].id]
            );
            articleId = existing[0].id;
          } else {
            const [ins] = await pool.query(
              `INSERT INTO generated_articles (keyword_id, outline_json, body, status) VALUES (?, ?, ?, 'draft')`,
              [keywordId, outlineJson, body]
            );
            articleId = ins.insertId;
          }
        }
      } catch (_) {}
    }

    res.json({ body, keyword, keyword_id: keywordId, article_id: articleId });
  } catch (e) {
    console.error("[strategy] article-body error:", e.message);
    res.status(500).json({ error: e.message || "記事本文の生成に失敗しました。" });
  }
});

/** GET /api/strategy/article - 保存済み記事取得（keyword_id 指定） */
router.get("/article", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const keywordId = req.query.keyword_id ? parseInt(req.query.keyword_id, 10) : null;
  if (!keywordId || isNaN(keywordId)) return res.status(400).json({ error: "keyword_id は必須です" });

  try {
    const companyId = await resolveCompanyId(user);
    if (!companyId) return res.status(400).json({ error: "company_id が設定されていません。" });

    const [rows] = await pool.query(
      `SELECT ga.id, ga.keyword_id, ga.outline_json, ga.body, ga.status, ga.created_at, kw.keyword
       FROM generated_articles ga
       INNER JOIN keyword_watchlist kw ON ga.keyword_id = kw.id
       WHERE ga.keyword_id = ? AND kw.company_id = ?
       ORDER BY ga.created_at DESC LIMIT 1`,
      [keywordId, companyId]
    );
    if (!rows || rows.length === 0) return res.status(404).json({ error: "記事が見つかりません" });

    const r = rows[0];
    res.json({
      id: r.id,
      keyword_id: r.keyword_id,
      keyword: r.keyword,
      outline: typeof r.outline_json === "string" ? JSON.parse(r.outline_json || "{}") : r.outline_json,
      body: r.body || "",
      status: r.status,
      created_at: r.created_at,
    });
  } catch (e) {
    console.error("[strategy] article get error:", e.message);
    res.status(500).json({ error: "記事の取得に失敗しました。" });
  }
});

/** PUT /api/strategy/article/:id - 記事保存 */
router.put("/article/:id", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const articleId = parseInt(req.params.id, 10);
  if (!articleId || isNaN(articleId)) return res.status(400).json({ error: "article id は必須です" });

  const body = req.body?.body;
  const outline = req.body?.outline;
  if (body === undefined) return res.status(400).json({ error: "body は必須です" });

  try {
    const companyId = await resolveCompanyId(user);
    if (!companyId) return res.status(400).json({ error: "company_id が設定されていません。" });

    const [rows] = await pool.query(
      `SELECT ga.id FROM generated_articles ga
       INNER JOIN keyword_watchlist kw ON ga.keyword_id = kw.id
       WHERE ga.id = ? AND kw.company_id = ?`,
      [articleId, companyId]
    );
    if (!rows || rows.length === 0) return res.status(404).json({ error: "記事が見つかりません" });

    const updates = ["body = ?"];
    const params = [String(body || "")];
    if (outline !== undefined) {
      updates.push("outline_json = ?");
      params.push(JSON.stringify(outline));
    }
    params.push(articleId);
    await pool.query(
      `UPDATE generated_articles SET ${updates.join(", ")} WHERE id = ?`,
      params
    );
    res.json({ success: true, id: articleId });
  } catch (e) {
    console.error("[strategy] article put error:", e.message);
    res.status(500).json({ error: "記事の保存に失敗しました。" });
  }
});

module.exports = router;
