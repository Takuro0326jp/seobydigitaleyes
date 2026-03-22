/**
 * 非同期クロール（queued → running → completed）
 * scan_pages に title / issues / h1_count / word_count を保存
 */
const cheerio = require("cheerio");
const pool = require("../db");
const { clearScanStartTime } = require("./crawlQueue");
const { calculateScore } = require("./scoreCalculator");

const MAX_PAGES = Number(
  process.env.MAX_CRAWL_PAGES ||
  (process.env.NODE_ENV === "production" ? 5000 : 1000)
);
const CONCURRENCY = 5; // 並列取得数
const INCREMENTAL_SAVE_INTERVAL = 50; // 増分保存の間隔（この件数ごとに scan_pages へ INSERT）
const FETCH_TIMEOUT_MS = Number(process.env.CRAWL_FETCH_TIMEOUT_MS || 30000); // 1URLあたりのタイムアウト（デフォルト30秒）
const RUN_TIMEOUT_MS = Number(process.env.CRAWL_RUN_TIMEOUT_MS || 900000); // 全体タイムアウト（デフォルト15分・500ページ規模まで対応）

// ボットブロック対策: ブラウザ風UA（SEOScanBotだと403を返すサイトあり）
const CRAWL_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function normalizeUrl(raw) {
  const u = new URL(raw);
  u.hash = "";
  if (u.pathname !== "/" && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }
  return u.toString();
}

function canonicalHost(hostname) {
  if (!hostname || typeof hostname !== "string") return "";
  const h = hostname.toLowerCase().trim();
  return h.startsWith("www.") ? h.slice(4) : h;
}

function sameHost(base, candidate) {
  try {
    const b = new URL(base);
    const c = new URL(candidate, base);
    return canonicalHost(b.hostname) === canonicalHost(c.hostname);
  } catch {
    return false;
  }
}

/** ページネーションURLの次ページを生成（?page=2 → ?page=3）。最大50ページまで */
function getNextPaginationUrl(url, maxPage = 50) {
  try {
    const u = new URL(url);
    const keys = ["page", "p", "pg", "paged"];
    for (const key of keys) {
      const val = u.searchParams.get(key);
      if (val != null) {
        const num = parseInt(val, 10);
        if (!Number.isNaN(num) && num >= 1 && num < maxPage) {
          u.searchParams.set(key, String(num + 1));
          return normalizeUrl(u.toString());
        }
        break;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function fetchFromUrl(url, options = {}) {
  const timeout = options.timeout ?? 15000;
  try {
    if (typeof AbortController !== "undefined") {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": CRAWL_USER_AGENT },
          signal: ctrl.signal,
        });
        clearTimeout(t);
        return res;
      } catch {
        clearTimeout(t);
        return null;
      }
    }
    const res = await fetch(url, {
      headers: { "User-Agent": CRAWL_USER_AGENT },
    });
    return res;
  } catch {
    return null;
  }
}

async function fetchSitemapUrls(baseUrl) {
  const pageUrls = [];
  const seen = new Set();
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return pageUrls;
  }
  const origins = [base.origin];
  if (base.hostname.startsWith("www.")) {
    origins.push(base.protocol + "//" + base.hostname.slice(4));
  } else {
    origins.push(base.protocol + "//www." + base.hostname);
  }
  const candidates = [];
  for (const o of origins) {
    candidates.push(`${o}/sitemap.xml`, `${o}/sitemap_index.xml`, `${o}/sitemap-index.xml`, `${o}/sitemap/index.xml`, `${o}/wp-sitemap.xml`);
  }
  const toFetch = [...candidates];
  try {
    const robotsRes = await fetchFromUrl(`${base.origin}/robots.txt`);
    if (robotsRes?.ok) {
      try {
        const txt = await robotsRes.text();
        for (const m of txt.matchAll(/Sitemap:\s*(\S+)/gi)) {
          const u = (m[1] || "").trim();
          if (u && sameHost(baseUrl, u)) toFetch.push(u);
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  const maxSitemaps = 100;
  try {
    while (toFetch.length > 0 && seen.size < maxSitemaps) {
      const sitemapUrl = toFetch.shift();
      const normUrl = normalizeUrl(sitemapUrl);
      if (seen.has(normUrl)) continue;
      seen.add(normUrl);

      const res = await fetchFromUrl(sitemapUrl);
      if (!res || !res.ok) continue;
      let xml;
      try {
        xml = await res.text();
      } catch {
        continue;
      }
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const looksLikeXml = /<\?xml|<urlset|<sitemapindex|<sitemap\s/i.test(xml);
      if (!ct.includes("xml") && !looksLikeXml) continue;

      const isIndex = /<sitemapindex/i.test(xml);
      const locMatches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)];
      for (const m of locMatches) {
        const u = (m[1] || "").trim();
        if (!u || !sameHost(baseUrl, u)) continue;
        const norm = normalizeUrl(u);
        if (isIndex) {
          if (!seen.has(norm)) {
            seen.add(norm);
            toFetch.push(u);
          }
        } else {
          pageUrls.push(norm);
        }
      }
    }
  } catch {
    /* ignore */
  }
  return pageUrls;
}

function detectNoindex($) {
  const r =
    ($('meta[name="robots"]').attr("content") || "") +
    ($('meta[name="googlebot"]').attr("content") || "");
  return /noindex/i.test(r);
}

function countCriticalRow(p) {
  const st = p.status_code || 0;
  const noindex = p.is_noindex;
  const title = (p.title || "").trim();
  const h1c = p.h1_count || 0;
  return (
    st >= 400 ||
    noindex ||
    !title ||
    h1c === 0 ||
    title.length < 10
  );
}

/**
 * ① OnPage 減点（文字数=title文字数、H1、title、meta description、キーワード一致）
 * score = 100 - 合計減点
 */
function calcOnPageDeductions(title, titleCharCount, h1Count, h1Text, metaDesc, bodyText, url) {
  const deductions = [];

  // 文字数（title文字数）: 0=-15, 1-199=-10, 200-499=-5, 500+=0（仕様表準拠）
  const len = titleCharCount ?? (title || "").length;
  if (len === 0) deductions.push({ label: "タイトル文字数不足", value: -15, reason: "0文字（タイトルなし）" });
  else if (len < 200) deductions.push({ label: "タイトル文字数不足", value: -10, reason: `${len}文字（1〜199文字）` });
  else if (len < 500) deductions.push({ label: "タイトル文字数不足", value: -5, reason: `${len}文字（200〜499文字）` });

  // H1: なし=-10, 複数=-5, 1つ=0
  if (h1Count === 0) deductions.push({ label: "H1未設定", value: -10, reason: "H1タグなし" });
  else if (h1Count > 1) deductions.push({ label: "H1複数", value: -5, reason: `${h1Count}個のH1タグ` });

  // title: なしは文字数0でカバー, 重複=-5(別途), 長すぎ=-3, 適正=0
  if (title && title.length >= 60) deductions.push({ label: "タイトルが長い", value: -3, reason: `${title.length}文字（60字以上）` });

  // meta description: なし=-5, 短すぎ(50未満)=-3, 適正=0
  const descLen = (metaDesc || "").length;
  if (descLen === 0) deductions.push({ label: "meta description未設定", value: -5, reason: "meta descriptionなし" });
  else if (descLen < 50) deductions.push({ label: "meta descriptionが短い", value: -3, reason: `${descLen}文字（50文字未満）` });

  // キーワード一致: 完全=0, 部分=-3, 未一致=-8
  let keywordStatus = "未一致";
  try {
    const pathSegments = new URL(url).pathname.split("/").filter(Boolean);
    const combined = ((title || "") + " " + (h1Text || "") + " " + (bodyText || "")).toLowerCase();
    let matchCount = 0;
    for (const seg of pathSegments) {
      if (seg.length >= 2 && combined.includes(seg.toLowerCase())) matchCount++;
    }
    if (pathSegments.length === 0 && title && h1Text) keywordStatus = "完全一致";
    else if (matchCount === pathSegments.length && pathSegments.length > 0) keywordStatus = "完全一致";
    else if (matchCount > 0) keywordStatus = "部分一致";
  } catch {
    /* ignore */
  }
  if (keywordStatus === "未一致") deductions.push({ label: "キーワード不一致", value: -8, reason: "URLパスがtitle/h1/本文に含まれない" });
  else if (keywordStatus === "部分一致") deductions.push({ label: "キーワード部分一致", value: -3, reason: "URLパスが一部のみ一致" });

  return deductions;
}

async function fetchAndParse(url, depth) {
  const normalized = normalizeUrl(url);
  let statusCode = null;
  let internalLinks = 0;
  let externalLinks = 0;
  let title = "";
  let h1Count = 0;
  let h1Text = "";
  let wordCount = 0;
  let titleCharCount = 0;
  let metaDescription = "";
  let bodyText = "";
  let noindex = false;
  const issues = [];
  let newLinks = [];
  let onPageDeductions = [];

  try {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
    const res = await fetch(normalized, {
      redirect: "follow",
      headers: { "User-Agent": CRAWL_USER_AGENT },
      signal: ctrl?.signal,
    });
    if (timeoutId) clearTimeout(timeoutId);
    statusCode = res.status;
    const ct = res.headers.get("content-type") || "";
    const body = await res.text();
    if (res.ok && (ct.includes("xml") || normalized.endsWith(".xml"))) {
      const locMatches = body.matchAll(/<loc>([^<]+)<\/loc>/gi);
      for (const m of locMatches) {
        const u = (m[1] || "").trim();
        if (u && sameHost(normalized, u)) {
          const absNorm = normalizeUrl(u);
          newLinks.push(absNorm);
        }
      }
      internalLinks = newLinks.length;
    }
    if (res.ok && ct.includes("text/html")) {
      const html = body;
      const $ = cheerio.load(html);
      title = ($("title").text() || "").trim();
      titleCharCount = title.length;
      h1Count = $("h1").length;
      h1Text = ($("h1").first().text() || "").trim();
      metaDescription = ($('meta[name="description"]').attr("content") || "").trim();
      bodyText = ($("body").text() || "").replace(/\s+/g, " ").trim();
      wordCount = bodyText.length ? bodyText.split(/\s+/).length : 0;
      noindex = detectNoindex($);

      if (!title) issues.push({ code: "no_title", label: "タイトル未設定" });
      if (h1Count === 0) issues.push({ code: "no_h1", label: "H1未設定" });
      if (title && title.length < 10) issues.push({ code: "short_title", label: "タイトルが短い" });
      if (depth > 4) issues.push({ code: "deep", label: "階層が深い" });
      if (noindex) issues.push({ code: "noindex", label: "noindex" });

      onPageDeductions = calcOnPageDeductions(title, titleCharCount, h1Count, h1Text, metaDescription, bodyText, normalized);

      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        try {
          const absNorm = normalizeUrl(new URL(href, normalized).toString());
          if (sameHost(normalized, absNorm)) {
            internalLinks++;
            newLinks.push(absNorm);
          } else {
            externalLinks++;
          }
        } catch {
          /* ignore */
        }
      });

      if (depth >= 2 && internalLinks === 0) {
        issues.push({ code: "orphan", label: "孤立ページ" });
      }
    }
  } catch {
    statusCode = statusCode ?? 0;
    issues.push({ code: "fetch_error", label: "取得エラー" });
  }

  if (statusCode >= 400) {
    if (!issues.some((i) => i.code === "http"))
      issues.push({ code: "http", label: `HTTP ${statusCode}` });
  }

  return {
    url: normalized,
    depth,
    onPageDeductions: onPageDeductions || [],
    status_code: statusCode,
    internal_links: internalLinks,
    external_links: externalLinks,
    title: title.slice(0, 512),
    h1_count: h1Count,
    word_count: wordCount,
    title_char_count: titleCharCount,
    is_noindex: noindex ? 1 : 0,
    issues,
    newLinks,
  };
}

/**
 * 内部リンク構造から PageRank を計算（生スコア、合計≒1）
 */
function computePageRank(urls, edges) {
  const urlToIdx = new Map();
  urls.forEach((u, i) => urlToIdx.set(u, i));
  const n = urls.length;
  if (n === 0) return new Map();

  const linkGraph = urls.map(() => []);
  const outDegree = urls.map(() => 1);
  for (const { from: fromUrl, to: toUrl } of edges) {
    const fromIdx = urlToIdx.get(fromUrl);
    const toIdx = urlToIdx.get(toUrl);
    if (fromIdx != null && toIdx != null && fromIdx !== toIdx) {
      if (!linkGraph[fromIdx].includes(toIdx)) linkGraph[fromIdx].push(toIdx);
    }
  }
  for (let i = 0; i < n; i++) {
    outDegree[i] = Math.max(linkGraph[i].length, 1);
  }

  let pr = urls.map(() => 1 / n);
  const damping = 0.85;
  for (let iter = 0; iter < 100; iter++) {
    const next = urls.map(() => (1 - damping) / n);
    for (let i = 0; i < n; i++) {
      for (const j of linkGraph[i]) next[j] += (damping * pr[i]) / outDegree[i];
    }
    pr = next;
  }

  const prMap = new Map();
  urls.forEach((u, i) => prMap.set(u, pr[i]));
  return prMap;
}

/**
 * Performance スコア（30点）: GSC データがある場合
 * CTRが高い→加点、順位低く表示回数多い→改善対象として加点
 */
function calcPerformanceScore(gscRow) {
  if (!gscRow) return 0;
  const ctr = gscRow.ctr || 0;
  const impressions = gscRow.impressions || 0;
  const position = parseFloat(gscRow.position || 0) || 0;

  let s = 0;
  if (ctr >= 0.05) s += 15;
  else if (ctr >= 0.03) s += 10;
  else if (ctr >= 0.02) s += 5;
  if (position > 10 && impressions > 1000) s += 15; // 改善対象
  else if (position > 5 && impressions > 500) s += 10;
  return Math.min(30, s);
}

function runWithTimeout(promise, ms, scanId) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`診断がタイムアウトしました（${Math.round(ms / 1000)}秒）`)), ms)
    ),
  ]);
}

/** クロール中に buffer の一部を scan_pages へ増分保存（プレースホルダースコア。完了時に UPDATE） */
async function insertPagesIncremental(scanId, pages) {
  if (!pages || pages.length === 0) return;
  const PLACEHOLDER_SCORE = 50;
  for (const p of pages) {
    const wordCount = p.word_count ?? 0;
    try {
      await pool.query(
        `INSERT INTO scan_pages
         (scan_id, url, depth, score, status_code, internal_links, external_links,
          title, issues, h1_count, word_count, is_noindex, score_breakdown)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          scanId,
          p.url,
          p.depth,
          PLACEHOLDER_SCORE,
          p.status_code,
          p.internal_links,
          p.external_links,
          p.title,
          JSON.stringify(p.issues),
          p.h1_count,
          wordCount,
          p.is_noindex,
          null,
        ]
      );
    } catch (e) {
      if (e?.message && /score_breakdown|Unknown column/.test(e.message)) {
        await pool.query(
          `INSERT INTO scan_pages
           (scan_id, url, depth, score, status_code, internal_links, external_links,
            title, issues, h1_count, word_count, is_noindex)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            scanId,
            p.url,
            p.depth,
            PLACEHOLDER_SCORE,
            p.status_code,
            p.internal_links,
            p.external_links,
            p.title,
            JSON.stringify(p.issues),
            p.h1_count,
            wordCount,
            p.is_noindex,
          ]
        ).catch((err) => console.warn("[scanCrawl] incremental insert err:", err?.message));
      } else {
        console.warn("[scanCrawl] incremental insert err:", e?.message);
      }
    }
  }
}

async function runScanCrawl(scanId, startUrl) {
  const normalizedStart = normalizeUrl(startUrl);

  // 二重実行防止: status が queued/failed のときのみ running に更新（completed は再実行時のみ）
  const [updateResult] = await pool.query(
    `UPDATE scans SET status = 'running' WHERE id = ? AND status IN ('queued', 'failed')`,
    [scanId]
  );
  if (updateResult.affectedRows === 0) {
    return; // 既に別プロセスで実行中、または存在しない
  }

  await pool.query(`DELETE FROM scan_pages WHERE scan_id = ?`, [scanId]);
  await pool.query(`DELETE FROM scan_links WHERE scan_id = ?`, [scanId]).catch(() => {});

  const visited = new Set();
  const linkEdges = [];
  const queue = [{ url: normalizedStart, depth: 1 }];

  let sitemapUrls = [];
  try {
    console.log("[scanCrawl] fetchSitemapUrls start:", scanId);
    sitemapUrls = await fetchSitemapUrls(normalizedStart);
    console.log("[scanCrawl] fetchSitemapUrls done:", scanId, sitemapUrls.length);
  } catch (sitemapErr) {
    console.warn("[scanCrawl] fetchSitemapUrls error:", sitemapErr?.message || sitemapErr);
  }
  for (const u of sitemapUrls) {
    const norm = normalizeUrl(u);
    if (!visited.has(norm) && queue.length < MAX_PAGES) {
      queue.push({ url: norm, depth: 2 });
    }
    const nextPage = getNextPaginationUrl(norm);
    if (nextPage && !visited.has(nextPage) && queue.length < MAX_PAGES) {
      queue.push({ url: nextPage, depth: 2 });
    }
  }
  const nextStart = getNextPaginationUrl(normalizedStart);
  if (nextStart && !visited.has(nextStart) && queue.length < MAX_PAGES) {
    queue.push({ url: nextStart, depth: 1 });
  }

  const buffer = [];
  let lastInsertedIndex = 0;

  const doCrawl = async () => {
    console.log("[scanCrawl] start:", scanId, normalizedStart);
  try {
    let batchNum = 0;
    while (queue.length && buffer.length < MAX_PAGES) {
      batchNum++;
      if (batchNum <= 3 || batchNum % 10 === 0) {
        console.log("[scanCrawl] batch:", scanId, batchNum, "queue=" + queue.length, "buffer=" + buffer.length);
      }
      const batch = [];
      while (batch.length < CONCURRENCY && queue.length && buffer.length + batch.length < MAX_PAGES) {
        const item = queue.shift();
        const normalized = normalizeUrl(item.url);
        if (visited.has(normalized)) continue;
        visited.add(normalized);
        batch.push({ ...item, normalized });
      }

      if (batch.length === 0) break;

      const fetchWithTimeout = (url, depth) =>
        Promise.race([
          fetchAndParse(url, depth),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("FETCH_TIMEOUT")), FETCH_TIMEOUT_MS)
          ),
        ]).catch((e) => ({
          url: normalizeUrl(url),
          depth,
          onPageDeductions: [],
          status_code: 0,
          internal_links: 0,
          external_links: 0,
          title: "",
          h1_count: 0,
          word_count: 0,
          title_char_count: 0,
          is_noindex: 0,
          issues: [{ code: "fetch_error", label: "取得エラー（タイムアウト）" }],
          newLinks: [],
        }));

      const results = await Promise.all(
        batch.map((b) => fetchWithTimeout(b.url, b.depth))
      );

      for (let i = 0; i < results.length; i++) {
        const p = results[i];
        const batchItem = batch[i];
        buffer.push({
          url: p.url,
          depth: batchItem.depth,
          onPageDeductions: p.onPageDeductions || [],
          status_code: p.status_code,
          internal_links: p.internal_links,
          external_links: p.external_links,
          title: p.title,
          h1_count: p.h1_count,
          word_count: p.word_count,
          title_char_count: p.title_char_count ?? (p.title || "").length,
          is_noindex: p.is_noindex,
          issues: p.issues,
        });

        for (const absNorm of p.newLinks) {
          linkEdges.push({ from: p.url, to: absNorm });
          if (
            !visited.has(absNorm) &&
            buffer.length + queue.length < MAX_PAGES
          ) {
            queue.push({ url: absNorm, depth: batchItem.depth + 1 });
          }
          const nextPage = getNextPaginationUrl(absNorm);
          if (nextPage && !visited.has(nextPage) && buffer.length + queue.length < MAX_PAGES) {
            queue.push({ url: nextPage, depth: batchItem.depth + 1 });
          }
        }
      }

      // 増分保存: INCREMENTAL_SAVE_INTERVAL 件ごとに scan_pages へ INSERT（3秒ポーリングで取得数表示）
      if (buffer.length - lastInsertedIndex >= INCREMENTAL_SAVE_INTERVAL) {
        const slice = buffer.slice(lastInsertedIndex, lastInsertedIndex + INCREMENTAL_SAVE_INTERVAL);
        lastInsertedIndex += slice.length;
        insertPagesIncremental(scanId, slice).catch((e) =>
          console.warn("[scanCrawl] incremental save:", e?.message)
        );
      }
    }

    // 残りを保存
    if (lastInsertedIndex < buffer.length) {
      const remainder = buffer.slice(lastInsertedIndex);
      await insertPagesIncremental(scanId, remainder);
    }

    // 取得ページがなくなった時点で completed にし、ポーリングを停止させる
    // （PageRank・スコア・リンクはこのあとバックグラウンドで計算・更新される）
    try {
      await pool.query(
        `UPDATE scans SET status = 'completed', updated_at = NOW() WHERE id = ?`,
        [scanId]
      );
      console.log("[scanCrawl] status=completed (fetch done):", scanId, buffer.length, "pages");
    } catch (updErr) {
      console.warn("[scanCrawl] early status update failed:", updErr?.message);
    }

    const exitReason = buffer.length >= MAX_PAGES
      ? "MAX_PAGES到達"
      : queue.length === 0
        ? "キュー枯渇（クロール済みページから新リンク発見なし）"
        : "不明";
    console.log("[scanCrawl] while終了:", scanId, "buffer=" + buffer.length, "queue残=" + queue.length, "理由:", exitReason);

    const titleCount = {};
    for (const p of buffer) {
      const t = (p.title || "").trim().toLowerCase();
      if (t) titleCount[t] = (titleCount[t] || 0) + 1;
    }

    // Structure (30点): PageRank を計算してスコア加算
    const urls = buffer.map((p) => p.url);
    const prMap = computePageRank(urls, linkEdges);

    // 被リンク数・発リンク数・ジュース受信/送出を計算
    const urlSet = new Set(urls);
    const outboundCount = new Map();
    const inboundCount = new Map();
    for (const u of urls) {
      outboundCount.set(u, 0);
      inboundCount.set(u, 0);
    }
    for (const { from: fromUrl, to: toUrl } of linkEdges) {
      if (urlSet.has(fromUrl) && urlSet.has(toUrl) && fromUrl !== toUrl) {
        outboundCount.set(fromUrl, (outboundCount.get(fromUrl) ?? 0) + 1);
        inboundCount.set(toUrl, (inboundCount.get(toUrl) ?? 0) + 1);
      }
    }
    const juiceReceived = new Map();
    const juiceSent = new Map();
    for (const u of urls) {
      juiceReceived.set(u, 0);
      juiceSent.set(u, 0);
    }
    const DAMPING = 0.85;
    for (const { from: fromUrl, to: toUrl } of linkEdges) {
      if (fromUrl === toUrl) continue;
      const prFrom = prMap.get(fromUrl) ?? 0;
      const out = Math.max(outboundCount.get(fromUrl) ?? 1, 1);
      const juice = (prFrom * DAMPING) / out;
      juiceReceived.set(toUrl, (juiceReceived.get(toUrl) ?? 0) + juice);
      juiceSent.set(fromUrl, (juiceSent.get(fromUrl) ?? 0) + juice);
    }

    // GSC データはクロール時点では未取得のため Performance=0（将来連携時に calcPerformanceScore で加算）
    const gscByUrl = new Map();

    const sortedPr = [...prMap.values()].sort((a, b) => a - b);
    const p33 = sortedPr[Math.floor(sortedPr.length * 0.33)] ?? 0;
    const p66 = sortedPr[Math.floor(sortedPr.length * 0.66)] ?? 0;

    for (const p of buffer) {
      const deductions = [...(p.onPageDeductions || [])];

      // ② Structure: 内部リンク数
      const internalLinks = p.internal_links ?? 0;
      if (internalLinks === 0) deductions.push({ label: "内部リンクなし", value: -10, reason: "0本" });
      else if (internalLinks <= 3) deductions.push({ label: "内部リンク少ない", value: -5, reason: `${internalLinks}本` });
      else if (internalLinks <= 10) deductions.push({ label: "内部リンクやや少ない", value: -2, reason: `${internalLinks}本` });

      // ② Structure: PageRank（生スコアのため、相対的なパーセンタイルで判定）
      const pagerank = prMap.get(p.url) ?? 0;
      if (pagerank < p33) deductions.push({ label: "PageRank低", value: -10, reason: `PR ${pagerank.toFixed(4)}` });
      else if (pagerank < p66) deductions.push({ label: "PageRank中", value: -5, reason: `PR ${pagerank.toFixed(4)}` });

      // ② Structure: 階層
      const depth = p.depth ?? 1;
      if (depth >= 3) deductions.push({ label: "階層が深い", value: -5, reason: `${depth}階層` });
      else if (depth === 2) deductions.push({ label: "階層やや深い", value: -2, reason: "2階層" });

      // ③ Performance: noindex
      if (p.is_noindex) deductions.push({ label: "noindex", value: -30, reason: "noindex設定" });

      // ③ Performance: GSC（データなければスキップ）
      const gscRow = gscByUrl.get(p.url);
      if (gscRow) {
        const pos = parseFloat(gscRow.position || 999) || 999;
        if (pos > 50) deductions.push({ label: "GSC順位圏外", value: -10, reason: `${pos}位` });
        else if (pos > 10) deductions.push({ label: "GSC順位低い", value: -5, reason: `${pos}位` });
        const ctr = parseFloat(gscRow.ctr || 0) || 0;
        if (ctr === 0) deductions.push({ label: "CTRゼロ", value: -10, reason: "0%" });
        else if (ctr < 0.02) deductions.push({ label: "CTR低い", value: -5, reason: `${(ctr * 100).toFixed(2)}%` });
      }

      // ④ ペナルティ
      if (p.status_code >= 400) {
        deductions.push({ label: "HTTPエラー", value: -10, reason: `HTTP ${p.status_code}` });
      }
      if (p.issues.some((i) => i.code === "fetch_error")) {
        deductions.push({ label: "ページ取得エラー", value: -15, reason: "取得に失敗" });
      }
      const t = (p.title || "").trim().toLowerCase();
      if (t && titleCount[t] > 1) {
        if (!p.issues.some((i) => i.code === "dup_title")) {
          p.issues.push({ code: "dup_title", label: "タイトル重複" });
        }
        deductions.push({ label: "タイトル重複", value: -5, reason: "他ページと同一タイトル" });
      }

      const result = calculateScore({ deductions });
      p.score = result.score;
      p.score_breakdown = {
        deductions,
        totalDeduction: result.totalDeduction,
      };
      p.page_rank = prMap.get(p.url) ?? 0;
      p.inbound_link_count = inboundCount.get(p.url) ?? 0;
      p.outbound_link_count = outboundCount.get(p.url) ?? 0;
      p.juice_received = juiceReceived.get(p.url) ?? 0;
      p.juice_sent = juiceSent.get(p.url) ?? 0;
      p.is_orphan = (p.inbound_link_count === 0) ? 1 : 0;
    }

    console.log("[scanCrawl] DB getConnection:", scanId);
    const conn = await pool.getConnection();
    console.log("[scanCrawl] DB updating scores:", scanId, buffer.length);
    let useScoreBreakdown = true;
    try {
      for (const p of buffer) {
        const breakdown = p.score_breakdown
          ? JSON.stringify(p.score_breakdown)
          : null;
        const pageRank = p.page_rank ?? 0;
        const inboundCnt = p.inbound_link_count ?? 0;
        const outboundCnt = p.outbound_link_count ?? 0;
        const juiceRecv = p.juice_received ?? 0;
        const juiceSnd = p.juice_sent ?? 0;
        const isOrphan = p.is_orphan ? 1 : 0;
        if (useScoreBreakdown) {
          try {
            await conn.query(
              `UPDATE scan_pages SET score = ?, score_breakdown = ?,
               page_rank = ?, inbound_link_count = ?, outbound_link_count = ?,
               juice_received = ?, juice_sent = ?, is_orphan = ?
               WHERE scan_id = ? AND url = ?`,
              [p.score, breakdown, pageRank, inboundCnt, outboundCnt, juiceRecv, juiceSnd, isOrphan, scanId, p.url]
            );
          } catch (updErr) {
            if (updErr?.message && /score_breakdown|page_rank|Unknown column/.test(updErr.message)) {
              useScoreBreakdown = false;
            } else {
              throw updErr;
            }
          }
        }
        if (!useScoreBreakdown) {
          try {
            await conn.query(
              `UPDATE scan_pages SET score = ?, page_rank = ?, inbound_link_count = ?,
               outbound_link_count = ?, juice_received = ?, juice_sent = ?, is_orphan = ?
               WHERE scan_id = ? AND url = ?`,
              [p.score, pageRank, inboundCnt, outboundCnt, juiceRecv, juiceSnd, isOrphan, scanId, p.url]
            );
          } catch (legacyErr) {
            await conn.query(
              `UPDATE scan_pages SET score = ? WHERE scan_id = ? AND url = ?`,
              [p.score, scanId, p.url]
            );
          }
        }
      }
      console.log("[scanCrawl] DB inserting links:", scanId, linkEdges.length);
      for (const { from: fromUrl, to: toUrl } of linkEdges) {
        await conn.query(
          `INSERT INTO scan_links (scan_id, from_url, to_url) VALUES (?, ?, ?)`,
          [scanId, fromUrl, toUrl]
        ).catch(() => {});
      }
    } finally {
      conn.release();
      console.log("[scanCrawl] DB conn released:", scanId);
    }

    const totalScore = buffer.reduce((a, p) => a + p.score, 0);
    const avg = buffer.length ? Math.round(totalScore / buffer.length) : null;
    const critical = buffer.filter(countCriticalRow).length;

    try {
      await pool.query(
        `INSERT INTO scan_history (scan_id, avg_score, page_count, critical_issues)
         VALUES (?,?,?,?)`,
        [scanId, avg, buffer.length, critical]
      );
    } catch {
      /* scan_history 未作成時はスキップ */
    }

    console.log("[scanCrawl] completed:", scanId, buffer.length, "pages");
    try {
      await pool.query(
        `UPDATE scans SET status = 'completed', avg_score = ?, updated_at = NOW() WHERE id = ?`,
        [avg, scanId]
      );
    } catch {
      await pool.query(
        `UPDATE scans SET status = 'completed', avg_score = ? WHERE id = ?`,
        [avg, scanId]
      );
    }
    // 今週やるべきこと アクション生成（非同期・UIをブロックしない）
    pool
      .query("SELECT user_id FROM scans WHERE id = ? LIMIT 1", [scanId])
      .then(([[row]]) => {
        if (row?.user_id) {
          const { generateActionItems } = require("./actionItemGeneration");
          const mockReq = {
            protocol: "https",
            get: (h) =>
              h === "host"
                ? (process.env.APP_URL || "localhost:3000").replace(/^https?:\/\//, "").replace(/\/$/, "")
                : "",
          };
          return generateActionItems(scanId, row.user_id, mockReq);
        }
      })
      .catch((err) => console.warn("[scanCrawl] action item generation:", err?.message));
  } catch (e) {
    console.error("runScanCrawl error:", e);
    const errMsg = (e?.message || String(e)).slice(0, 500);
    try {
      await pool.query(
        `UPDATE scans SET status = 'failed', error_message = ?, updated_at = NOW() WHERE id = ?`,
        [errMsg, scanId]
      );
    } catch (dbErr) {
      try {
        await pool.query(`UPDATE scans SET status = 'failed', updated_at = NOW() WHERE id = ?`, [scanId]);
      } catch {
        await pool.query(`UPDATE scans SET status = 'failed' WHERE id = ?`, [scanId]);
      }
    }
  }
  };

  try {
    await runWithTimeout(doCrawl(), RUN_TIMEOUT_MS, scanId);
  } catch (e) {
    if (e?.message?.includes("タイムアウト")) {
      console.error("[scanCrawl] run timeout:", scanId);
      try {
        await pool.query(
          `UPDATE scans SET status = 'failed', error_message = ?, updated_at = NOW() WHERE id = ?`,
          [e.message, scanId]
        );
      } catch {
        await pool.query(`UPDATE scans SET status = 'failed' WHERE id = ?`, [scanId]);
      }
    } else {
      throw e;
    }
  } finally {
    clearScanStartTime(scanId);
  }
}

module.exports = { runScanCrawl, MAX_PAGES, calculateScore };
