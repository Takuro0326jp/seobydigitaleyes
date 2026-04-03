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
const { getAccessibleUrls } = require("../services/userUrlAccess");
const pool = require("../db");
const { enqueueCrawl, setScanStartTime, getScanStartTime } = require("../services/crawlQueue");
const { runScanCrawl } = require("../services/scanCrawl");
const {
  MAX_CRAWL_PAGES: MAX_PAGES,
  CRAWL_RUN_TIMEOUT_MS,
} = require("../services/crawlLimits");

/** 一覧用: 同一ドメインに複数 scans があるとき、進行中を優先して1件にまとめる */
function pickBetterScanForDomain(prev, next) {
  if (!prev) return next;
  const prevRun = prev.status === "running" || prev.status === "queued";
  const nextRun = next.status === "running" || next.status === "queued";
  if (nextRun && !prevRun) return next;
  if (prevRun && !nextRun) return prev;
  const ta = new Date(prev.updated_at || prev.created_at || 0).getTime();
  const tb = new Date(next.updated_at || next.created_at || 0).getTime();
  return tb >= ta ? next : prev;
}

/** 長時間クロール後も誤って completed にしない（CRAWL_RUN_TIMEOUT より十分後のみリカバリ） */
const STUCK_RECOVERY_AFTER_MINUTES =
  Math.ceil(CRAWL_RUN_TIMEOUT_MS / 60000) + 15;
const { handleTrends } = require("./scan");

const router = express.Router();

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

const lastReEnqueueAt = new Map();
const RE_ENQUEUE_COOLDOWN_MS = 5 * 60 * 1000;

async function reEnqueueStuckQueuedScan(scanId, targetUrl) {
  try {
    const now = Date.now();
    if (now - (lastReEnqueueAt.get(scanId) || 0) < RE_ENQUEUE_COOLDOWN_MS) return;
    const [[row]] = await pool.query(
      `SELECT status FROM scans WHERE id = ? LIMIT 1`,
      [scanId]
    );
    if (row?.status !== "queued") return;
    lastReEnqueueAt.set(scanId, now);
    const normalized = normalizeUrl(targetUrl);
    setScanStartTime(scanId);
    enqueueCrawl(() => runScanCrawl(scanId, normalized));
    console.log("[scans] queued scan", scanId, "をキューに再追加");
  } catch (e) {
    console.warn("[scans] reEnqueueStuckQueuedScan:", e?.message);
  }
}

async function recoverStuckScanWithPages(scanId) {
  try {
    const [[stats]] = await pool.query(
      `SELECT ROUND(AVG(score)) AS avg_score, COUNT(*) AS page_count,
       SUM(CASE WHEN status_code >= 400 OR is_noindex = 1 OR COALESCE(title,'') = '' OR COALESCE(h1_count,0) = 0 OR CHAR_LENGTH(COALESCE(title,'')) < 10 THEN 1 ELSE 0 END) AS critical
       FROM scan_pages WHERE scan_id = ?`,
      [scanId]
    );
    const avg = stats?.avg_score ?? null;
    const [r] = await pool.query(
      `UPDATE scans SET status = 'completed', avg_score = ?, error_message = NULL, updated_at = NOW() WHERE id = ? AND status = 'running'`,
      [avg, scanId]
    );
    if (r?.affectedRows > 0) {
      try {
        await pool.query(
          `INSERT INTO scan_history (scan_id, avg_score, page_count, critical_issues) VALUES (?,?,?,?)`,
          [scanId, avg, stats?.page_count ?? 0, stats?.critical ?? 0]
        );
      } catch {
        /* scan_history 未作成時はスキップ */
      }
      console.log("[scans] stuck scan", scanId, "→ completed (ページデータあり)");
    }
  } catch (e) {
    console.warn("[scans] recoverStuckScanWithPages:", e?.message);
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
          `UPDATE scans SET target_url = ?, status = 'queued', avg_score = NULL, error_message = NULL,
           created_at = ?, started_at = NOW(), updated_at = NOW() WHERE id = ?`,
          [normalized, earliest, scanId]
        );
      } catch {
        try {
          await pool.query(
            `UPDATE scans SET target_url = ?, status = 'queued', avg_score = NULL, error_message = NULL,
             created_at = ?, started_at = NOW() WHERE id = ?`,
            [normalized, earliest, scanId]
          );
        } catch {
          await pool.query(
            `UPDATE scans SET target_url = ?, status = 'queued', avg_score = NULL, error_message = NULL,
             created_at = ?, updated_at = NOW() WHERE id = ?`,
            [normalized, earliest, scanId]
          );
        }
      }
    } else {
      scanId = crypto.randomUUID();
      try {
        await pool.query(
          `INSERT INTO scans (id, user_id, company_id, target_url, status, created_at, started_at, updated_at)
           VALUES (?, ?, ?, ?, 'queued', NOW(), NOW(), NOW())`,
          [scanId, user.id, user.company_id, normalized]
        );
      } catch {
        try {
          await pool.query(
            `INSERT INTO scans (id, user_id, company_id, target_url, status, created_at, started_at)
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
    }

    setScanStartTime(scanId);
    enqueueCrawl(() => runScanCrawl(scanId, normalized));

    return res.status(202).json({ scanId });
  } catch (e) {
    console.error("create scan error:", e);
    return res.status(500).json({ error: "scan create error" });
  }
});

// GET /api/scans/debug — 一般ユーザー表示の診断（開発用）
router.get("/debug", async (req, res) => {
  try {
    const user = await getUserWithContext(req);
    if (!user) return res.status(401).json({ error: "unauthorized" });
    if (isAdmin(user)) return res.json({ msg: "admin は全件表示のためスキップ" });

    const urls = await getAccessibleUrls(user.id, user.company_id);
    const allowedCanons = [...new Set(urls.map((u) => canonicalDomainKey(u)))];
    const [allScans] = await pool.query(
      `SELECT id, target_url, status, company_id FROM scans ORDER BY created_at DESC`
    );
    const scansWithCanon = (allScans || []).map((s) => ({
      id: s.id,
      target_url: s.target_url,
      canon: canonicalDomainKey(s.target_url),
      match: allowedCanons.includes(canonicalDomainKey(s.target_url)),
    }));
    return res.json({
      user_id: user.id,
      company_id: user.company_id,
      accessible_urls: urls,
      allowedCanons,
      scansSample: scansWithCanon,
      o_eighty_in_allowed: allowedCanons.includes("o-eighty.com"),
      o_eighty_scans: scansWithCanon.filter((s) => s.canon === "o-eighty.com"),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
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
    const SCANS_LIST_LIMIT = 200; // 一覧表示の最大件数（履歴の肥大化を防ぐ）
    if (isAdmin(user)) {
      try {
        const [r] = await pool.query(
          `SELECT s.id, s.target_url, s.status, s.created_at, s.started_at, s.avg_score, s.updated_at, s.company_id, s.gsc_property_url, s.error_message, c.name AS company_name
           FROM scans s
           LEFT JOIN companies c ON s.company_id = c.id
           ORDER BY COALESCE(s.updated_at, s.created_at) DESC
           LIMIT ?`,
          [SCANS_LIST_LIMIT]
        );
        rows = r;
      } catch {
        const [r] = await pool.query(
          `SELECT s.id, s.target_url, s.status, s.created_at, s.avg_score, s.updated_at, s.company_id, s.gsc_property_url, s.error_message, c.name AS company_name
           FROM scans s
           LEFT JOIN companies c ON s.company_id = c.id
           ORDER BY s.created_at DESC
           LIMIT ?`,
          [SCANS_LIST_LIMIT]
        );
        rows = r.map((row) => ({ ...row, started_at: null }));
      }
    } else {
      // 一般ユーザー: 閲覧可能URL（user_url_access）を起点に構築。scans ベースにすると
      // company_urls にないドメイン（ronherman.jp 等）が混入するため、権限付与リストと完全一致させる
      if (user.company_id == null) {
        return res.json([]);
      }
      try {
        await mergeScansToOnePerDomain(user.id, user.company_id);
      } catch (mergeErr) {
        console.error("mergeScansToOnePerDomain:", mergeErr.message || mergeErr);
      }
      const [companyRow] = await pool.query(
        "SELECT name FROM companies WHERE id = ? LIMIT 1",
        [user.company_id]
      );
      const companyName = companyRow?.[0]?.name || null;
      const accessibleUrls = await getAccessibleUrls(user.id, user.company_id);
      if (accessibleUrls.length === 0) {
        rows = [];
      } else {
        let scansRows = [];
        try {
          const [r] = await pool.query(
            `SELECT s.id, s.target_url, s.status, s.created_at, s.started_at, s.avg_score, s.updated_at, s.company_id, s.gsc_property_url, s.error_message, c.name AS company_name
             FROM scans s
             LEFT JOIN companies c ON s.company_id = c.id
             WHERE s.company_id = ?
             ORDER BY COALESCE(s.updated_at, s.created_at) DESC`,
            [user.company_id]
          );
          scansRows = r || [];
        } catch {
          const [r] = await pool.query(
            `SELECT s.id, s.target_url, s.status, s.created_at, s.avg_score, s.updated_at, s.company_id, s.gsc_property_url, s.error_message, c.name AS company_name
             FROM scans s
             LEFT JOIN companies c ON s.company_id = c.id
             WHERE s.company_id = ?
             ORDER BY COALESCE(s.updated_at, s.created_at) DESC`,
            [user.company_id]
          );
          scansRows = (r || []).map((row) => ({ ...row, started_at: null }));
        }
        const scanByCanon = new Map();
        for (const s of scansRows) {
          const k = canonicalDomainKey(s.target_url);
          if (!k) continue;
          const cur = scanByCanon.get(k);
          scanByCanon.set(k, pickBetterScanForDomain(cur, s));
        }
        rows = [];
        const seenCanon = new Set();
        for (const url of accessibleUrls) {
          const canon = canonicalDomainKey(url);
          if (!canon || seenCanon.has(canon)) continue;
          seenCanon.add(canon);
          const scan = scanByCanon.get(canon);
          if (scan) {
            rows.push(scan);
          } else {
            rows.push({
              id: `no_scan:${canon}`,
              target_url: url,
              status: "no_scan",
              created_at: null,
              updated_at: null,
              avg_score: null,
              company_id: user.company_id,
              company_name: companyName || null,
              gsc_property_url: null,
              error_message: null,
            });
          }
        }
      }
    }

    const seenCanon = new Set();
    const body = [];
    const scanningIds = [];
    for (const row of rows) {
      const canon = canonicalDomainKey(row.target_url);
      const dedupeKey = canon || `__id:${row.id}`;
      if (canon && seenCanon.has(canon)) continue;
      if (canon) seenCanon.add(canon);

      if (row.status === "running" || row.status === "queued") {
        scanningIds.push(row.id);
      }

      body.push({
        id: row.id,
        domain: canon || domainFromTargetUrl(row.target_url) || row.target_url,
        target_url: row.target_url ?? null,
        status: row.status,
        created_at: row.created_at,
        started_at: row.started_at ?? null,
        updated_at: row.updated_at || row.created_at,
        avg_score: row.avg_score,
        company_id: row.company_id ?? null,
        company_name: row.company_name ?? null,
        gsc_property_url: row.gsc_property_url ?? null,
        error_message: row.error_message ?? null,
      });
    }

    let pageCountByScanId = {};
    if (scanningIds.length > 0) {
      const ph = scanningIds.map(() => "?").join(",");
      const [countRows] = await pool.query(
        `SELECT scan_id, COUNT(*) AS cnt FROM scan_pages WHERE scan_id IN (${ph}) GROUP BY scan_id`,
        scanningIds
      );
      for (const r of countRows || []) {
        pageCountByScanId[String(r.scan_id)] = Number(r.cnt) || 0;
      }
    }

    const now = Date.now();
    for (const item of body) {
      if (item.status === "running" || item.status === "queued") {
        item.processed_pages = pageCountByScanId[String(item.id)] ?? 0;
        const startMs = getScanStartTime(item.id)
          ?? (item.started_at ? new Date(item.started_at).getTime() : null)
          ?? (item.updated_at ? new Date(item.updated_at).getTime() : null);
        item.elapsed_minutes = startMs > 0 ? Math.max(0, Math.floor((now - startMs) / 60000)) : 0;

        if (
          item.status === "running" &&
          item.processed_pages > 0 &&
          item.elapsed_minutes >= STUCK_RECOVERY_AFTER_MINUTES
        ) {
          setImmediate(() => recoverStuckScanWithPages(item.id).catch(() => {}));
        }
        if (item.status === "queued" && item.elapsed_minutes >= 2 && item.target_url) {
          setImmediate(() => reEnqueueStuckQueuedScan(item.id, item.target_url).catch(() => {}));
        }
        item.error_message = null;
      }
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
    let status = scan?.status || "unknown";
    const processedPages = count?.cnt ?? 0;

    // リカバリ: タイムアウト超過で running のまま固まった場合のみ（scan_history の有無は再スキャンで誤判定になるため使わない）
    if (status === "running" && processedPages > 0) {
      try {
        const [[scanExtra]] = await pool
          .query(
            `SELECT started_at, updated_at, created_at FROM scans WHERE id = ? LIMIT 1`,
            [scanId]
          )
          .catch(() => [[null]]);
        const refTime =
          scanExtra?.started_at || scanExtra?.updated_at || scanExtra?.created_at;
        if (refTime) {
          const ref = new Date(refTime).getTime();
          if (Date.now() - ref > CRAWL_RUN_TIMEOUT_MS + 10 * 60 * 1000) {
            const [[avgRow]] = await pool.query(
              `SELECT ROUND(AVG(score)) AS avg_score FROM scan_pages WHERE scan_id = ?`,
              [scanId]
            );
            const avg = avgRow?.avg_score ?? null;
            await pool.query(
              `UPDATE scans SET status = 'completed', avg_score = ?, updated_at = NOW() WHERE id = ?`,
              [avg, scanId]
            );
            status = "completed";
          }
        }
      } catch (recErr) {
        console.warn("progress recovery skipped:", recErr?.message || recErr);
      }
    }

    return res.json({
      processed_pages: processedPages,
      total_pages: MAX_PAGES,
      status,
    });
  } catch (e) {
    console.error("progress error:", e);
    return res.status(500).json({ error: "progress error" });
  }
});

// GET /api/scans/:scanId/link-edges — 内部リンクのエッジ一覧（ネットワーク図用）
// server.js で明示的に登録（ルート競合を避ける）
async function handleLinkEdges(req, res) {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const scanId = req.params.scanId || req.params.id;
  if (!(await assertScanAccess(scanId, user))) {
    return res.status(404).json({ error: "not found" });
  }
  try {
    const [rows] = await pool
      .query(`SELECT from_url, to_url FROM scan_links WHERE scan_id = ?`, [scanId])
      .catch(() => [[]]);
    return res.json({
      scan_id: scanId,
      links: (rows || []).map((r) => ({ from: r.from_url, to: r.to_url })),
    });
  } catch (e) {
    console.error("link-edges:", e);
    return res.status(500).json({ error: e.message });
  }
}
router.get("/:scanId/link-edges", (req, res, next) => handleLinkEdges(req, res).catch(next));

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

router.handleLinkEdges = handleLinkEdges;
module.exports = router;
