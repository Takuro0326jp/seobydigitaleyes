/**
 * スキャン API（クロール・一覧・詳細・削除）
 * マルチテナント + URL単位アクセス制御
 * - admin/master: 制限なし
 * - 一般: company_id 一致 かつ user_url_access に紐づくURLのみ
 */
const express = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const cheerio = require("cheerio");
const { getUserIdFromRequest } = require("../services/session");
const {
  getUserWithContext,
  isAdmin,
  canWrite,
  canAccessScan,
  canAccessUrl,
  ensureCompanyUrl,
  grantUserUrlAccess,
} = require("../services/accessControl");
const pool = require("../db");
const { enqueueCrawl } = require("../services/crawlQueue");
const { runScanCrawl } = require("../services/scanCrawl");
const { handleTrends } = require("./scan");

const router = express.Router();

const MAX_PAGES = Number(process.env.MAX_CRAWL_PAGES || 1000);

const scanCreateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: { error: "スキャンの作成が多すぎます。5分後に再試行してください。" },
  standardHeaders: true,
  legacyHeaders: false,
});

function isValidUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeUrl(raw) {
  const u = new URL(raw);
  u.hash = "";
  if (u.pathname !== "/" && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }
  return u.toString();
}

function sameHost(base, candidate) {
  try {
    const b = new URL(base);
    const c = new URL(candidate, base);
    return b.hostname === c.hostname;
  } catch {
    return false;
  }
}

function domainFromTargetUrl(targetUrl) {
  try {
    return new URL(targetUrl).hostname;
  } catch {
    return targetUrl || "";
  }
}

/**
 * 同一ドメイン判定用（小文字・先頭 www を除く）
 * プロトコル省略・末尾空白などでも揃える
 */
function canonicalDomainKey(targetUrl) {
  let s = String(targetUrl || "").trim();
  if (!s) return "";
  try {
    if (!/^https?:\/\//i.test(s)) {
      s = `https://${s.replace(/^\/+/, "")}`;
    }
    let h = new URL(s).hostname.toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  } catch {
    const noProto = s.replace(/^https?:\/\//i, "").replace(/^\/+/, "");
    let h = noProto.split("/")[0].split("?")[0].split("#")[0];
    h = h.split(":")[0].toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h || "";
  }
}

/**
 * 同一企業・同一正規化ドメインの scans を1件にまとめる（直近に登録された行を残す）
 */
async function mergeScansToOnePerDomain(userId, companyId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id, target_url, created_at FROM scans WHERE company_id = ?`,
      [companyId]
    );
    const byKey = new Map();
    for (const row of rows) {
      const k = canonicalDomainKey(row.target_url);
      if (!k) continue;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(row);
    }
    for (const list of byKey.values()) {
      if (list.length < 2) continue;
      list.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      const keep = list[0];
      let earliest = keep.created_at;
      for (const r of list) {
        if (new Date(r.created_at) < new Date(earliest)) earliest = r.created_at;
      }
      for (const del of list.slice(1)) {
        await conn.query(`DELETE FROM scan_pages WHERE scan_id = ?`, [del.id]);
        await conn.query(`DELETE FROM scans WHERE id = ?`, [del.id]);
      }
      await conn.query(`UPDATE scans SET created_at = ? WHERE id = ?`, [
        earliest,
        keep.id,
      ]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function crawlScan(scanId, startUrl) {
  // 二重実行防止: status が queued/failed のときのみ running に更新
  const [updateResult] = await pool.query(
    `UPDATE scans SET status = 'running' WHERE id = ? AND status IN ('queued', 'failed')`,
    [scanId]
  );
  if (updateResult.affectedRows === 0) {
    return; // 既に別プロセスで実行中、または存在しない
  }

  const visited = new Set();
  const queue = [{ url: startUrl, depth: 1 }];

  const conn = await pool.getConnection();
  try {
    let totalScore = 0;
    let pageCount = 0;

    while (queue.length && pageCount < MAX_PAGES) {
      const { url, depth } = queue.shift();
      const normalized = normalizeUrl(url);
      if (visited.has(normalized)) continue;
      visited.add(normalized);

      let statusCode = null;
      let internalLinks = 0;
      let externalLinks = 0;
      let score = 80;

      try {
        const res = await fetch(normalized, {
          redirect: "follow",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; SEOScanBot/1.0; +https://example.com)",
          },
        });
        statusCode = res.status;

        const contentType = res.headers.get("content-type") || "";
        if (res.ok && contentType.includes("text/html")) {
          const html = await res.text();
          const $ = cheerio.load(html);

          const title = ($("title").text() || "").trim();
          const h1 = $("h1").first().text().trim();

          if (!title) score -= 10;
          if (!h1) score -= 5;
          if (depth > 4) score -= 5;

          $("a[href]").each((_, el) => {
            const href = $(el).attr("href");
            if (!href) return;
            try {
              const abs = new URL(href, normalized).toString();
              const absNorm = normalizeUrl(abs);
              if (sameHost(normalized, abs)) {
                internalLinks++;
                if (
                  !visited.has(absNorm) &&
                  queue.length + visited.size < MAX_PAGES
                ) {
                  queue.push({ url: absNorm, depth: depth + 1 });
                }
              } else {
                externalLinks++;
              }
            } catch {
              // ignore
            }
          });
        }
      } catch {
        statusCode = statusCode ?? 0;
        score -= 10;
      }

      if (score < 0) score = 0;
      if (score > 100) score = 100;

      await conn.query(
        `INSERT INTO scan_pages
          (scan_id, url, depth, score, status_code, internal_links, external_links)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          scanId,
          normalized,
          depth,
          score,
          statusCode,
          internalLinks,
          externalLinks,
        ]
      );

      totalScore += score;
      pageCount++;
    }

    const avg = pageCount ? Math.round(totalScore / pageCount) : null;

    try {
      await conn.query(
        `UPDATE scans SET status = 'completed', avg_score = ?, updated_at = NOW() WHERE id = ?`,
        [avg, scanId]
      );
    } catch {
      await conn.query(
        `UPDATE scans SET status = 'completed', avg_score = ? WHERE id = ?`,
        [avg, scanId]
      );
    }
  } catch (e) {
    console.error("crawlScan error:", e);
    try {
      await conn.query(
        `UPDATE scans SET status = 'failed', updated_at = NOW() WHERE id = ?`,
        [scanId]
      );
    } catch {
      await conn.query(`UPDATE scans SET status = 'failed' WHERE id = ?`, [
        scanId,
      ]);
    }
  } finally {
    conn.release();
  }
}

async function assertScanAccess(scanId, user) {
  if (!user) return false;
  if (isAdmin(user)) {
    const [rows] = await pool.query(`SELECT id FROM scans WHERE id = ? LIMIT 1`, [scanId]);
    return rows.length > 0;
  }
  if (user.company_id == null) return false;
  return canAccessScan(user.id, user.company_id, user.role, scanId);
}

// POST /api/scans — 新規スキャン（バックグラウンドでクロール）
// user ロールは閲覧のみのため禁止
router.post("/", scanCreateLimiter, async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!canWrite(user)) {
    return res.status(403).json({ error: "閲覧権限のみです。スキャン作成は管理者に依頼してください。" });
  }

  const target_url = (req.body?.target_url || "").trim();
  if (!isValidUrl(target_url)) {
    return res.status(400).json({ error: "invalid url" });
  }

  const normalized = normalizeUrl(target_url);

  // 一般ユーザー: company_id 必須、かつ URL へのアクセス権が必要
  if (!isAdmin(user)) {
    if (user.company_id == null) {
      return res.status(403).json({ error: "企業に所属していません。管理者に連絡してください。" });
    }
    const hasAccess = await canAccessUrl(user.id, user.company_id, user.role, normalized);
    if (!hasAccess) {
      // company_urls に存在しない場合は登録し、作成者にアクセス権を付与
      const { id: urlId, created } = await ensureCompanyUrl(user.company_id, normalized);
      if (created) {
        await grantUserUrlAccess(user.id, urlId);
      } else {
        return res.status(403).json({ error: "このURLへのアクセス権限がありません。" });
      }
    } else {
      await ensureCompanyUrl(user.company_id, normalized);
    }
  } else {
    // admin: company_id がなければデフォルト企業を使用するか拒否
    if (user.company_id == null) {
      const [[firstCompany]] = await pool.query(`SELECT id FROM companies LIMIT 1`);
      if (!firstCompany) {
        return res.status(400).json({ error: "企業が登録されていません。" });
      }
      user.company_id = firstCompany.id;
    }
    await ensureCompanyUrl(user.company_id, normalized);
  }

  const key = canonicalDomainKey(normalized);

  try {
    const [all] = await pool.query(
      `SELECT id, target_url, created_at FROM scans WHERE company_id = ?`,
      [user.company_id]
    );
    const matches = all
      .filter((r) => canonicalDomainKey(r.target_url) === key)
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

    let scanId;

    if (matches.length > 0) {
      const keep = matches[0];
      scanId = keep.id;
      let earliest = keep.created_at;
      for (const r of matches) {
        if (new Date(r.created_at) < new Date(earliest)) earliest = r.created_at;
      }
      for (const del of matches.slice(1)) {
        await pool.query(`DELETE FROM scan_pages WHERE scan_id = ?`, [del.id]);
        await pool.query(`DELETE FROM scans WHERE id = ?`, [del.id]);
      }
      await pool.query(`DELETE FROM scan_pages WHERE scan_id = ?`, [scanId]);
      try {
        await pool.query(
          `UPDATE scans SET target_url = ?, status = 'queued', avg_score = NULL,
           created_at = ?, updated_at = NOW() WHERE id = ?`,
          [normalized, earliest, scanId]
        );
      } catch {
        await pool.query(
          `UPDATE scans SET target_url = ?, status = 'queued', avg_score = NULL,
           created_at = ? WHERE id = ?`,
          [normalized, earliest, scanId]
        );
      }
    } else {
      scanId = crypto.randomUUID();
      try {
        await pool.query(
          `INSERT INTO scans (id, user_id, company_id, target_url, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'queued', NOW(), NOW())`,
          [scanId, user.id, user.company_id, normalized]
        );
      } catch {
        await pool.query(
          `INSERT INTO scans (id, user_id, company_id, target_url, status, created_at)
           VALUES (?, ?, ?, ?, 'queued', NOW())`,
          [scanId, user.id, user.company_id, normalized]
        );
      }
    }

    setImmediate(() => {
      enqueueCrawl(() => runScanCrawl(scanId, normalized));
    });

    return res.status(202).json({ scanId });
  } catch (e) {
    console.error("create scan error:", e);
    return res.status(500).json({ error: "scan create error" });
  }
});

// GET /api/scans — 一覧（1正規化ドメインにつき1行）
router.get("/", async (req, res) => {
  try {
    const user = await getUserWithContext(req);
    if (!user) {
      return res.status(401).json({ error: "unauthorized" });
    }

    let rows;
    if (isAdmin(user)) {
      try {
        const [r] = await pool.query(
          `SELECT s.id, s.target_url, s.status, s.created_at, s.avg_score, s.updated_at, s.company_id, s.gsc_property_url, s.error_message, c.name AS company_name
           FROM scans s
           LEFT JOIN companies c ON s.company_id = c.id
           ORDER BY COALESCE(s.updated_at, s.created_at) DESC`
        );
        rows = r;
      } catch {
        const [r] = await pool.query(
          `SELECT s.id, s.target_url, s.status, s.created_at, s.avg_score, s.company_id, s.gsc_property_url, s.error_message, c.name AS company_name
           FROM scans s
           LEFT JOIN companies c ON s.company_id = c.id
           ORDER BY s.created_at DESC`
        );
        rows = r.map((row) => ({ ...row, updated_at: null }));
      }
    } else {
      if (user.company_id == null) {
        return res.json([]);
      }
      try {
        await mergeScansToOnePerDomain(user.id, user.company_id);
      } catch (mergeErr) {
        console.error("mergeScansToOnePerDomain:", mergeErr.message || mergeErr);
      }
      try {
        const [r] = await pool.query(
          `SELECT s.id, s.target_url, s.status, s.created_at, s.avg_score, s.updated_at, s.company_id, s.gsc_property_url, c.name AS company_name
           FROM scans s
           LEFT JOIN companies c ON s.company_id = c.id
           JOIN company_urls cu ON s.target_url = cu.url AND s.company_id = cu.company_id
           JOIN user_url_access ua ON ua.url_id = cu.id
           WHERE ua.user_id = ? AND s.company_id = ?
           ORDER BY COALESCE(s.updated_at, s.created_at) DESC`,
          [user.id, user.company_id]
        );
        rows = r;
      } catch {
        const [r] = await pool.query(
          `SELECT s.id, s.target_url, s.status, s.created_at, s.avg_score, s.company_id, s.gsc_property_url, s.error_message, c.name AS company_name
           FROM scans s
           LEFT JOIN companies c ON s.company_id = c.id
           JOIN company_urls cu ON s.target_url = cu.url AND s.company_id = cu.company_id
           JOIN user_url_access ua ON ua.url_id = cu.id
           WHERE ua.user_id = ? AND s.company_id = ?
           ORDER BY s.created_at DESC`,
          [user.id, user.company_id]
        );
        rows = r.map((row) => ({ ...row, updated_at: null }));
      }
    }

    const seenCanon = new Set();
    const body = [];
    for (const row of rows) {
      const canon = canonicalDomainKey(row.target_url);
      const dedupeKey = canon || `__id:${row.id}`;
      if (canon && seenCanon.has(canon)) continue;
      if (canon) seenCanon.add(canon);

      body.push({
        id: row.id,
        domain: canon || domainFromTargetUrl(row.target_url) || row.target_url,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at || row.created_at,
        avg_score: row.avg_score,
        company_id: row.company_id ?? null,
        company_name: row.company_name ?? null,
        gsc_property_url: row.gsc_property_url ?? null,
        error_message: row.error_message ?? null,
      });
    }

    return res.json(body);
  } catch (e) {
    console.error("GET /api/scans error:", e);
    return res.status(500).json({ error: "list error" });
  }
});

// GET /api/scans/trends?url=xxx — 過去スキャン推移（/:scanId より前に登録）
router.get("/trends", (req, res, next) => handleTrends(req, res).catch(next));

// GET /api/scans/:scanId/progress
router.get("/:scanId/progress", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { scanId } = req.params;
  if (!user || !(await assertScanAccess(scanId, user))) {
    return res.status(404).json({ error: "not found" });
  }

  try {
    const [[scan]] = await pool.query(
      `SELECT status FROM scans WHERE id = ? LIMIT 1`,
      [scanId]
    );
    const [[count]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM scan_pages WHERE scan_id = ?`,
      [scanId]
    );

    return res.json({
      processed_pages: count.cnt,
      total_pages: MAX_PAGES,
      status: scan?.status || "unknown",
    });
  } catch (e) {
    console.error("progress error:", e);
    return res.status(500).json({ error: "progress error" });
  }
});

// GET /api/scans/:scanId/link-analysis — リンク分析（PageRank）
// user も company_id + user_url_access でアクセス可能
router.get("/:scanId/link-analysis", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const { scanId } = req.params;
  if (!(await assertScanAccess(scanId, user))) {
    return res.status(404).json({ error: "not found" });
  }
  try {
    const [pages] = await pool.query(
      `SELECT id, url, depth, internal_links, external_links
       FROM scan_pages WHERE scan_id = ? ORDER BY id`,
      [scanId]
    );
    const urlToId = new Map();
    pages.forEach((p, i) => urlToId.set(p.url, i));
    const n = pages.length;
    const linkGraph = pages.map(() => []);
    const [linkRows] = await pool.query(
      `SELECT from_url, to_url FROM scan_links WHERE scan_id = ?`,
      [scanId]
    ).catch(() => [[]]);
    for (const row of linkRows) {
      const fromIdx = urlToId.get(row.from_url);
      const toIdx = urlToId.get(row.to_url);
      if (fromIdx != null && toIdx != null && fromIdx !== toIdx) {
        if (!linkGraph[fromIdx].includes(toIdx)) linkGraph[fromIdx].push(toIdx);
      }
    }
    const outDegree = linkGraph.map((arr) => arr.length || 1);
    let pr = Array(n).fill(1 / n);
    const damping = 0.85;
    const maxIter = 50;
    for (let iter = 0; iter < maxIter; iter++) {
      const next = Array(n).fill((1 - damping) / n);
      for (let i = 0; i < n; i++) {
        for (const j of linkGraph[i]) next[j] += (damping * pr[i]) / outDegree[i];
      }
      pr = next;
    }
    const result = pages.map((p, i) => ({
      url: p.url,
      depth: p.depth,
      internal_links: p.internal_links,
      external_links: p.external_links,
      page_rank: Math.round(pr[i] * 10000) / 10000,
    }));
    result.sort((a, b) => b.page_rank - a.page_rank);
    return res.json({ scan_id: scanId, pages: result });
  } catch (e) {
    console.error("link-analysis:", e);
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/scans/:scanId — 詳細＋ページ
router.get("/:scanId", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { scanId } = req.params;
  if (!(await assertScanAccess(scanId, user))) {
    return res.status(404).json({ error: "not found" });
  }

  try {
    const [scans] = await pool.query(
      `SELECT * FROM scans WHERE id = ? LIMIT 1`,
      [scanId]
    );
    if (!scans.length) {
      return res.status(404).json({ error: "not found" });
    }

    const [pages] = await pool.query(
      `SELECT url, depth, score, status_code, internal_links, external_links
       FROM scan_pages
       WHERE scan_id = ?
       ORDER BY depth ASC, id ASC`,
      [scanId]
    );

    return res.json({ scan: scans[0], pages });
  } catch (e) {
    console.error("scan detail error:", e);
    return res.status(500).json({ error: "detail error" });
  }
});

// PATCH /api/scans/:scanId — 設定更新（company_id: admin のみ、gsc_property_url: アクセス可能なら誰でも）
router.patch("/:scanId", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { scanId } = req.params;
  if (!(await assertScanAccess(scanId, user))) {
    return res.status(404).json({ error: "not found" });
  }

  const companyId = req.body?.company_id;
  const gscPropertyUrl = typeof req.body?.gsc_property_url === "string"
    ? req.body.gsc_property_url.trim() || null
    : null;

  try {
    const updates = [];
    const values = [];

    if (companyId !== undefined && companyId !== null) {
      if (!canWrite(user)) {
        return res.status(403).json({ error: "閲覧権限のみです。クライアント変更は管理者に依頼してください。" });
      }
      const cid = parseInt(companyId, 10);
      if (isNaN(cid) || cid < 1) {
        return res.status(400).json({ error: "company_id が不正です" });
      }
      const [[exists]] = await pool.query(
        "SELECT id FROM companies WHERE id = ? LIMIT 1",
        [cid]
      );
      if (!exists) {
        return res.status(400).json({ error: "指定のクライアントが存在しません" });
      }
      updates.push("company_id = ?");
      values.push(cid);
    }

    if (gscPropertyUrl !== undefined) {
      updates.push("gsc_property_url = ?");
      values.push(gscPropertyUrl);
    }

    if (updates.length > 0) {
      values.push(scanId);
      await pool.query(
        `UPDATE scans SET ${updates.join(", ")} WHERE id = ?`,
        values
      );
    }
    return res.json({ success: true });
  } catch (e) {
    console.error("patch scan settings error:", e);
    return res.status(500).json({ error: "update error" });
  }
});

// DELETE /api/scans/:scanId
// user ロールは閲覧のみのため禁止
router.delete("/:scanId", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!canWrite(user)) {
    return res.status(403).json({ error: "閲覧権限のみです。削除は管理者に依頼してください。" });
  }

  const { scanId } = req.params;
  if (!(await assertScanAccess(scanId, user))) {
    return res.status(404).json({ error: "not found" });
  }

  try {
    await pool.query(`DELETE FROM scan_pages WHERE scan_id = ?`, [scanId]);
    await pool.query(`DELETE FROM scans WHERE id = ?`, [scanId]);
    return res.json({ success: true });
  } catch (e) {
    console.error("delete scan error:", e);
    return res.status(500).json({ error: "delete error" });
  }
});

module.exports = router;
