/**
 * GSC (Google Search Console) API - OAuth2 連携
 * ユーザーごとに Google ログインで取得したトークンを使用
 */
const express = require("express");
const { getUserIdFromRequest } = require("../services/session");
const {
  getAuthenticatedClient,
  getTokensForUser,
  getTokensForScan,
  getTokensForCompany,
  deleteTokensForUser,
  deleteTokensForScan,
  deleteTokensForCompany,
} = require("../services/googleOAuth");
const pool = require("../db");
const { searchconsole } = require("@googleapis/searchconsole");

const router = express.Router();

/* =============================================
 * GSC キャッシュ ヘルパー
 * ============================================= */
const GSC_CACHE_TTL_HOURS = parseInt(process.env.GSC_CACHE_TTL_HOURS || "12", 10);

async function getGscCache(scanId, cacheKey) {
  if (!scanId) return null;
  try {
    const [rows] = await pool.query(
      "SELECT data, fetched_at FROM gsc_cache WHERE scan_id = ? AND cache_key = ? AND expires_at > NOW() LIMIT 1",
      [scanId, cacheKey]
    );
    if (rows.length) {
      return { data: JSON.parse(rows[0].data), fetchedAt: rows[0].fetched_at };
    }
  } catch (e) {
    console.warn("[GSC Cache] read error:", e.message);
  }
  return null;
}

async function setGscCache(scanId, cacheKey, data) {
  if (!scanId) return;
  try {
    await pool.query(
      `INSERT INTO gsc_cache (scan_id, cache_key, data, fetched_at, expires_at)
       VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? HOUR))
       ON DUPLICATE KEY UPDATE
         data = VALUES(data),
         fetched_at = NOW(),
         expires_at = VALUES(expires_at)`,
      [scanId, cacheKey, JSON.stringify(data), GSC_CACHE_TTL_HOURS]
    );
  } catch (e) {
    console.warn("[GSC Cache] write error:", e.message);
  }
}

async function clearGscCache(scanId) {
  if (!scanId) return 0;
  const [result] = await pool.query(
    "DELETE FROM gsc_cache WHERE scan_id = ?",
    [scanId]
  );
  return result.affectedRows || 0;
}


function normalizePropertyUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  if (s.startsWith("sc-domain:")) return s;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      u.hash = "";
      u.search = "";
      let p = u.pathname || "/";
      if (!p.endsWith("/")) p += "/";
      return u.origin + p;
    } catch {
      return null;
    }
  }
  return `sc-domain:${s.replace(/^sc-domain:/, "").split("/")[0].split("?")[0]}`;
}

async function requireAuth(req, res) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) {
    res.status(401).json({ error: "ログインが必要です" });
    return null;
  }
  return userId;
}

/**
 * GET /api/gsc/status - 連携状態
 * scan_id 指定時: そのURL専用の連携状態。未指定時: ユーザー全体（後方互換）
 * company_linked: 会社全体のトークンが存在するかどうかも返す
 */
router.get("/status", async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;

  const scanId = (req.query.scan_id || "").trim() || null;

  // 個人・scan レベルの連携チェック
  const scanTokens = scanId ? await getTokensForScan(scanId, userId) : null;
  const userTokens = await getTokensForUser(userId);
  const individualLinked = !!(scanTokens?.refresh_token || userTokens?.refresh_token);

  // 会社全体の連携チェック
  let companyLinked = false;
  try {
    const [userRows] = await pool.query("SELECT company_id, role FROM users WHERE id = ? LIMIT 1", [userId]);
    const companyId = userRows[0]?.company_id || null;
    const userRole = userRows[0]?.role || "user";
    if (companyId) {
      const companyTokens = await getTokensForCompany(companyId);
      companyLinked = !!(companyTokens?.refresh_token);
    }
    res.json({
      linked: individualLinked || companyLinked,
      individual_linked: individualLinked,
      company_linked: companyLinked,
      can_manage_company: userRole === "admin" || userRole === "master",
    });
  } catch (e) {
    res.json({ linked: individualLinked, individual_linked: individualLinked, company_linked: false });
  }
});

/**
 * GET /api/gsc/sites - ユーザーがアクセス可能な GSC プロパティ一覧
 * scan_id 指定時: そのURLに紐づいたGoogleアカウントのプロパティ。未指定時: ユーザー全体
 */
router.get("/sites", async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;

  const scanId = (req.query.scan_id || "").trim() || null;
  const client = await getAuthenticatedClient(userId, req, scanId);
  if (!client) {
    return res.status(403).json({
      error: scanId
        ? "このURL用にGoogleアカウントが連携されていません。「Google で連携」を実行してください。"
        : "Google アカウントが連携されていません。設定から「Google で連携」を実行してください。",
    });
  }

  try {
    const gsc = searchconsole({ version: "v1", auth: client });
    const { data } = await gsc.sites.list();
    const sites = (data.siteEntry || []).map((s) => ({
      siteUrl: s.siteUrl,
      permissionLevel: s.permissionLevel,
    }));
    res.json({ sites });
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes("401") || msg.includes("invalid_grant")) {
      if (scanId) {
        await deleteTokensForScan(scanId, userId);
      } else {
        await deleteTokensForUser(userId);
      }
      return res.status(403).json({
        error: "Google 連携の有効期限が切れています。再度「Google で連携」を実行してください。",
      });
    }
    console.error("[GSC] sites.list error:", msg);
    res.status(500).json({ error: "GSC プロパティ一覧の取得に失敗しました。" });
  }
});

/**
 * DELETE /api/gsc/disconnect - 連携解除
 * scan_id 指定時: そのURL専用の連携解除。未指定時: ユーザー全体
 */
router.delete("/disconnect", async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;

  const scanId = (req.query.scan_id || req.body?.scan_id || "").trim() || null;
  if (scanId) {
    await deleteTokensForScan(scanId, userId);
  } else {
    await deleteTokensForUser(userId);
  }
  res.json({ success: true });
});

/**
 * POST /api/gsc/performance - 検索パフォーマンスデータ取得
 * noCache: true を body に含めるとキャッシュをスキップしてAPIを直接叩く
 * レスポンスヘッダー X-GSC-Cache: HIT/MISS, X-GSC-Fetched-At: ISO日時
 */
router.post("/performance", async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;

  const propertyUrl = normalizePropertyUrl(req.body?.propertyUrl);
  if (!propertyUrl) {
    return res.status(400).json({
      error: "propertyUrl が必要です（例: sc-domain:example.com または https://example.com/）",
    });
  }

  const scanId = (req.body?.scanId || "").trim() || null;
  const noCache = !!req.body?.noCache;
  const dimensions = Array.isArray(req.body?.dimensions) && req.body.dimensions.length > 0
    ? req.body.dimensions
    : ["page"];

  // キャッシュキー: dimensions でソートして正規化
  const dimKey = dimensions.slice().sort().join(",");
  const cacheKey = `perf:${dimKey}:${propertyUrl}`;

  // キャッシュチェック（noCache=false の場合のみ）
  if (!noCache && scanId) {
    const cached = await getGscCache(scanId, cacheKey);
    if (cached) {
      res.setHeader("X-GSC-Cache", "HIT");
      res.setHeader("X-GSC-Fetched-At", new Date(cached.fetchedAt).toISOString());
      return res.json(cached.data);
    }
  }

  const client = await getAuthenticatedClient(userId, req, scanId);
  if (!client) {
    return res.status(403).json({
      error: scanId
        ? "このURL用にGoogleアカウントが連携されていません。seo.html の設定から「Google で連携」を実行してください。"
        : "Google アカウントが連携されていません。seo.html の設定から「Google で連携」を実行してください。",
    });
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  try {
    const gsc = searchconsole({ version: "v1", auth: client });
    const requestBody = {
      startDate: startStr,
      endDate: endStr,
      dimensions,
      rowLimit: dimensions.includes("date") ? 90 : 500,
      aggregationType: dimensions.includes("date") ? "auto" : "byPage",
    };
    const { data } = await gsc.searchanalytics.query({
      siteUrl: propertyUrl,
      requestBody,
    });

    const rows = data.rows || [];

    // キャッシュに保存
    if (scanId) await setGscCache(scanId, cacheKey, rows);

    res.setHeader("X-GSC-Cache", "MISS");
    res.setHeader("X-GSC-Fetched-At", new Date().toISOString());
    return res.json(rows);
  } catch (err) {
    const msg = err.message || String(err);

    if (msg.includes("401") || msg.includes("invalid_grant")) {
      if (scanId) await deleteTokensForScan(scanId, userId);
      else await deleteTokensForUser(userId);
      return res.status(403).json({
        error: "Google 連携の有効期限が切れています。再度「Google で連携」を実行してください。",
      });
    }
    if (msg.includes("403") || msg.includes("Forbidden")) {
      return res.status(403).json({
        error: "この GSC プロパティへのアクセス権限がありません。",
      });
    }
    if (msg.includes("404") || msg.includes("not found")) {
      return res.status(404).json({
        error: "GSC プロパティが見つかりません。propertyUrl を確認してください。",
      });
    }

    console.error("[GSC] performance error:", msg);
    return res.status(500).json({
      error: "GSC データの取得に失敗しました。",
      detail: process.env.NODE_ENV === "development" ? msg : undefined,
    });
  }
});

/**
 * GET /api/gsc/company-status - 会社全体のGSC連携状態（管理者・メンバー共通）
 */
router.get("/company-status", async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;

  try {
    const [userRows] = await pool.query("SELECT company_id, role FROM users WHERE id = ? LIMIT 1", [userId]);
    const companyId = userRows[0]?.company_id || null;
    const userRole = userRows[0]?.role || "user";

    if (!companyId) {
      return res.json({ linked: false, can_manage: false });
    }

    const tokens = await getTokensForCompany(companyId);
    res.json({
      linked: !!(tokens?.refresh_token),
      can_manage: userRole === "admin" || userRole === "master",
      company_id: companyId,
    });
  } catch (e) {
    console.error("[GSC] company-status error:", e.message);
    res.status(500).json({ error: "会社連携状態の取得に失敗しました" });
  }
});

/**
 * DELETE /api/gsc/company-disconnect - 会社全体のGSC連携解除（管理者のみ）
 */
router.delete("/company-disconnect", async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;

  try {
    const [userRows] = await pool.query("SELECT company_id, role FROM users WHERE id = ? LIMIT 1", [userId]);
    const companyId = userRows[0]?.company_id || null;
    const userRole = userRows[0]?.role || "user";

    if (userRole !== "admin" && userRole !== "master") {
      return res.status(403).json({ error: "管理者権限が必要です" });
    }
    if (!companyId) {
      return res.status(400).json({ error: "会社に所属していません" });
    }

    await deleteTokensForCompany(companyId);
    res.json({ success: true });
  } catch (e) {
    console.error("[GSC] company-disconnect error:", e.message);
    res.status(500).json({ error: "会社連携の解除に失敗しました" });
  }
});

/**
 * 指定ミリ秒待機
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * PageSpeed Insights API で CWV を取得（Lighthouse スコアから判定）
 * URL Inspection API には CWV が含まれないため、別途取得
 */
async function fetchPageSpeedCwv(url) {
  try {
    const encoded = encodeURIComponent(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encoded}&strategy=mobile&category=performance`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const score = data?.lighthouseResult?.categories?.performance?.score;
    if (score == null) return null;
    const num = Math.round(score * 100);
    if (num >= 90) return "GOOD";
    if (num >= 50) return "IMPROVE";
    return "POOR";
  } catch {
    return null;
  }
}

/**
 * POST /api/gsc/technical-inspect - URL Inspection API でテクニカル指標取得
 * モバイル・構造化データ: URL Inspection API
 * CWV: PageSpeed Insights API（URL Inspection に含まれないため）
 * noCache: true を body に含めるとキャッシュをスキップ
 */
router.post("/technical-inspect", async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;

  const propertyUrl = normalizePropertyUrl(req.body?.propertyUrl);
  const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];

  if (!propertyUrl) {
    return res.status(400).json({
      error: "propertyUrl が必要です。",
    });
  }

  if (urls.length === 0) {
    return res.status(400).json({
      error: "urls 配列が必要です（検査対象のURL一覧）。",
    });
  }

  const MAX_URLS = 50;
  const urlsToInspect = urls.slice(0, MAX_URLS);
  const scanId = (req.body?.scanId || "").trim() || null;
  const noCache = !!req.body?.noCache;

  // キャッシュチェック（URLセットが同じ前提で scan_id + property でキャッシュ）
  const cacheKey = `technical:${propertyUrl}`;
  if (!noCache && scanId) {
    const cached = await getGscCache(scanId, cacheKey);
    if (cached) {
      res.setHeader("X-GSC-Cache", "HIT");
      res.setHeader("X-GSC-Fetched-At", new Date(cached.fetchedAt).toISOString());
      return res.json(cached.data);
    }
  }

  const client = await getAuthenticatedClient(userId, req, scanId);
  if (!client) {
    return res.status(403).json({
      error: scanId
        ? "このURL用にGoogleアカウントが連携されていません。seo.html の設定から「Google で連携」を実行してください。"
        : "Google アカウントが連携されていません。seo.html の設定から「Google で連携」を実行してください。",
    });
  }

  const results = [];
  const gsc = searchconsole({ version: "v1", auth: client });

  for (let i = 0; i < urlsToInspect.length; i++) {
    const url = String(urlsToInspect[i] || "").trim();
    if (!url) continue;

    try {
      const { data } = await gsc.urlInspection.index.inspect({
        requestBody: {
          inspectionUrl: url,
          siteUrl: propertyUrl,
        },
      });

      const insp = data?.inspectionResult || {};
      const mobileResult = insp.mobileUsabilityResult;
      const richResult = insp.richResultsResult;

      let mobileStatus = "GOOD";
      if (mobileResult) {
        const verdict = (mobileResult.verdict || "").toUpperCase();
        mobileStatus = verdict === "FAIL" ? "ERROR" : "GOOD";
      }

      const schemas = [];
      const detected = richResult?.detectedItems || [];
      for (const item of detected) {
        const type = item.richResultType || "";
        if (type) schemas.push(type);
      }

      let cwvStatus = "IMPROVE";
      if (req.body?.includeCwv) {
        cwvStatus = await fetchPageSpeedCwv(url) || "IMPROVE";
      }

      const priority = cwvStatus === "POOR" || mobileStatus === "ERROR" ? "HIGH" : cwvStatus === "IMPROVE" ? "MID" : "LOW";

      results.push({
        url,
        cwvStatus,
        mobileStatus,
        schemas,
        priority,
      });
    } catch (err) {
      const msg = err.message || String(err);
      results.push({
        url,
        cwvStatus: "IMPROVE",
        mobileStatus: "GOOD",
        schemas: [],
        priority: "MID",
        _error: msg,
      });
    }

    if (i < urlsToInspect.length - 1) {
      await sleep(50);
    }
  }

  // キャッシュに保存
  if (scanId) await setGscCache(scanId, cacheKey, results);

  res.setHeader("X-GSC-Cache", "MISS");
  res.setHeader("X-GSC-Fetched-At", new Date().toISOString());
  return res.json(results);
});

/**
 * POST /api/gsc/cache/clear - キャッシュ強制クリア（更新ボタン用）
 * body: { scanId }
 */
router.post("/cache/clear", async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;

  const scanId = (req.body?.scanId || "").trim() || null;
  if (!scanId) {
    return res.status(400).json({ error: "scanId が必要です" });
  }

  try {
    const cleared = await clearGscCache(scanId);
    res.json({ success: true, cleared });
  } catch (e) {
    console.error("[GSC Cache] clear error:", e.message);
    res.status(500).json({ error: "キャッシュのクリアに失敗しました" });
  }
});

module.exports = router;
