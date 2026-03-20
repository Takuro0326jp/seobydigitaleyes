/**
 * GSC (Google Search Console) API - OAuth2 連携
 * ユーザーごとに Google ログインで取得したトークンを使用
 */
const express = require("express");
const { getUserIdFromRequest } = require("../services/session");
const { getAuthenticatedClient, getTokensForUser, getTokensForScan, deleteTokensForUser, deleteTokensForScan } = require("../services/googleOAuth");
const { searchconsole } = require("@googleapis/searchconsole");

const router = express.Router();

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
 */
router.get("/status", async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;

  const scanId = (req.query.scan_id || "").trim() || null;
  const tokens = scanId
    ? await getTokensForScan(scanId, userId)
    : await getTokensForUser(userId);
  res.json({ linked: !!(tokens?.refresh_token) });
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
  const dimensions = Array.isArray(req.body?.dimensions) && req.body.dimensions.length > 0
    ? req.body.dimensions
    : ["page"];

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

  return res.json(results);
});

module.exports = router;
