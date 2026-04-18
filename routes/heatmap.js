/**
 * ヒートマップ分析 API
 * - POST /collect        : トラッカーからのイベント受信（site_key認証）
 * - GET/POST/PUT/DELETE /sites : サイト管理（セッション認証）
 * - GET /sites/:id/pages|data|clicks : データ取得（セッション認証）
 */
const express = require("express");
const crypto = require("crypto");
const pool = require("../db");
const { getUserWithContext, isAdmin } = require("../services/accessControl");
const { findSiteByKey, resolveSession, insertEvents } = require("../services/heatmapCollect");

const router = express.Router();

/* ─────────────── データ収集（site_key 認証、CORS 対応） ─────────────── */

// text/plain で送信されるケースに対応（CORS プリフライト回避）
router.post("/collect", express.text({ type: "*/*", limit: "512kb" }), async (req, res) => {
  // CORS ヘッダー
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "invalid JSON" });
  }

  const { site_key, session_token, page_url, viewport_w, viewport_h, page_h, events } = body || {};
  if (!site_key || !session_token || !page_url || !events?.length) {
    return res.status(400).json({ error: "missing required fields" });
  }

  const site = await findSiteByKey(site_key);
  if (!site) return res.status(403).json({ error: "invalid site_key" });

  try {
    const sessionId = await resolveSession(
      site.id, session_token, page_url,
      viewport_w || 0, viewport_h || 0, page_h || null, req
    );
    await insertEvents(sessionId, events);
    return res.status(204).end();
  } catch (err) {
    console.error("[heatmap/collect] error:", err.message);
    return res.status(500).json({ error: "internal error" });
  }
});

// OPTIONS プリフライト対応
router.options("/collect", (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.status(204).end();
});

/* ─────────────── ヘルパー ─────────────── */

async function requireAuth(req, res) {
  const user = await getUserWithContext(req);
  if (!user) {
    res.status(401).json({ error: "ログインが必要です" });
    return null;
  }
  return user;
}

/** 自社のサイトか確認 */
async function assertSiteAccess(siteId, user) {
  const [rows] = await pool.query(
    "SELECT id, company_id, site_url, site_key, label, is_active, created_at FROM heatmap_sites WHERE id = ? LIMIT 1",
    [siteId]
  );
  if (!rows.length) return null;
  const site = rows[0];
  if (site.company_id !== user.company_id && !isAdmin(user)) return null;
  return site;
}

/* ─────────────── サイト管理 CRUD（セッション認証） ─────────────── */

// GET /api/heatmap/sites — 自社サイト一覧
router.get("/sites", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  let rows;
  if (user.company_id) {
    [rows] = await pool.query(
      "SELECT id, site_url, site_key, label, is_active, created_at FROM heatmap_sites WHERE company_id = ? ORDER BY created_at DESC",
      [user.company_id]
    );
  } else {
    // master（company_id=NULL）は全サイト表示
    [rows] = await pool.query(
      "SELECT id, site_url, site_key, label, is_active, created_at FROM heatmap_sites ORDER BY created_at DESC"
    );
  }
  res.json({ sites: rows });
});

// POST /api/heatmap/sites — サイト登録
router.post("/sites", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!isAdmin(user)) return res.status(403).json({ error: "管理者権限が必要です" });

  // master (company_id=NULL) はリクエストで company_id を指定可能、デフォルトは1
  const companyId = user.company_id || (req.body.company_id ? parseInt(req.body.company_id, 10) : 1);
  if (!companyId) return res.status(400).json({ error: "company_id が必要です" });

  const siteUrl = (req.body.site_url || "").trim();
  if (!siteUrl) return res.status(400).json({ error: "site_url が必要です" });

  const siteKey = crypto.randomBytes(32).toString("hex");

  const [result] = await pool.query(
    "INSERT INTO heatmap_sites (company_id, site_url, site_key, label) VALUES (?, ?, ?, ?)",
    [companyId, siteUrl, siteKey, req.body.label || null]
  );
  res.status(201).json({ id: result.insertId, site_key: siteKey });
});

// PUT /api/heatmap/sites/:id — 更新
router.put("/sites/:id", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!isAdmin(user)) return res.status(403).json({ error: "管理者権限が必要です" });

  const site = await assertSiteAccess(req.params.id, user);
  if (!site) return res.status(404).json({ error: "サイトが見つかりません" });

  const updates = [];
  const values = [];
  if (req.body.label !== undefined) { updates.push("label = ?"); values.push(req.body.label); }
  if (req.body.is_active !== undefined) { updates.push("is_active = ?"); values.push(req.body.is_active ? 1 : 0); }
  if (req.body.site_url) { updates.push("site_url = ?"); values.push(req.body.site_url); }

  if (updates.length === 0) return res.status(400).json({ error: "更新する項目がありません" });

  values.push(site.id);
  await pool.query(`UPDATE heatmap_sites SET ${updates.join(", ")} WHERE id = ?`, values);
  res.json({ ok: true });
});

// DELETE /api/heatmap/sites/:id — 削除（CASCADE）
router.delete("/sites/:id", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!isAdmin(user)) return res.status(403).json({ error: "管理者権限が必要です" });

  const site = await assertSiteAccess(req.params.id, user);
  if (!site) return res.status(404).json({ error: "サイトが見つかりません" });

  await pool.query("DELETE FROM heatmap_sites WHERE id = ?", [site.id]);
  res.json({ ok: true });
});

/* ─────────────── データ取得（セッション認証） ─────────────── */

// GET /api/heatmap/sites/:id/pages — ページ一覧（クリック数付き）
router.get("/sites/:id/pages", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const site = await assertSiteAccess(req.params.id, user);
  if (!site) return res.status(404).json({ error: "サイトが見つかりません" });

  const [rows] = await pool.query(
    `SELECT s.page_url, COUNT(e.id) AS click_count, MAX(e.created_at) AS last_event
     FROM heatmap_sessions s
     LEFT JOIN heatmap_events e ON e.session_id = s.id AND e.event_type = 'click'
     WHERE s.site_id = ?
     GROUP BY s.page_url
     ORDER BY click_count DESC
     LIMIT 200`,
    [site.id]
  );
  res.json({ pages: rows });
});

// GET /api/heatmap/sites/:id/data — 集計済みクリックデータ
router.get("/sites/:id/data", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const site = await assertSiteAccess(req.params.id, user);
  if (!site) return res.status(404).json({ error: "サイトが見つかりません" });

  const pageUrl = (req.query.page_url || "").trim();
  if (!pageUrl) return res.status(400).json({ error: "page_url が必要です" });

  // フィルタ条件
  const conditions = ["s.site_id = ?", "s.page_url = ?", "e.event_type = 'click'"];
  const params = [site.id, pageUrl];

  if (req.query.date_from) {
    conditions.push("e.created_at >= ?");
    params.push(req.query.date_from);
  }
  if (req.query.date_to) {
    conditions.push("e.created_at <= ?");
    params.push(req.query.date_to + " 23:59:59");
  }
  if (req.query.device_type && req.query.device_type !== "all") {
    conditions.push("s.device_type = ?");
    params.push(req.query.device_type);
  }

  // 0.5% 単位でグリッド集計
  const [rows] = await pool.query(
    `SELECT
       ROUND(e.x_pct * 2) / 2 AS x,
       ROUND(e.y_pct * 2) / 2 AS y,
       COUNT(*) AS count
     FROM heatmap_events e
     JOIN heatmap_sessions s ON s.id = e.session_id
     WHERE ${conditions.join(" AND ")}
     GROUP BY x, y
     ORDER BY count DESC
     LIMIT 5000`,
    params
  );

  // メタ情報
  const [[meta]] = await pool.query(
    `SELECT COUNT(DISTINCT s.id) AS sessions, AVG(s.viewport_w) AS avg_w, AVG(s.viewport_h) AS avg_h, AVG(s.page_h) AS avg_page_h
     FROM heatmap_sessions s WHERE s.site_id = ? AND s.page_url = ?`,
    [site.id, pageUrl]
  );

  res.json({ points: rows, meta });
});

// GET /api/heatmap/sites/:id/clicks — クリック要素ランキング
router.get("/sites/:id/clicks", async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const site = await assertSiteAccess(req.params.id, user);
  if (!site) return res.status(404).json({ error: "サイトが見つかりません" });

  const pageUrl = (req.query.page_url || "").trim();
  if (!pageUrl) return res.status(400).json({ error: "page_url が必要です" });

  const [rows] = await pool.query(
    `SELECT e.element_tag, e.element_text, COUNT(*) AS count
     FROM heatmap_events e
     JOIN heatmap_sessions s ON s.id = e.session_id
     WHERE s.site_id = ? AND s.page_url = ? AND e.event_type = 'click'
       AND e.element_tag IS NOT NULL
     GROUP BY e.element_tag, e.element_text
     ORDER BY count DESC
     LIMIT 50`,
    [site.id, pageUrl]
  );
  res.json({ clicks: rows });
});

module.exports = router;
