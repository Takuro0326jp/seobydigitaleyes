/**
 * 運用型広告 API
 * GET /api/ads/report, GET /api/ads/status
 * GET /api/ads/google/connect, GET /api/ads/google/callback
 * POST /api/ads/google/disconnect
 */
const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const pool = require("../db");
const { getUserWithContext } = require("../services/accessControl");
const { getUserIdFromRequest } = require("../services/session");
const { fetchAllReports, getConnectionStatus, getDateRangeForMonth, getDateRangeFromDates } = require("../services/ads");
const { fetchMetaInsightsReport } = require("../services/ads/metaAds");
const { fetchGoogleAdsReportWithMeta, validateCustomerAccess } = require("../services/ads/googleAds");
const { fetchYahooAdsReportWithMeta, testYahooAccountService, getCampaignRawDownload, getCreativeReportsDebug, cleanupReportJobs } = require("../services/ads/yahooAds");
const {
  getOAuth2Client,
  getRedirectUri,
  ADS_SCOPE,
  saveTokensForUser,
  deleteTokensForUser,
  updateLoginCustomerId,
  updateGoogleAdsIds,
} = require("../services/googleAdsOAuth");
const {
  listAccounts,
  getSelectedAccount,
  createAccount,
  setSelectedAccount,
  deleteAccount,
} = require("../services/googleAdsAccounts");
const {
  listAccounts: listYahooAccounts,
  getSelectedAccount: getSelectedYahooAccount,
  createAccount: createYahooAccount,
  setSelectedAccount: setSelectedYahooAccount,
  deleteAccount: deleteYahooAccount,
} = require("../services/yahooAdsAccounts");
const { getAuthUrl, exchangeCodeForTokens, getRedirectUri: getYahooRedirectUri } = require("../services/yahooAdsOAuth");
const apiAuthSources = require("../services/apiAuthSources");

/** レポート API のメモリキャッシュ（Meta 等の外部 API 負荷軽減）。TTL 3 時間。 */
const REPORT_CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const reportResponseCache = new Map();

/** Yahoo クリエイティブ AD/Asset レポートのエラーが付いた応答はキャッシュしない（タイムアウトが3時間固定表示されるのを防ぐ） */
function reportHasCreativeFetchError(json) {
  if (!json || typeof json !== "object") return false;
  const d = json._creativeDiagnostic;
  if (d) {
    const ad = d.adError && String(d.adError).trim();
    const ast = d.assetError && String(d.assetError).trim();
    if (ad || ast) return true;
  }
  const h = json._hint != null ? String(json._hint) : "";
  if (h.includes("クリエイティブ (") && /AD:|Asset:/.test(h)) return true;
  if (/顧客集計データ取得|クリエイティブ.*タイムアウト|timeout/i.test(h)) return true;
  return false;
}

/**
 * キャッシュキーは GET /report の param 解決と同じ優先度にする（日付範囲が有効なら month より優先）。
 * @param {string|number} userId
 * @param {string} adAccountId
 * @param {string} month YYYY-MM
 * @param {string} [startDate]
 * @param {string} [endDate]
 */
function buildReportCacheKey(userId, adAccountId, month, startDate, endDate) {
  const acct = String(adAccountId || "_none").replace(/[^a-zA-Z0-9_-]/g, "") || "_none";
  if (startDate && endDate) {
    const dr = getDateRangeFromDates(startDate, endDate);
    if (dr) {
      return `${userId}_${acct}_${dr.startDate}_${dr.endDate}`;
    }
  }
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    return `${userId}_${acct}_${month}`;
  }
  const d = new Date();
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `${userId}_${acct}_${ym}`;
}

function getReportFromCache(cacheKey) {
  const entry = reportResponseCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.ts > REPORT_CACHE_TTL_MS) {
    reportResponseCache.delete(cacheKey);
    return null;
  }
  try {
    const data = JSON.parse(JSON.stringify(entry.data));
    if (reportHasCreativeFetchError(data)) {
      reportResponseCache.delete(cacheKey);
      return null;
    }
    return data;
  } catch {
    const raw = entry.data;
    if (raw && typeof raw === "object" && reportHasCreativeFetchError(raw)) {
      reportResponseCache.delete(cacheKey);
      return null;
    }
    return raw;
  }
}

function setReportCache(cacheKey, data) {
  if (reportHasCreativeFetchError(data)) {
    return;
  }
  reportResponseCache.set(cacheKey, { ts: Date.now(), data });
}

/** 連携・アカウント変更後に古いレポートが TTL まで残らないようメモリキャッシュを捨てる */
function clearReportResponseCache(reason) {
  const n = reportResponseCache.size;
  reportResponseCache.clear();
  console.log("[Ads] reportResponseCache cleared:", reason, "(had", n, "entries)");
}

/** GET /api/ads/test-api - report-debug と同じ認証でAPIを直接叩いてテスト
 * 例: /api/ads/test-api
 * report-debug と完全に同じ credential を使用（getSelectedAccount 経由）
 */
router.get("/test-api", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const developerToken = (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
  const clientId = (process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "").trim();

  const acc = await getSelectedAccount(user.id);
  const refreshToken = acc?.refresh_token || (process.env.GOOGLE_ADS_REFRESH_TOKEN || "").trim();
  const customerIdParam = (acc?.customer_id || req.query.customer_id || "").trim().replace(/-/g, "");
  const loginCid = (acc?.login_customer_id || req.query.mcc || "").trim().replace(/-/g, "") || undefined;

  if (!developerToken || !clientId || !clientSecret || !refreshToken || !customerIdParam) {
    return res.status(400).json({
      error: "設定が不足しています。API設定でアカウントを連携してください。",
      has_token: !!developerToken,
      has_client: !!(clientId && clientSecret),
      has_refresh: !!refreshToken,
      has_customer_id: !!customerIdParam,
      has_login_customer_id: !!loginCid,
      account: acc ? { id: acc.id, name: acc.name, customer_id: acc.customer_id, login_customer_id: acc.login_customer_id } : null,
    });
  }

  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10);
  const endDate = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0, 10);

  const result = {
    customer_id: customerIdParam,
    login_customer_id: loginCid,
    period: { startDate, endDate },
    tests: {},
  };

  try {
    const { GoogleAdsApi } = require("google-ads-api");
    const client = new GoogleAdsApi({
      client_id: clientId,
      client_secret: clientSecret,
      developer_token: developerToken,
    });

    result.tests.list_accessible = { status: "pending" };
    try {
      const accessible = await client.listAccessibleCustomers(refreshToken);
      const names = accessible?.resource_names || (Array.isArray(accessible) ? accessible : []);
      const ids = names.map((n) => String(n).replace(/^customers\//, "").replace(/\/.*$/, "")).filter(Boolean);
      result.tests.list_accessible = {
        status: "ok",
        count: ids.length,
        customer_ids: ids.slice(0, 30),
        has_4211317572: ids.some((id) => String(id) === "4211317572"),
        has_9838710115: ids.some((id) => String(id) === "9838710115"),
      };
    } catch (e) {
      result.tests.list_accessible = { status: "error", message: e.message, errors: e.errors };
    }

    const customerOptions = { customer_id: customerIdParam, refresh_token: refreshToken };
    if (loginCid) customerOptions.login_customer_id = String(loginCid);
    const customer = client.Customer(customerOptions);

    const toArr = (r) => (Array.isArray(r) ? r : r?.results || r?.rows || []);

    result.tests.customer = { status: "pending" };
    try {
      const custResult = await customer.query("SELECT customer.id, customer.manager, customer.descriptive_name FROM customer LIMIT 1");
      let custRows = toArr(custResult);
      if (custRows.length === 0 && custResult && typeof custResult[Symbol.asyncIterator] === "function") {
        custRows = [];
        for await (const row of custResult) custRows.push(row);
      }
      result.tests.customer = { status: "ok", data: custRows[0] };
    } catch (e) {
      result.tests.customer = { status: "error", message: e.message, errors: e.errors };
    }

    result.tests.report = { status: "pending" };
    try {
      const reportResult = await customer.report({
        entity: "campaign",
        attributes: ["campaign.id", "campaign.name"],
        metrics: ["metrics.impressions", "metrics.clicks", "metrics.cost_micros", "metrics.conversions"],
        segments: ["segments.date"],
        from_date: startDate,
        to_date: endDate,
      });
      const rows = toArr(reportResult);
      result.tests.report = { status: "ok", row_count: rows.length, first_row: rows[0] || null };
    } catch (e) {
      result.tests.report = { status: "error", message: e.message, errors: e.errors };
    }

    result.tests.gaql_last30 = { status: "pending" };
    try {
      const gaql = `SELECT campaign.id, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros
        FROM campaign WHERE segments.date DURING LAST_30_DAYS AND campaign.status != 'REMOVED'`;
      const qResult = await customer.query(gaql);
      let rows = toArr(qResult);
      if (rows.length === 0 && qResult && typeof qResult[Symbol.asyncIterator] === "function") {
        rows = [];
        for await (const r of qResult) rows.push(r);
      }
      result.tests.gaql_last30 = { status: "ok", row_count: rows.length, first_row: rows[0] || null };
    } catch (e) {
      result.tests.gaql_last30 = { status: "error", message: e.message, errors: e.errors };
    }

    res.json(result);
  } catch (e) {
    console.error("[ads] test-api error:", e.message);
    res.status(500).json({
      error: e.message,
      customer_id: customerIdParam,
      login_customer_id: loginCid,
    });
  }
});

/** GET /api/ads/report-debug - Google Ads API の生レスポンスを確認（診断用） */
router.get("/report-debug", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "ログインが必要です" });
  }
  const month = (req.query.month || "").trim();
  const startDate = (req.query.startDate || "").trim();
  const endDate = (req.query.endDate || "").trim();
  let range;
  if (startDate && endDate && getDateRangeFromDates(startDate, endDate)) {
    range = getDateRangeFromDates(startDate, endDate);
  } else {
    range = getDateRangeForMonth(month || undefined);
  }
  const queryDesc = `report(campaign, ${range.startDate}..${range.endDate})`;
  try {
    const googleResult = await fetchGoogleAdsReportWithMeta(
      range.startDate,
      range.endDate,
      user.id,
      { debug: true }
    );
    const fromService = googleResult._debug || {};
    const debug = {
      route: "report-debug",
      startDate: range.startDate,
      endDate: range.endDate,
      month: month || null,
      method: "report",
      query_desc: queryDesc,
      rows_count: (googleResult.rows || []).length,
      api_error: fromService.error || null,
      api_stack: fromService.stack || null,
      ...fromService,
    };
    res.json({
      rows: googleResult.rows || [],
      meta: { google_customer_id: googleResult.customerId || null },
      _debug: debug,
    });
  } catch (e) {
    console.error("[ads] report-debug error:", e.message);
    res.status(500).json({
      error: "レポートの取得に失敗しました。",
      _debug: { error: e.message, route: "report-debug" },
    });
  }
});

/** GET /api/ads/yahoo/report-debug - Yahoo Ads API の生レスポンスを確認（診断用） */
router.get("/yahoo/report-debug", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });
  const month = (req.query.month || "").trim();
  const startDate = (req.query.startDate || "").trim();
  const endDate = (req.query.endDate || "").trim();
  let range;
  if (startDate && endDate && getDateRangeFromDates(startDate, endDate)) {
    range = getDateRangeFromDates(startDate, endDate);
  } else {
    range = getDateRangeForMonth(month || undefined);
  }
  try {
    const yahooResult = await fetchYahooAdsReportWithMeta(
      range.startDate,
      range.endDate,
      user.id,
      { debug: true, connectionTest: true }
    );
    res.json({
      rows: yahooResult.rows || [],
      meta: { yahoo_account_id: yahooResult.customerId || null },
      _hint: yahooResult._hint || null,
      _connectionOk: yahooResult._connectionOk || false,
      _debug: yahooResult._debug || null,
    });
  } catch (e) {
    console.error("[ads] yahoo report-debug error:", e.message);
    res.status(500).json({
      error: "Yahoo レポートの取得に失敗しました。",
      _debug: { error: e.message },
    });
  }
});

/** GET /api/ads/yahoo/account-test - AccountService/get で権限診断（MCC切り分け用） */
router.get("/yahoo/account-test", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });
  try {
    const result = await testYahooAccountService(user.id);
    res.json(result);
  } catch (e) {
    console.error("[ads] yahoo account-test error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/ads/report - 媒体別レポート取得（company_id 不要・1アカウント連携前提）
 * Google / Yahoo / Microsoft / Meta を services/ads/index.js の fetchAllReports で一括取得しマージする。
 * Meta: META_ACCESS_TOKEN は .env、広告アカウント ID はクエリ ad_account_id（フロントの API 設定で選択・localStorage から送信）。
 * メモリキャッシュ: キーは userId + ad_account_id + 月(YYYY-MM) または startDate_endDate、TTL 3 時間。force=1 または debug=1 で読み書きとも無視。
 * 個別取得は GET /api/ads/meta/report-debug または GET /api/meta/insights を参照。
 */
router.get("/report", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const month = (req.query.month || "").trim();
  const startDate = (req.query.startDate || "").trim();
  const endDate = (req.query.endDate || "").trim();
  /** Meta 広告アカウント ID（act_…）。DB ではなくクライアント設定から渡す。 */
  const adAccountId = (req.query.ad_account_id || "").trim();
  const debug = /^(1|true|yes)$/i.test((req.query.debug || "").trim());
  const force = /^(1|true|yes)$/i.test((req.query.force || "").trim());

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    const userId = user.id;
    let param;
    if (startDate && endDate) {
      param = getDateRangeFromDates(startDate, endDate);
    }
    if (!param) {
      param = month || undefined;
    }
    const cacheKey = buildReportCacheKey(userId, adAccountId, month, startDate, endDate);
    const skipCache = force || debug;
    if (!skipCache) {
      const cached = getReportFromCache(cacheKey);
      if (cached) {
        res.setHeader("X-Ad-Rows-Count", String((cached.adRows || []).length));
        return res.json(cached);
      }
    }

    const result = await fetchAllReports(param, userId, { debug, force, ad_account_id: adAccountId || undefined });
    const adRows = result.adRows ?? [];
    const json = {
      rows: result.rows ?? [],
      areaRows: result.areaRows ?? [],
      hourRows: result.hourRows ?? [],
      dailyRows: result.dailyRows ?? [],
      keywordRows: result.keywordRows ?? [],
      adRows,
      assetRows: result.assetRows ?? [],
      meta: result.meta ?? {},
    };
    if (result._debug) json._debug = result._debug;
    if (result._hint) json._hint = result._hint;
    if (result._yahooRawSample) json._yahooRawSample = result._yahooRawSample;
    if (result._creativeDiagnostic) json._creativeDiagnostic = result._creativeDiagnostic;
    if (result._fallbackCreative) json._fallbackCreative = result._fallbackCreative;
    if (!skipCache) setReportCache(cacheKey, json);
    res.setHeader("X-Ad-Rows-Count", String((result.adRows || []).length));
    res.json(json);
  } catch (e) {
    console.error("[ads] report error:", e.message);
    res.status(500).json({ error: "レポートの取得に失敗しました。" });
  }
});

/** GET /api/ads/yahoo/cleanup-jobs - ReportDefinitionService の滞留ジョブを一括削除 */
router.get("/yahoo/cleanup-jobs", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });
  try {
    const result = await cleanupReportJobs(user.id);
    if (result.error) return res.status(400).json({ error: result.error, removed: 0 });
    res.json({ ok: true, removed: result.removed, total: result.total });
  } catch (e) {
    console.error("[ads] cleanup-jobs error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/ads/yahoo/creative-debug - AD/Asset レポートの診断（API応答をそのまま返す） */
router.get("/yahoo/creative-debug", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });
  const month = (req.query.month || "").trim();
  const startDate = (req.query.startDate || "").trim();
  const endDate = (req.query.endDate || "").trim();
  let range;
  if (startDate && endDate && getDateRangeFromDates(startDate, endDate)) {
    range = getDateRangeFromDates(startDate, endDate);
  } else {
    range = getDateRangeForMonth(month || undefined);
  }
  try {
    const result = await getCreativeReportsDebug(range.startDate, range.endDate, user.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message, _diagnostic: true });
  }
});

/** GET /api/ads/yahoo/campaign-raw - CAMPAIGNレポートの生CSV（デバッグ用） */
router.get("/yahoo/campaign-raw", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });
  const month = (req.query.month || "").trim();
  const startDate = (req.query.startDate || "").trim();
  const endDate = (req.query.endDate || "").trim();
  const range = startDate && endDate ? getDateRangeFromDates(startDate, endDate) : getDateRangeForMonth(month || undefined);
  if (!range) return res.status(400).json({ error: "month または startDate+endDate を指定してください" });
  try {
    const result = await getCampaignRawDownload(range.startDate, range.endDate, user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** POST /api/ads/cache/clear - レポートのメモリキャッシュを全削除 */
router.post("/cache/clear", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });
  const n = reportResponseCache.size;
  reportResponseCache.clear();
  res.json({ ok: true, message: "キャッシュをクリアしました", cleared: n });
});

/** GET /api/ads/meta/report-debug - Meta Insights の直接取得テスト（診断用） */
router.get("/meta/report-debug", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });
  const adAccountId = (req.query.ad_account_id || "").trim();
  const month = (req.query.month || "").trim();
  const startDate = (req.query.startDate || "").trim();
  const endDate = (req.query.endDate || "").trim();
  if (!adAccountId) return res.status(400).json({ error: "ad_account_id を指定してください" });
  let range;
  if (startDate && endDate && getDateRangeFromDates(startDate, endDate)) {
    range = getDateRangeFromDates(startDate, endDate);
  } else {
    range = getDateRangeForMonth(month || undefined);
  }
  try {
    const result = await fetchMetaInsightsReport(adAccountId, range.startDate, range.endDate);
    res.json({
      rows: result.rows || [],
      meta: result.meta || {},
      _debug: { adAccountId, startDate: range.startDate, endDate: range.endDate },
    });
  } catch (e) {
    res.status(500).json({ error: e.message, _debug: { adAccountId } });
  }
});

/** GET /api/ads/meta/adaccounts - Meta Graph API で広告アカウント一覧を取得（.env の META_ACCESS_TOKEN を使用） */
router.get("/meta/adaccounts", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });
  const token = (process.env.META_ACCESS_TOKEN || "").trim();
  if (!token) return res.status(503).json({ error: "META_ACCESS_TOKEN が .env に設定されていません" });
  try {
    const all = [];
    let url = "https://graph.facebook.com/v25.0/me/adaccounts?fields=id,name&limit=100&access_token=" + encodeURIComponent(token);
    while (url) {
      const resp = await fetch(url);
      const d = await resp.json().catch(() => ({}));
      if (d.error) {
        return res.status(400).json({
          error: d.error?.code === 190 || /invalid|expired/i.test(d.error?.message || "")
            ? "トークンが無効です。.env の META_ACCESS_TOKEN を確認してください"
            : (d.error.message || "取得に失敗しました"),
          fbError: d.error,
        });
      }
      const data = d.data || [];
      all.push(...data);
      url = d.paging?.next || null;
    }
    res.json({ data: all });
  } catch (e) {
    console.error("[ads] meta adaccounts error:", e.message);
    res.status(500).json({ error: "エラー: " + (e.message || "通信失敗") });
  }
});

/** GET /api/ads/debug-account - レポート取得に使用するアカウント情報を確認（診断用） */
router.get("/debug-account", async (req, res) => {
  try {
    const user = await getUserWithContext(req);
    if (!user) return res.status(401).json({ error: "ログインが必要です" });
    const acc = await getSelectedAccount(user.id);
    if (!acc) {
      return res.json({ found: false, message: "選択されたアカウントがありません" });
    }
    res.json({
      found: true,
      account_id: acc.id,
      name: acc.name,
      customer_id: acc.customer_id || null,
      login_customer_id: acc.login_customer_id || null,
      has_refresh_token: !!acc.refresh_token,
      api_auth_source_id: acc.api_auth_source_id || null,
      hint: !acc.login_customer_id ? "MCC配下のアカウントの場合、login_customer_id（MCC ID）が必要です。API認証元にMCC IDを登録し直してください。" : null,
    });
  } catch (e) {
    console.error("[ads] debug-account error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/ads/verify - API取得に使用中の Customer ID を確認 */
router.get("/verify", async (req, res) => {
  try {
    const user = await getUserWithContext(req);
    if (!user) {
      return res.status(401).json({ error: "ログインが必要です" });
    }
    let startDate, endDate;
    const qStart = (req.query.startDate || "").trim();
    const qEnd = (req.query.endDate || "").trim();
    if (qStart && qEnd && getDateRangeFromDates(qStart, qEnd)) {
      startDate = qStart;
      endDate = qEnd;
    } else {
      const range = getDateRangeForMonth(req.query.month);
      startDate = range.startDate;
      endDate = range.endDate;
    }
    const { rows, customerId } = await fetchGoogleAdsReportWithMeta(startDate, endDate, user.id);
    res.json({
      success: true,
      customer_id: customerId || null,
      row_count: rows.length,
      message: customerId
        ? `Customer ID ${customerId} で ${rows.length} 件のキャンペーンデータを取得しました`
        : "Customer ID が設定されていません。API設定で連携してください。",
    });
  } catch (e) {
    console.error("[ads] verify error:", e.message);
    res.status(500).json({
      success: false,
      customer_id: null,
      row_count: 0,
      message: "確認に失敗しました: " + (e.message || "エラー"),
    });
  }
});

/** GET /api/ads/status - 媒体連携ステータス */
router.get("/status", async (req, res) => {
  try {
    const user = await getUserWithContext(req);
    if (!user) {
      return res.status(401).json({ error: "ログインが必要です" });
    }

    const status = await getConnectionStatus(user.id);
    res.json(status);
  } catch (e) {
    console.error("[ads] status error:", e.message);
    res.json({
      google: { connected: false },
      yahoo: { connected: false },
      microsoft: { connected: false },
    });
  }
});

/** GET /api/ads/google/connect - Google Ads OAuth 開始
 * mode=auth_source: API認証元追加（name のみ、MCCでOAuth）
 * mode=account: 従来（name, customer_id, login_customer_id でアカウント追加＋OAuth）※レガシー
 */
router.get("/google/connect", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) {
    return res.redirect("/?error=login_required");
  }

  const redirectUri = getRedirectUri(req);
  const client = getOAuth2Client(redirectUri);
  if (!client) {
    return res.status(503).json({
      error: "Google Ads OAuth が設定されていません。.env に GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を設定してください。",
    });
  }

  const developerToken = (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
  if (!developerToken) {
    return res.status(503).json({
      error: "GOOGLE_ADS_DEVELOPER_TOKEN が設定されていません。Google Ads Manager で取得してください。",
    });
  }

  const mode = (req.query.mode || "").trim() || "auth_source";
  const accountName = (req.query.name || req.query.account_name || "").trim().slice(0, 100);
  const customerId = (req.query.customer_id || "").trim().replace(/\s/g, "").replace(/-/g, "");
  const loginCustomerId = (req.query.login_customer_id || "").trim().replace(/\s/g, "").replace(/-/g, "") || null;
  const state = crypto.randomBytes(24).toString("hex");

  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM oauth_states");
    const hasLogin = cols?.some((c) => c.Field === "login_customer_id");
    const hasName = cols?.some((c) => c.Field === "account_name");
    if (hasLogin && hasName) {
      await pool.query(
        "INSERT INTO oauth_states (state, user_id, expires_at, customer_id, login_customer_id, account_name) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), ?, ?, ?)",
        [state, userId, mode === "auth_source" ? null : (customerId || null), loginCustomerId || null, accountName || null]
      );
    } else {
      await pool.query(
        "INSERT INTO oauth_states (state, user_id, expires_at, customer_id) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), ?)",
        [state, userId, mode === "auth_source" ? null : (customerId || null)]
      );
    }
  } catch (e) {
    const needFallback = e.code === "ER_BAD_FIELD_ERROR" || (e.code === "ER_NO_SUCH_COLUMN") ||
      (e.message && /customer_id|Unknown column/.test(e.message));
    if (needFallback) {
      await pool.query(
        "INSERT INTO oauth_states (state, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))",
        [state, userId]
      );
    } else throw e;
  }

  client.redirectUri = redirectUri;

  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: [ADS_SCOPE],
    state,
    prompt: "consent",
    redirect_uri: redirectUri,
  });

  res.redirect(url);
});

/** GET /api/ads/google/callback - Google Ads OAuth コールバック */
router.get("/google/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.warn("[Google Ads OAuth] error:", error);
    return res.redirect("/ads.html?google_ads_error=" + encodeURIComponent(error));
  }

  if (!code || !state) {
    return res.redirect("/ads.html?google_ads_error=missing_params");
  }

  let rows;
  try {
    [rows] = await pool.query(
      "SELECT user_id, customer_id, login_customer_id, account_name FROM oauth_states WHERE state = ? AND expires_at > NOW() LIMIT 1",
      [state]
    );
  } catch (e) {
    try {
      [rows] = await pool.query(
        "SELECT user_id, customer_id FROM oauth_states WHERE state = ? AND expires_at > NOW() LIMIT 1",
        [state]
      );
    } catch (e2) {
      [rows] = await pool.query(
        "SELECT user_id FROM oauth_states WHERE state = ? AND expires_at > NOW() LIMIT 1",
        [state]
      );
    }
  }
  await pool.query("DELETE FROM oauth_states WHERE state = ?", [state]);

  if (!rows.length) {
    return res.redirect("/ads.html?google_ads_error=invalid_state");
  }

  const userId = rows[0].user_id;
  let customerId = (rows[0].customer_id || "").trim().replace(/-/g, "") || null;
  const loginCustomerId = (rows[0].login_customer_id || "").trim().replace(/-/g, "") || null;
  const accountName = (rows[0].account_name || "").trim() || null;

  const isAuthSourceMode = accountName && !customerId;

  const redirectUri = getRedirectUri(req);
  const client = getOAuth2Client(redirectUri);
  if (!client) {
    return res.redirect("/ads.html?google_ads_error=config");
  }

  try {
    const { tokens } = await client.getToken(code);
    clearReportResponseCache("google_oauth_callback");
    let googleEmail = null;
    if (tokens.access_token) {
      try {
        const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: "Bearer " + tokens.access_token },
        });
        if (r.ok) {
          const j = await r.json();
          googleEmail = j.email || null;
        }
      } catch (_) {}
    }

    if (isAuthSourceMode) {
      const authSourceId = await apiAuthSources.create(userId, {
        name: accountName,
        platform: "google",
        loginCustomerId,
        tokens,
        googleEmail,
      });
      if (authSourceId) {
        return res.redirect("/ads.html?google_ads=auth_linked&auth_source=" + authSourceId);
      }
    }

    if (accountName && customerId) {
      const accountId = await createAccount(userId, {
        name: accountName,
        customerId,
        loginCustomerId: loginCustomerId || null,
        tokens,
        googleEmail,
      });
      if (accountId) {
        return res.redirect("/ads.html?google_ads=linked&account=" + accountId);
      }
    }

    await saveTokensForUser(userId, customerId, tokens, loginCustomerId || null);
    return res.redirect("/ads.html?google_ads=linked");
  } catch (e) {
    console.error("[Google Ads OAuth] token exchange error:", e.message);
    return res.redirect("/ads.html?google_ads_error=" + encodeURIComponent(e.message || "token_exchange_failed"));
  }
});

/** GET /api/ads/google/auth-sources - API認証元一覧 */
router.get("/google/auth-sources", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "ログインが必要です" });
  try {
    const sources = await apiAuthSources.list(userId, "google");
    res.json({ auth_sources: sources });
  } catch (e) {
    console.error("[ads] auth-sources list error:", e.message);
    res.status(500).json({ error: "取得に失敗しました" });
  }
});

/** POST /api/ads/google/auth-sources/:id/mcc - API認証元のMCC IDを更新（OAuth不要） */
router.post("/google/auth-sources/:id/mcc", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "ログインが必要です" });
  const id = parseInt(req.params.id, 10);
  const loginCustomerId = (req.body?.login_customer_id ?? req.body?.loginCustomerId ?? "").trim().replace(/-/g, "");
  if (!id || !loginCustomerId) {
    return res.status(400).json({ error: "MCC IDを入力してください" });
  }
  try {
    const ok = await apiAuthSources.updateLoginCustomerId(id, userId, loginCustomerId);
    if (ok) clearReportResponseCache("google_auth_source_mcc");
    res.json({ success: ok });
  } catch (e) {
    console.error("[ads] auth-sources patch error:", e.message);
    res.status(500).json({ error: "更新に失敗しました" });
  }
});

/** DELETE /api/ads/google/auth-sources/:id - API認証元削除 */
router.delete("/google/auth-sources/:id", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "ログインが必要です" });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "無効なIDです" });
  try {
    const ok = await apiAuthSources.remove(userId, id);
    if (ok) clearReportResponseCache("google_auth_source_deleted");
    res.json({ success: ok });
  } catch (e) {
    console.error("[ads] auth-sources delete error:", e.message);
    res.status(500).json({ error: "削除に失敗しました" });
  }
});

/** GET /api/ads/google/auth-sources/:id/clients - MCC配下のクライアントアカウント一覧を取得 */
router.get("/google/auth-sources/:id/clients", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "ログインが必要です" });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "無効なIDです" });
  try {
    const authSource = await apiAuthSources.getById(id, userId);
    if (!authSource) {
      return res.status(400).json({ error: "指定したAPI認証元が見つかりません" });
    }
    const loginCustomerId = (authSource.login_customer_id || "").trim().replace(/-/g, "");
    if (!loginCustomerId) {
      return res.status(400).json({ error: "この認証元にはMCC ID（login_customer_id）が設定されていません。先にMCC設定を行ってください。" });
    }
    const refreshToken = authSource.refresh_token;
    if (!refreshToken) {
      return res.status(400).json({ error: "認証トークンが見つかりません。再連携してください。" });
    }

    const developerToken = (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
    const clientId = (process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();
    const clientSecret = (process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "").trim();
    if (!developerToken || !clientId || !clientSecret) {
      return res.status(503).json({ error: "Google Ads API の設定が不完全です" });
    }

    // OAuth2 でアクセストークンを取得（失敗時は例外になりがちなので分離して detail を返す）
    const { OAuth2Client } = require("google-auth-library");
    const oauth2 = new OAuth2Client(clientId, clientSecret);
    oauth2.setCredentials({
      refresh_token: refreshToken,
      access_token: authSource.access_token || null,
      expiry_date: authSource.expiry_date ? Number(authSource.expiry_date) : null,
    });
    let accessToken;
    try {
      const tok = await oauth2.getAccessToken();
      accessToken = tok?.token || null;
    } catch (te) {
      const raw =
        te?.response?.data !== undefined
          ? JSON.stringify(te.response.data)
          : te?.message || String(te);
      console.error("[ads] oauth getAccessToken (clients list):", raw);
      return res.status(401).json({
        error:
          "Google のアクセストークンが取得できません（refresh_token の失効や Client ID/Secret の不一致が多いです）。「Google で連携」から再認証してください。",
        detail: raw.slice(0, 1200),
      });
    }
    if (!accessToken) {
      return res.status(401).json({
        error: "アクセストークンが空です。「Google で連携」から再認証してください。",
        detail: "",
      });
    }

    // Google Ads REST API で customer_client を直接クエリ
    // login-customer-id ヘッダー付きなので開発者トークンの検証が通る
    const gaql = [
      "SELECT customer_client.id, customer_client.descriptive_name,",
      "customer_client.manager, customer_client.status",
      "FROM customer_client",
      "WHERE customer_client.manager = false",
    ].join(" ");

    const apiVersion = "v23";
    const searchUrl = `https://googleads.googleapis.com/${apiVersion}/customers/${loginCustomerId}/googleAds:search`;
    const searchResp = await fetch(searchUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "login-customer-id": loginCustomerId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: gaql, pageSize: 1000 }),
    });

    if (!searchResp.ok) {
      const errBody = await searchResp.text();
      console.error("[ads] REST customer_client error:", searchResp.status, errBody);
      // 開発者トークンの権限不足系エラー → 手入力へフォールバック
      if (errBody.includes("DEVELOPER_TOKEN_PROHIBITED") || errBody.includes("DEVELOPER_TOKEN_NOT_APPROVED")) {
        const reason = errBody.includes("DEVELOPER_TOKEN_NOT_APPROVED") ? "developer_token_not_approved" : "developer_token_prohibited";
        return res.status(200).json({
          clients: [],
          login_customer_id: loginCustomerId,
          unavailable: true,
          reason,
          message: "アカウント自動取得は現在利用できません。Customer ID を手入力してください。",
        });
      }
      return res.status(500).json({
        error: "Google Ads API エラー (HTTP " + searchResp.status + ")",
        detail: errBody.slice(0, 500),
      });
    }

    const searchData = await searchResp.json();
    const rows = searchData.results || [];
    const clients = rows.map((r) => {
      const cc = r.customerClient || {};
      return {
        customer_id: String(cc.id || "").replace(/-/g, ""),
        name: cc.descriptiveName || "",
        manager: !!(cc.manager),
        status: cc.status || "UNKNOWN",
      };
    }).filter((c) => c.customer_id && !c.manager);

    // 名前順でソート
    clients.sort((a, b) => (a.name || a.customer_id).localeCompare(b.name || b.customer_id, "ja"));

    res.json({ clients, login_customer_id: loginCustomerId });
  } catch (e) {
    const fromGaxios = e?.response?.data !== undefined ? JSON.stringify(e.response.data).slice(0, 1200) : "";
    const gaDetail = e?.errors?.map?.((x) => x.message || x).join("; ") || "";
    const detail = fromGaxios || gaDetail || (e?.stack && process.env.NODE_ENV !== "production" ? e.stack.slice(0, 500) : "");
    console.error("[ads] auth-sources clients error:", e.message, detail || gaDetail);
    res.status(500).json({
      error: "アカウント一覧の取得に失敗しました: " + (e.message || ""),
      detail: detail || undefined,
    });
  }
});

/** POST /api/ads/google/accounts - アカウント追加（API認証元選択式） */
router.post("/google/accounts", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "ログインが必要です" });
  const { name, customer_id, login_customer_id, api_auth_source_id } = req.body || {};
  const cid = (customer_id || "").trim().replace(/-/g, "");
  const authId = api_auth_source_id ? parseInt(api_auth_source_id, 10) : null;
  if (!cid) {
    return res.status(400).json({ error: "Customer ID を入力してください" });
  }
  if (!authId) {
    return res.status(400).json({ error: "API認証元を選択してください" });
  }
  try {
    const authSource = await apiAuthSources.getById(authId, userId);
    if (!authSource) {
      return res.status(400).json({ error: "指定したAPI認証元が見つかりません" });
    }
    // login_customer_id がリクエストに無い場合、API認証元から取得
    const lid = (login_customer_id || "").trim().replace(/-/g, "") || null;
    if (!lid && !authSource.login_customer_id) {
      console.warn("[ads] accounts create: login_customer_id が未設定です (authSource=%d, customer=%s)", authId, cid);
    }
    const accountId = await createAccount(userId, {
      name: (name || "").trim(),
      customerId: cid,
      loginCustomerId: lid,
      apiAuthSourceId: authId,
    });
    if (!accountId) {
      return res.status(500).json({ error: "アカウントの登録に失敗しました" });
    }
    clearReportResponseCache("google_account_created");
    res.json({ success: true, account_id: accountId });
  } catch (e) {
    console.error("[ads] accounts create error:", e.message);
    res.status(500).json({ error: "登録に失敗しました: " + (e.message || "") });
  }
});

/** GET /api/ads/google/accounts - 登録済みアカウント一覧 */
router.get("/google/accounts", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "ログインが必要です" });
  try {
    const accounts = await listAccounts(userId);
    res.json({ accounts });
  } catch (e) {
    console.error("[ads] accounts list error:", e.message);
    res.status(500).json({ error: "取得に失敗しました" });
  }
});

/** POST /api/ads/google/accounts/select - 使用するアカウントを選択 */
router.post("/google/accounts/select", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "ログインが必要です" });
  const accountId = req.body?.account_id ? parseInt(req.body.account_id, 10) : null;
  try {
    await setSelectedAccount(userId, accountId);
    clearReportResponseCache("google_account_selected");
    res.json({ success: true });
  } catch (e) {
    console.error("[ads] accounts select error:", e.message);
    res.status(500).json({ error: "選択に失敗しました" });
  }
});

/** DELETE /api/ads/google/accounts/:id - アカウント削除 */
router.delete("/google/accounts/:id", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "ログインが必要です" });
  const accountId = parseInt(req.params.id, 10);
  if (!accountId) return res.status(400).json({ error: "無効なIDです" });
  try {
    const ok = await deleteAccount(userId, accountId);
    if (ok) clearReportResponseCache("google_account_deleted");
    res.json({ success: ok });
  } catch (e) {
    console.error("[ads] accounts delete error:", e.message);
    res.status(500).json({ error: "削除に失敗しました" });
  }
});

/** POST /api/ads/google/verify-access - Customer ID と MCC の検証（デバッグ用） */
router.post("/google/verify-access", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "ログインが必要です" });
  }
  const customerId = (req.body?.customer_id ?? "").trim().replace(/-/g, "");
  const loginCustomerId = (req.body?.login_customer_id ?? "").trim().replace(/-/g, "") || null;
  if (!customerId) {
    return res.status(400).json({ error: "customer_id を指定してください" });
  }
  const validation = await validateCustomerAccess(
    customerId,
    loginCustomerId,
    null,
    userId,
    { debug: true }
  );
  res.json(validation);
});

/** POST /api/ads/google/login-customer - Customer ID と MCC ログイン Customer ID をまとめて更新 */
router.post("/google/login-customer", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) {
    console.warn("[ads] login-customer: userId=null (session_id cookie がないか期限切れ)");
    return res.status(401).json({ error: "ログインが必要です。画面をリロードして再度ログインしてください。" });
  }
  const customerId = (req.body?.customer_id ?? "").trim();
  const loginCustomerId = (req.body?.login_customer_id ?? "").trim();
  const skipValidation = !!(req.body?.skip_validation);

  if (customerId && !skipValidation) {
    const validation = await validateCustomerAccess(
      customerId,
      loginCustomerId || null,
      null,
      userId
    );
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
  }

  try {
    await updateGoogleAdsIds(userId, customerId || null, loginCustomerId || null);
    clearReportResponseCache("google_login_customer_updated");
    if (process.env.NODE_ENV !== "production") {
      console.log("[ads] login-customer: saved", { userId, customerId: customerId || null, loginCustomerId: loginCustomerId || null });
    }
    return res.json({ success: true, customer_id: customerId || null, login_customer_id: loginCustomerId || null });
  } catch (e) {
    console.error("[ads] google-ads-ids update error:", e.message);
    return res.status(500).json({ error: "更新に失敗しました。" + (e.message ? " " + e.message : "") });
  }
});

/** POST /api/ads/google/disconnect - Google Ads 連携解除 */
router.post("/google/disconnect", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  try {
    await deleteTokensForUser(userId);
    clearReportResponseCache("google_disconnect");
    return res.json({ success: true });
  } catch (e) {
    console.error("[ads] disconnect error:", e.message);
    return res.status(500).json({ error: "連携解除に失敗しました。" });
  }
});

// --- Yahoo! 広告 ---

/** GET /api/ads/yahoo/connect - Yahoo Ads OAuth 開始 */
router.get("/yahoo/connect", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.redirect("/?error=login_required");

  const { clientId } = require("../services/yahooAdsOAuth").getClientConfig();
  if (!clientId) {
    return res.status(503).json({
      error: "Yahoo Ads OAuth が設定されていません。.env に YAHOO_ADS_CLIENT_ID / YAHOO_ADS_CLIENT_SECRET を設定してください。",
    });
  }

  const authName = (req.query.name || req.query.account_name || "").trim().slice(0, 100);
  if (!authName) {
    return res.status(400).json({ error: "認証元名を入力してください（name パラメータ）" });
  }

  const { url, state } = getAuthUrl(req);
  if (!url) return res.status(503).json({ error: "Yahoo OAuth の設定が不正です" });

  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM oauth_states LIKE 'platform'");
    if (cols?.length) {
      await pool.query(
        "INSERT INTO oauth_states (state, user_id, expires_at, account_name, platform) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), ?, 'yahoo')",
        [state, userId, authName]
      );
    } else {
      await pool.query(
        "INSERT INTO oauth_states (state, user_id, expires_at, account_name) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), ?)",
        [state, userId, authName]
      );
    }
  } catch (e) {
    await pool.query(
      "INSERT INTO oauth_states (state, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))",
      [state, userId]
    );
  }

  res.redirect(url);
});

/** GET /api/ads/yahoo/callback - Yahoo Ads OAuth コールバック */
router.get("/yahoo/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.warn("[Yahoo Ads OAuth] error:", error);
    return res.redirect("/ads.html?yahoo_ads_error=" + encodeURIComponent(error));
  }
  if (!code || !state) return res.redirect("/ads.html?yahoo_ads_error=missing_params");

  let rows;
  try {
    [rows] = await pool.query(
      "SELECT user_id, account_name FROM oauth_states WHERE state = ? AND expires_at > NOW() LIMIT 1",
      [state]
    );
  } catch (e) {
    return res.redirect("/ads.html?yahoo_ads_error=invalid_state");
  }
  await pool.query("DELETE FROM oauth_states WHERE state = ?", [state]);

  if (!rows?.length) return res.redirect("/ads.html?yahoo_ads_error=invalid_state");

  const userId = rows[0].user_id;
  const authName = (rows[0].account_name || "").trim() || "Yahoo広告";

  const redirectUri = getYahooRedirectUri(req);
  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri, state);
    if (!tokens?.refresh_token) {
      return res.redirect("/ads.html?yahoo_ads_error=no_refresh_token");
    }

    const authSourceId = await apiAuthSources.create(userId, {
      name: authName,
      platform: "yahoo",
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date,
      },
    });
    if (authSourceId) {
      clearReportResponseCache("yahoo_oauth_callback");
      return res.redirect("/ads.html?yahoo_ads=auth_linked&auth_source=" + authSourceId);
    }
    return res.redirect("/ads.html?yahoo_ads_error=save_failed");
  } catch (e) {
    console.error("[Yahoo Ads OAuth] token exchange error:", e.message);
    return res.redirect("/ads.html?yahoo_ads_error=" + encodeURIComponent(e.message || "token_exchange_failed"));
  }
});

/** DELETE /api/ads/yahoo/auth-sources/:id - Yahoo API認証元削除 */
router.delete("/yahoo/auth-sources/:id", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "ログインが必要です" });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "無効なIDです" });
  try {
    const authSource = await apiAuthSources.getById(id, userId);
    if (!authSource || authSource.platform !== "yahoo") {
      return res.status(404).json({ error: "指定したYahoo API認証元が見つかりません" });
    }
    const ok = await apiAuthSources.remove(userId, id);
    if (ok) clearReportResponseCache("yahoo_auth_source_deleted");
    res.json({ success: ok });
  } catch (e) {
    console.error("[ads] yahoo auth-sources delete error:", e.message);
    res.status(500).json({ error: "削除に失敗しました" });
  }
});

/** GET /api/ads/yahoo/auth-sources - Yahoo API認証元一覧 */
router.get("/yahoo/auth-sources", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "ログインが必要です" });
  try {
    const sources = await apiAuthSources.list(userId, "yahoo");
    res.json({ auth_sources: sources });
  } catch (e) {
    console.error("[ads] yahoo auth-sources list error:", e.message);
    res.status(500).json({ error: "取得に失敗しました" });
  }
});

/** POST /api/ads/yahoo/accounts - アカウント追加 */
router.post("/yahoo/accounts", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "ログインが必要です" });
  const { name, account_id, agency_account_id, api_auth_source_id } = req.body || {};
  const aid = (account_id || "").trim();
  const authId = api_auth_source_id ? parseInt(api_auth_source_id, 10) : null;
  if (!aid) return res.status(400).json({ error: "アカウントID を入力してください" });
  if (!authId) return res.status(400).json({ error: "API認証元を選択してください" });
  try {
    const authSource = await apiAuthSources.getById(authId, userId);
    if (!authSource || authSource.platform !== "yahoo") {
      return res.status(400).json({ error: "指定したYahoo API認証元が見つかりません" });
    }
    const accountId = await createYahooAccount(userId, {
      name: (name || "").trim(),
      accountId: aid,
      agencyAccountId: (agency_account_id || "").trim() || null,
      apiAuthSourceId: authId,
    });
    if (!accountId) return res.status(500).json({ error: "アカウントの登録に失敗しました" });
    clearReportResponseCache("yahoo_account_created");
    res.json({ success: true, account_id: accountId });
  } catch (e) {
    console.error("[ads] yahoo accounts create error:", e.message);
    res.status(500).json({ error: "登録に失敗しました: " + (e.message || "") });
  }
});

/** GET /api/ads/yahoo/accounts - 登録済みアカウント一覧 */
router.get("/yahoo/accounts", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "ログインが必要です" });
  try {
    const accounts = await listYahooAccounts(userId);
    res.json({ accounts });
  } catch (e) {
    console.error("[ads] yahoo accounts list error:", e.message);
    res.status(500).json({ error: "取得に失敗しました" });
  }
});

/** POST /api/ads/yahoo/accounts/select - 使用するアカウントを選択 */
router.post("/yahoo/accounts/select", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "ログインが必要です" });
  const accountId = req.body?.account_id ? parseInt(req.body.account_id, 10) : null;
  try {
    await setSelectedYahooAccount(userId, accountId);
    clearReportResponseCache("yahoo_account_selected");
    res.json({ success: true });
  } catch (e) {
    console.error("[ads] yahoo accounts select error:", e.message);
    res.status(500).json({ error: "選択に失敗しました" });
  }
});

/** DELETE /api/ads/yahoo/accounts/:id - アカウント削除 */
router.delete("/yahoo/accounts/:id", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "ログインが必要です" });
  const accountId = parseInt(req.params.id, 10);
  if (!accountId) return res.status(400).json({ error: "無効なIDです" });
  try {
    const ok = await deleteYahooAccount(userId, accountId);
    if (ok) clearReportResponseCache("yahoo_account_deleted");
    res.json({ success: ok });
  } catch (e) {
    console.error("[ads] yahoo accounts delete error:", e.message);
    res.status(500).json({ error: "削除に失敗しました" });
  }
});

module.exports = router;
