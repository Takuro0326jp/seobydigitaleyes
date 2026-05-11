/**
 * POST /api/scan-start  GET /api/scans/result/:id
 * マルチテナント + URL単位アクセス制御対応
 */
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
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
const { runScanCrawl } = require("../services/scanCrawl");
const { enqueueCrawl, setScanStartTime } = require("../services/crawlQueue");
const { runSecurityCheck } = require("../services/securityCheck");

const router = express.Router();

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

function canonicalDomainKey(targetUrl) {
  let s = String(targetUrl || "").trim();
  if (!s) return "";
  try {
    if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
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

function domainFromTargetUrl(targetUrl) {
  try {
    return new URL(targetUrl).hostname;
  } catch {
    return targetUrl || "";
  }
}

const ISSUE_POINT_MAP = {
  no_title: 10,
  no_h1: 10,
  short_title: 5,
  dup_title: 5,
  fetch_error: 15,
  http: 10,
  orphan: 5,
  noindex: 5,
  deep: 5,
};
const LABEL_POINT_MAP = {
  "タイトル未設定": 10,
  "H1未設定": 10,
  "H1複数": 5,
  "タイトルが短い": 5,
  "タイトルが長い": 3,
  "タイトル重複": 5,
  "meta description未設定": 5,
  "meta descriptionが短い": 3,
  "ページ取得エラー": 15,
  "HTTPエラー": 10,
  "孤立ページ": 5,
  "noindex": 30,
  "階層が深い": 5,
  "階層やや深い": 2,
  "タイトル文字数不足": 15,
  "キーワード不一致": 8,
  "キーワード部分一致": 3,
  "内部リンクなし": 10,
  "内部リンク少ない": 5,
  "内部リンクやや少ない": 2,
  "PageRank低": 10,
  "PageRank中": 5,
  "GSC順位圈外": 10,
  "GSC順位低い": 5,
  "CTRゼロ": 10,
  "CTR低い": 5,
  "構造スコア不足": 10,
  "パフォーマンススコア不足": 10,
  "OnPage未達": 10,
};

function parseIssues(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function reconstructDeductionsFromRow(r, titleCount, issues) {
  const deductions = [];
  const title = (r.title || "").trim();
  const titleLen = title.length;
  const h1Count = r.h1_count ?? 0;
  const internalLinks = r.internal_links ?? 0;
  const depth = r.depth ?? 1;
  const isNoindex = r.is_noindex || issues.some((i) => i.code === "noindex");
  const statusCode = r.status_code ?? 0;

  if (titleLen === 0) deductions.push({ label: "タイトル文字数不足", value: -15, reason: "0文字（タイトルなし）" });
  else if (titleLen < 200) deductions.push({ label: "タイトル文字数不足", value: -10, reason: `${titleLen}文字（200文字未満）` });
  else if (titleLen < 500) deductions.push({ label: "タイトル文字数不足", value: -5, reason: `${titleLen}文字（200〜499文字）` });

  if (h1Count === 0) deductions.push({ label: "H1未設定", value: -10, reason: "H1タグなし" });
  else if (h1Count > 1) deductions.push({ label: "H1複数", value: -5, reason: `${h1Count}個のH1タグ` });

  if (title && title.length >= 60) deductions.push({ label: "タイトルが長い", value: -3, reason: `${title.length}文字（60字以上）` });

  if (internalLinks === 0) deductions.push({ label: "内部リンクなし", value: -10, reason: "0本" });
  else if (internalLinks <= 3) deductions.push({ label: "内部リンク少ない", value: -5, reason: `${internalLinks}本` });
  else if (internalLinks <= 10) deductions.push({ label: "内部リンクやや少ない", value: -2, reason: `${internalLinks}本` });

  if (depth >= 3) deductions.push({ label: "階層が深い", value: -5, reason: `${depth}階層` });
  else if (depth === 2) deductions.push({ label: "階層やや深い", value: -2, reason: "2階層" });

  if (isNoindex) deductions.push({ label: "noindex", value: -30, reason: "noindex設定" });

  if (statusCode >= 400) deductions.push({ label: "HTTPエラー", value: -10, reason: `HTTP ${statusCode}` });
  if (issues.some((i) => i.code === "fetch_error")) deductions.push({ label: "ページ取得エラー", value: -15, reason: "取得に失敗" });

  const t = title.toLowerCase();
  if (t && titleCount[t] > 1) deductions.push({ label: "タイトル重複", value: -5, reason: "他ページと同一タイトル" });

  for (const i of issues) {
    const pt = ISSUE_POINT_MAP[i.code] ?? 0;
    if (pt > 0 && !deductions.some((d) => d.label === (i.label || ""))) {
      deductions.push({ code: i.code, label: i.label, value: -pt, reason: i.label });
    }
  }
  return deductions;
}

function pageIsCritical(p) {
  const st = p.status ?? p.status_code ?? 0;
  const idx = p.index_status;
  const title = (p.title || "").trim();
  const h1 = p.h1_count ?? 0;
  return (
    st >= 400 ||
    idx === "noindex" ||
    !title ||
    h1 === 0 ||
    title.length < 10
  );
}

function buildExecutiveSummary(summary) {
  const { avgScore, pageCount, criticalIssues, lossRate } = summary;
  if (!pageCount)
    return "ページがまだ取得されていません。スキャン完了までお待ちください。";
  let t = `全${pageCount}ページを分析しました。平均SEOスコアは${avgScore ?? "—"}点です。`;
  if (criticalIssues > 0)
    t += ` 重大な改善が必要なページが${criticalIssues}件あります。`;
  else t += " 致命的な問題は検出されていません。";
  if (lossRate > 0)
    t += ` 構造的損失率は約${lossRate}%（深い階層かつ内リンクが少ないページの割合）です。`;
  return t;
}

/** 単発JSONの行上限（ページあたりのJSONが肥大しやすいため控えめ。超えると chunk + /pages） */
const RESULT_PAGES_SINGLE_RESPONSE_CAP = Number(process.env.RESULT_PAGES_SINGLE_RESPONSE_CAP || 40);
/** チャンク1回あたりの最大行（転送途切れ・関数ペイロード上限対策） */
const RESULT_PAGES_CHUNK_SIZE = Math.min(
  300,
  Math.max(25, Number(process.env.RESULT_PAGES_CHUNK_SIZE || 40))
);
/** このバイト未満の JSON は Content-Length 付きで送る（プロキシが chunked を壊す場合の回避） */
const RESULT_SMALL_JSON_BYTES = Number(process.env.RESULT_SMALL_JSON_BYTES || 98304);

function scanResultApiNoCacheHeaders(res) {
  res.setHeader("Cache-Control", "private, no-store");
  // nginx が upstream 応答を過剰バッファして本文が切り詰められる事例への対策（ブラウザ ERR_CONTENT_LENGTH_MISMATCH と整合）
  res.setHeader("X-Accel-Buffering", "no");
}

// #region agent log
const __DBG_SCAN_LOG = path.join(__dirname, "..", "debug-3a8ba6.log");

function dbgScanResultLog(payload) {
  const line =
    JSON.stringify(
      Object.assign(
        {
          sessionId: "3a8ba6",
          timestamp: Date.now(),
        },
        payload
      )
    ) + "\n";
  for (const target of [__DBG_SCAN_LOG, path.join(process.cwd(), "debug-3a8ba6.log")]) {
    try {
      fs.appendFileSync(target, line);
      return;
    } catch (_) {}
  }
}

/** 診断: ペイロード長と finish / 早期 close（プロキシ切り捨て疑い） */
function scanResultSendJson(res, req, branch, payload, statusCode) {
  const code = statusCode == null ? 200 : statusCode;
  const json = JSON.stringify(payload);
  const buf = Buffer.from(json, "utf8");
  const bytes = buf.length;
  dbgScanResultLog({
    hypothesisId: "H6,H7,H9,H10",
    location: "scanResultSendJson:beforeSend",
    message: branch,
    runId: process.env.SEO_DEBUG_RUN_ID || "post-fix",
    data: {
      path: req.originalUrl || req.url,
      method: req.method,
      bytes,
      pageRows: Array.isArray(payload.pages) ? payload.pages.length : -1,
      overview: !!payload.overview,
      chunked: !!(payload.pagination && payload.pagination.chunked),
      sendMode: bytes <= RESULT_SMALL_JSON_BYTES ? "content-length" : "chunked",
    },
  });
  res.status(code);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.on("finish", () => {
    dbgScanResultLog({
      hypothesisId: "H7",
      location: "scanResultSendJson:finish",
      message: branch,
      runId: process.env.SEO_DEBUG_RUN_ID || "post-fix",
      data: { bytes, writableEnded: res.writableEnded },
    });
  });
  res.on("close", () => {
    if (!res.writableEnded) {
      dbgScanResultLog({
        hypothesisId: "H8",
        location: "scanResultSendJson:closeBeforeEnd",
        message: branch,
        runId: process.env.SEO_DEBUG_RUN_ID || "post-fix",
        data: { bytes },
      });
    }
  });
  if (bytes <= RESULT_SMALL_JSON_BYTES) {
    res.removeHeader("Transfer-Encoding");
    return res.send(buf);
  }
  res.setHeader("Transfer-Encoding", "chunked");
  res.removeHeader("Content-Length");
  res.write(buf);
  res.end();
}
// #endregion

async function duplicateTitleLowerSet(scanId) {
  const [rows] = await pool.query(
    `SELECT LOWER(TRIM(title)) AS t FROM scan_pages
     WHERE scan_id = ? AND title IS NOT NULL AND TRIM(title) <> ''
     GROUP BY LOWER(TRIM(title)) HAVING COUNT(*) > 1`,
    [scanId]
  );
  return new Set((rows || []).map((x) => x.t));
}

/** /pages が連打されても毎チャンクで GROUP BY を掛けない（共有RDS負荷・接続競合の緩和） */
const dupTitleSetMemCache = new Map();
const DUP_TITLE_CACHE_TTL_MS = 3 * 60 * 1000;
const DUP_TITLE_CACHE_MAX_KEYS = 100;

async function getDuplicateTitleLowerSetCached(scanId) {
  const now = Date.now();
  const row = dupTitleSetMemCache.get(scanId);
  if (row && row.exp > now) return row.set;

  const set = await duplicateTitleLowerSet(scanId);
  dupTitleSetMemCache.set(scanId, { set, exp: now + DUP_TITLE_CACHE_TTL_MS });

  if (dupTitleSetMemCache.size > DUP_TITLE_CACHE_MAX_KEYS) {
    for (const [k, v] of dupTitleSetMemCache) {
      if (v.exp <= now) dupTitleSetMemCache.delete(k);
    }
    if (dupTitleSetMemCache.size > DUP_TITLE_CACHE_MAX_KEYS) {
      const oldest = [...dupTitleSetMemCache.entries()].sort((a, b) => a[1].exp - b[1].exp);
      const drop = Math.ceil(dupTitleSetMemCache.size / 2);
      for (let i = 0; i < drop && i < oldest.length; i++) {
        dupTitleSetMemCache.delete(oldest[i][0]);
      }
    }
  }
  return set;
}

async function fetchScanHistoryRows(scanId) {
  try {
    const [h] = await pool.query(
      `SELECT id, avg_score, page_count, critical_issues, recorded_at
       FROM scan_history WHERE scan_id = ? ORDER BY recorded_at ASC`,
      [scanId]
    );
    return (h || []).map((row) => ({
      id: row.id,
      avg_score: row.avg_score,
      page_count: row.page_count,
      critical_issues: row.critical_issues,
      created_at: row.recorded_at,
    }));
  } catch {
    return [];
  }
}

async function aggregateSummaryLargeScan(scanId, scanRow) {
  const [[cntRow]] = await pool.query(
    `SELECT COUNT(*) AS n FROM scan_pages WHERE scan_id = ?`,
    [scanId]
  );
  const pageCount = Number(cntRow?.n || 0);

  let avgScore = scanRow.avg_score != null ? Number(scanRow.avg_score) : null;
  if (avgScore == null || Number.isNaN(avgScore)) {
    const [[aRow]] = await pool.query(
      `SELECT ROUND(AVG(score)) AS a FROM scan_pages WHERE scan_id = ?`,
      [scanId]
    );
    avgScore = aRow?.a != null ? Number(aRow.a) : null;
  }

  const [[critRow]] = await pool.query(
    `
    SELECT COUNT(*) AS c FROM scan_pages WHERE scan_id = ?
    AND (
      IFNULL(status_code, 0) >= 400
      OR IFNULL(is_noindex, 0) <> 0
      OR TRIM(IFNULL(title, '')) = ''
      OR IFNULL(h1_count, 0) = 0
      OR (LENGTH(TRIM(IFNULL(title, ''))) BETWEEN 1 AND 9)
      OR (issues LIKE '%noindex%')
    )
    `,
    [scanId]
  );
  const criticalIssues = Number(critRow?.c || 0);

  const [[lossRow]] = await pool.query(
    `
    SELECT
      CASE WHEN COUNT(*) = 0 THEN 0
      ELSE ROUND(100 * SUM(IF(IFNULL(depth, 0) >= 4 AND IFNULL(internal_links, 0) <= 2, 1, 0)) / COUNT(*))
      END AS lr
    FROM scan_pages WHERE scan_id = ?
    `,
    [scanId]
  );
  const lossRate = Number(lossRow?.lr ?? 0);

  const [[ixRow]] = await pool.query(
    `
    SELECT
      SUM(IF(
        IFNULL(is_noindex, 0) = 0
        AND (
          issues IS NULL
          OR (issues NOT LIKE '%noindex%')
        ),
        1,
        0
      )) AS idxable,
      SUM(IF(IFNULL(is_noindex, 0) <> 0 OR (issues LIKE '%noindex%'), 1, 0)) AS noidx,
      SUM(IF(issues LIKE '%orphan%', 1, 0)) AS orphans
    FROM scan_pages WHERE scan_id = ?
    `,
    [scanId]
  );

  const [[dupRow]] = await pool.query(
    `
    SELECT COUNT(*) AS c FROM scan_pages sp
    INNER JOIN (
      SELECT LOWER(TRIM(title)) AS t FROM scan_pages
      WHERE scan_id = ? AND title IS NOT NULL AND TRIM(title) <> ''
      GROUP BY LOWER(TRIM(title)) HAVING COUNT(*) > 1
    ) d ON LOWER(TRIM(sp.title)) = d.t
    WHERE sp.scan_id = ?
    `,
    [scanId, scanId]
  );

  const summary = {
    pageCount,
    avgScore,
    criticalIssues,
    lossRate,
    indexablePages: Number(ixRow?.idxable || 0),
    noindexPages: Number(ixRow?.noidx || 0),
    duplicateTitlePages: Number(dupRow?.c || 0),
    orphanPages: Number(ixRow?.orphans || 0),
    executiveSummary: "",
  };
  summary.executiveSummary = buildExecutiveSummary(summary);
  return summary;
}

async function fetchScanPageRows(scanId, offset, limit) {
  const params = [scanId];
  let paging = "";
  if (limit != null && Number.isFinite(Number(limit))) {
    paging = ` LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset) || 0);
  }

  async function runFullSelect(selectSql, p) {
    const [rows] = await pool.query(
      `${selectSql} ORDER BY depth ASC, id ASC${paging}`,
      p
    );
    return rows;
  }

  const baseSelectWide = `
    SELECT url, depth, score, status_code, internal_links, external_links,
           title, issues, h1_count, word_count, is_noindex, score_breakdown,
           page_rank, inbound_link_count, outbound_link_count, juice_received, juice_sent, is_orphan
    FROM scan_pages WHERE scan_id = ?`;

  try {
    return await runFullSelect(baseSelectWide, params);
  } catch (e) {
    if (e.message && /score_breakdown|page_rank|Unknown column/.test(e.message)) {
      const baseSelectMedium = `
        SELECT url, depth, score, status_code, internal_links, external_links,
               title, issues, h1_count, word_count, is_noindex
        FROM scan_pages WHERE scan_id = ?`;
      try {
        return await runFullSelect(baseSelectMedium, params);
      } catch {
        /* fallthrough */
      }
    }
    const baseSelectThin = `
      SELECT url, depth, score, status_code, internal_links, external_links
      FROM scan_pages WHERE scan_id = ?`;
    const rows = await runFullSelect(baseSelectThin, params);
    return (rows || []).map((r) => ({
      ...r,
      title: null,
      issues: null,
      h1_count: 0,
      word_count: 0,
      is_noindex: 0,
    }));
  }
}

/** dupTitleLowerSet が渡されたときは一覧全体の dedup と整合する重複検出に使う */
function mapScanRowsToPages(pagesRaw, dupTitleLowerSetOptional) {
  const titleCount = dupTitleLowerSetOptional
    ? null
    : (() => {
        const tc = {};
        for (const r of pagesRaw) {
          const t = ((r.title || "") + "").trim().toLowerCase();
          if (t) tc[t] = (tc[t] || 0) + 1;
        }
        return tc;
      })();

  return pagesRaw.map((r) => {
    let issues = parseIssues(r.issues);
    const t = ((r.title || "") + "").trim().toLowerCase();
    const dupTitle =
      dupTitleLowerSetOptional != null ? dupTitleLowerSetOptional.has(t) : Boolean(t && titleCount[t] > 1);

    if (dupTitle && t) {
      if (!issues.some((i) => i.code === "dup_title")) {
        issues = [...issues, { code: "dup_title", label: "タイトル重複" }];
      }
    }
    const noindex = r.is_noindex || issues.some((i) => i.code === "noindex");

    let scoreBreakdown = null;
    try {
      scoreBreakdown =
        typeof r.score_breakdown === "string"
          ? JSON.parse(r.score_breakdown)
          : r.score_breakdown;
    } catch {
      /* ignore */
    }
    const titleStr = r.title || "";
    const wordCountRaw = r.word_count ?? 0;
    const wordCount = wordCountRaw > 0 ? wordCountRaw : titleStr.length || 0;

    let deductions = reconstructDeductionsFromRow(r, titleCount || {}, issues);
    deductions = deductions.map((d) => {
      const v = Number(d.value);
      if (Number.isFinite(v) && v !== 0) return d;
      const pt = ISSUE_POINT_MAP[d.code] ?? LABEL_POINT_MAP[d.label] ?? 0;
      return { ...d, value: -pt, reason: d.reason || d.label };
    });
    const deductionTotal = deductions.reduce((sum, d) => sum + Math.abs(Number(d.value) || 0), 0);
    const scoreFromDeductions = Math.max(0, Math.min(100, Math.round(100 - deductionTotal)));

    return {
      url: r.url,
      title: titleStr,
      title_char_count: titleStr.length,
      score: scoreFromDeductions,
      score_breakdown: scoreBreakdown,
      issues,
      depth: r.depth,
      status: r.status_code,
      index_status: noindex ? "noindex" : "index",
      h1_count: r.h1_count ?? 0,
      word_count: wordCount,
      internal_links: r.internal_links,
      external_links: r.external_links,
      deductions,
      deduction_total: deductionTotal,
      page_rank: r.page_rank != null ? Number(r.page_rank) : null,
      inbound_link_count:
        r.inbound_link_count != null ? Number(r.inbound_link_count) : null,
      outbound_link_count:
        r.outbound_link_count != null ? Number(r.outbound_link_count) : r.internal_links ?? null,
      juice_received: r.juice_received != null ? Number(r.juice_received) : null,
      juice_sent: r.juice_sent != null ? Number(r.juice_sent) : null,
      crawl_depth: r.depth ?? null,
      is_orphan: r.is_orphan ? true : false,
    };
  });
}

function buildSummaryFromPages(mappedPages, scanRow) {
  const n = mappedPages.length;
  const avgScore = n
    ? Math.round(mappedPages.reduce((a, p) => a + (p.score || 0), 0) / n)
    : scanRow.avg_score;

  const criticalIssues = mappedPages.filter(pageIsCritical).length;
  const structuralLoss = mappedPages.filter(
    (p) => (p.depth || 0) >= 4 && (p.internal_links || 0) <= 2
  ).length;
  const lossRate = n ? Math.round((structuralLoss / n) * 100) : 0;

  const summary = {
    pageCount: n,
    avgScore: avgScore ?? null,
    criticalIssues,
    lossRate,
    indexablePages: mappedPages.filter((p) => p.index_status === "index").length,
    noindexPages: mappedPages.filter((p) => p.index_status === "noindex").length,
    duplicateTitlePages: mappedPages.filter((p) =>
      p.issues.some((i) => i.code === "dup_title")
    ).length,
    orphanPages: mappedPages.filter((p) =>
      p.issues.some((i) => i.code === "orphan")
    ).length,
    executiveSummary: "",
  };
  summary.executiveSummary = buildExecutiveSummary(summary);
  return summary;
}

async function handleStart(req, res) {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!canWrite(user)) {
    return res.status(403).json({ error: "魧覧権限のみです。スキャン作成は管理者に依頼してください。" });
  }

  const target_url = (
    req.body?.url ||
    req.body?.target_url ||
    ""
  ).trim();
  if (!isValidUrl(target_url)) {
    return res.status(400).json({ error: "invalid url" });
  }

  const normalized = normalizeUrl(target_url);

  if (!isAdmin(user)) {
    if (user.company_id == null) {
      return res.status(403).json({ error: "企業に所属していません。管理者に連絡してください。" });
    }
    const hasAccess = await canAccessUrl(user.id, user.company_id, user.role, normalized);
    if (!hasAccess) {
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
        await pool.query(
          `INSERT INTO scans (id, user_id, company_id, target_url, status, created_at, started_at)
           VALUES (?, ?, ?, ?, 'queued', NOW(), NOW())`,
          [scanId, user.id, user.company_id, normalized]
        );
      }
    }

    try {
      await pool.query(`INSERT INTO scan_queue (scan_id) VALUES (?)`, [scanId]);
    } catch {
      /* scan_queue なし */
    }

    setScanStartTime(scanId);
    enqueueCrawl(() => runScanCrawl(scanId, normalized));

    return res.status(202).json({
      scanId,
      status: "queued",
    });
  } catch (e) {
    console.error("scan/start error:", e);
    return res.status(500).json({ error: "start failed" });
  }
}

router.post("/start", handleStart);

async function handleSecurityCheck(req, res) {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const scanId = req.params.id;
  const canAccess = await canAccessScan(user.id, user.company_id, user.role, scanId);
  if (!canAccess) {
    return res.status(404).json({ error: "not found" });
  }

  const [scans] = await pool.query(
    `SELECT id, target_url FROM scans WHERE id = ? LIMIT 1`,
    [scanId]
  );

  if (!scans.length) {
    return res.status(404).json({ error: "not found" });
  }

  const targetUrl = scans[0].target_url;
  try {
    const checks = await runSecurityCheck(targetUrl);
    return res.json({ checks });
  } catch (e) {
    console.error("[security-check]", e);
    return res.status(500).json({ error: "セキュリティチェックの実行に失敗しました。" });
  }
}

async function handleResult(req, res) {
  scanResultApiNoCacheHeaders(res);
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const scanId = req.params.id;
  const canAccess = await canAccessScan(user.id, user.company_id, user.role, scanId);
  if (!canAccess) {
    return res.status(404).json({ error: "not found" });
  }

  const [scans] = await pool.query(
    `SELECT id, target_url, status, avg_score, created_at, updated_at, gsc_property_url
     FROM scans WHERE id = ? LIMIT 1`,
    [scanId]
  );

  if (!scans.length) {
    return res.status(404).json({ error: "not found" });
  }

  const scanRow = scans[0];

  const scanPayload = {
    id: scanRow.id,
    domain:
      canonicalDomainKey(scanRow.target_url) || domainFromTargetUrl(scanRow.target_url),
    status: scanRow.status,
    gsc_property_url: scanRow.gsc_property_url ?? null,
    target_url: scanRow.target_url,
    created_at: scanRow.created_at,
    updated_at: scanRow.updated_at,
  };

  if (req.query.overview === "1") {
    const [[cntRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM scan_pages WHERE scan_id = ?`,
      [scanId]
    );
    const pageTotal = Number(cntRow?.cnt || 0);
    const history = await fetchScanHistoryRows(scanId);
    const executiveSummary =
      scanRow.status === "queued"
        ? "キュー待ちです。"
        : pageTotal === 0
          ? "まだページが取得されていません。"
          : `クロール処理中です（取得済み ${pageTotal} ページ）。`;

    return scanResultSendJson(res, req, "overview", {
      scan: scanPayload,
      overview: true,
      pageTotal,
      pages: [],
      summary: {
        pageCount: pageTotal,
        avgScore: scanRow.avg_score != null ? Number(scanRow.avg_score) : null,
        criticalIssues: 0,
        lossRate: 0,
        indexablePages: 0,
        noindexPages: 0,
        duplicateTitlePages: 0,
        orphanPages: 0,
        executiveSummary,
      },
      history,
    });
  }

  const [[totalRow]] = await pool.query(
    `SELECT COUNT(*) AS c FROM scan_pages WHERE scan_id = ?`,
    [scanId]
  );
  const totalPages = Number(totalRow?.c || 0);

  const history = await fetchScanHistoryRows(scanId);

  if (totalPages <= RESULT_PAGES_SINGLE_RESPONSE_CAP) {
    const pagesRaw = await fetchScanPageRows(scanId, 0, null);
    const pages = mapScanRowsToPages(pagesRaw, null);
    const summary = buildSummaryFromPages(pages, scanRow);
    return scanResultSendJson(res, req, "single", {
      scan: scanPayload,
      pages,
      summary,
      history,
    });
  }

  const summary = await aggregateSummaryLargeScan(scanId, scanRow);
  // 初回は pages を載せない（JSON 肥大でプロキシ切り捨て→ERR_CONTENT_LENGTH_MISMATCH となりやすい）。以降は /pages のみ。
  return scanResultSendJson(res, req, "chunkedHead", {
    scan: scanPayload,
    pages: [],
    summary,
    history,
    pagination: {
      chunked: true,
      total: totalPages,
      pageSize: RESULT_PAGES_CHUNK_SIZE,
    },
  });
}

async function handleResultPages(req, res) {
  scanResultApiNoCacheHeaders(res);
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const scanId = req.params.id;
  const canAccess = await canAccessScan(user.id, user.company_id, user.role, scanId);
  if (!canAccess) {
    return res.status(404).json({ error: "not found" });
  }

  const [scans] = await pool.query(`SELECT id FROM scans WHERE id = ? LIMIT 1`, [scanId]);
  if (!scans.length) {
    return res.status(404).json({ error: "not found" });
  }

  let offset = parseInt(String(req.query.offset || "0"), 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  let limit = parseInt(String(req.query.limit || RESULT_PAGES_CHUNK_SIZE), 10);
  if (!Number.isFinite(limit) || limit < 1) limit = RESULT_PAGES_CHUNK_SIZE;
  limit = Math.min(limit, RESULT_PAGES_CHUNK_SIZE);

  const dupSet = await getDuplicateTitleLowerSetCached(scanId);
  const pagesRaw = await fetchScanPageRows(scanId, offset, limit);
  const pages = mapScanRowsToPages(pagesRaw, dupSet);

  return scanResultSendJson(res, req, "chunkPage", {
    pages,
    pagination: {
      offset,
      limit,
      nextOffset: offset + pages.length,
    },
  });
}

router.get("/result/:id", handleResult);

async function handleTrends(req, res) {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const urlParam = (req.query.url || "").trim();
  if (!urlParam) {
    return res.status(400).json({ error: "url required" });
  }

  const key = canonicalDomainKey(urlParam);
  if (!key) {
    return res.json([]);
  }

  const baseSelect = `s.id, s.target_url, s.avg_score, s.created_at,
    (SELECT COUNT(*) FROM scan_pages sp WHERE sp.scan_id = s.id) AS page_count`;
  const withCritical = `, (SELECT sh.critical_issues FROM scan_history sh WHERE sh.scan_id = s.id ORDER BY sh.recorded_at DESC LIMIT 1) AS critical_issues`;

  try {
    let scans;
    const runQuery = async (sql, params = []) => {
      const [rows] = await pool.query(sql, params);
      return rows;
    };

    if (isAdmin(user)) {
      let rows;
      try {
        rows = await runQuery(
          `SELECT ${baseSelect} ${withCritical}
           FROM scans s
           WHERE s.status IN ('completed', 'failed')
           ORDER BY s.created_at DESC LIMIT 200`
        );
      } catch {
        rows = await runQuery(
          `SELECT ${baseSelect}, 0 AS critical_issues
           FROM scans s
           WHERE s.status IN ('completed', 'failed')
           ORDER BY s.created_at DESC LIMIT 200`
        );
      }
      scans = rows
        .filter((r) => canonicalDomainKey(r.target_url) === key)
        .reverse();
    } else {
      if (user.company_id == null) return res.json([]);
      const { getAccessibleUrls } = require("../services/userUrlAccess");
      const urls = await getAccessibleUrls(user.id, user.company_id);
      const allowedCanons = new Set(urls.map((u) => canonicalDomainKey(u)));
      if (!allowedCanons.has(key)) return res.json([]);
      let rows;
      try {
        rows = await runQuery(
          `SELECT ${baseSelect} ${withCritical}
           FROM scans s
           WHERE s.company_id = ? AND s.status IN ('completed', 'failed')
           ORDER BY s.created_at ASC`,
          [user.company_id]
        );
      } catch {
        rows = await runQuery(
          `SELECT ${baseSelect}, 0 AS critical_issues
           FROM scans s
           WHERE s.company_id = ? AND s.status IN ('completed', 'failed')
           ORDER BY s.created_at ASC`,
          [user.company_id]
        );
      }
      scans = rows.filter((r) => canonicalDomainKey(r.target_url) === key);
    }

    scans.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const trends = scans.map((r) => {
      const d = new Date(r.created_at);
      const dateStr =
        d.getFullYear() +
        "-" +
        String(d.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(d.getDate()).padStart(2, "0");
      return {
        date: dateStr,
        score: r.avg_score ?? 0,
        pages: Number(r.page_count) || 0,
        issues: Number(r.critical_issues) ?? 0,
      };
    });

    return res.json(trends);
  } catch (e) {
    console.error("[trends]", e.message);
    console.error("[trends] stack:", e.stack);
    return res.status(500).json({ error: "Internal error" });
  }
}

router.get("/trends", handleTrends);

module.exports = router;
module.exports.handleStart = handleStart;
module.exports.handleResult = handleResult;
module.exports.handleResultPages = handleResultPages;
module.exports.handleTrends = handleTrends;
module.exports.handleSecurityCheck = handleSecurityCheck;
