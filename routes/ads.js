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
const { fetchGoogleAdsReportWithMeta, validateCustomerAccess } = require("../services/ads/googleAds");
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
const apiAuthSources = require("../services/apiAuthSources");

/** GET /api/ads/test-api - 指定IDでGoogle Ads APIを直接叩いてテスト（digital-eyes.site等から実行用）
 * 例: /api/ads/test-api?mcc=9838710115&customer_id=4211317572
 */
router.get("/test-api", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "ログインが必要です" });
  }
  const mcc = (req.query.mcc || "9838710115").trim().replace(/-/g, "");
  const customerIdParam = (req.query.customer_id || "4211317572").trim().replace(/-/g, "");

  const developerToken = (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
  const clientId = (process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "").trim();

  let refreshToken = (process.env.GOOGLE_ADS_REFRESH_TOKEN || "").trim();
  let mccFromDb = mcc;
  if (!refreshToken) {
    const [rows] = await pool.query(
      `SELECT a.refresh_token, a.login_customer_id
       FROM api_auth_sources a
       INNER JOIN google_ads_accounts g ON g.api_auth_source_id = a.id AND g.user_id = a.user_id
       WHERE a.platform = 'google' AND a.refresh_token IS NOT NULL AND a.user_id = ?
       ORDER BY g.is_selected DESC, a.id DESC LIMIT 1`,
      [user.id]
    );
    if (rows.length) {
      refreshToken = rows[0].refresh_token || "";
      const lid = (rows[0].login_customer_id || "").trim().replace(/-/g, "");
      if (lid) mccFromDb = lid;
    }
    if (!refreshToken) {
      const [fallback] = await pool.query(
        "SELECT refresh_token, login_customer_id FROM api_auth_sources WHERE platform = 'google' AND refresh_token IS NOT NULL AND user_id = ? ORDER BY id DESC LIMIT 1",
        [user.id]
      );
      if (fallback.length) {
        refreshToken = fallback[0].refresh_token || "";
        const lid = (fallback[0].login_customer_id || "").trim().replace(/-/g, "");
        if (lid) mccFromDb = lid;
      }
    }
  }

  if (!developerToken || !clientId || !clientSecret || !refreshToken) {
    return res.status(400).json({
      error: "GOOGLE_ADS_* の設定が不足しています",
      has_token: !!developerToken,
      has_client: !!(clientId && clientSecret),
      has_refresh: !!refreshToken,
    });
  }

  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10);
  const endDate = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0, 10);

  const result = {
    mcc_used: mccFromDb || mcc,
    mcc_param: mcc,
    customer_id: customerIdParam,
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
    const loginCid = (mccFromDb || mcc) || undefined;
    const customer = client.Customer({
      customer_id: customerIdParam,
      refresh_token: refreshToken,
      ...(loginCid && { login_customer_id: loginCid }),
    });

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
      mcc,
      customer_id: customerIdParam,
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

/** GET /api/ads/report - 媒体別レポート取得（company_id 不要・1アカウント連携前提） */
router.get("/report", async (req, res) => {
  const user = await getUserWithContext(req);
  if (!user) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const month = (req.query.month || "").trim();
  const startDate = (req.query.startDate || "").trim();
  const endDate = (req.query.endDate || "").trim();
  const debug = /^(1|true|yes)$/i.test((req.query.debug || "").trim());

  try {
    const userId = user.id;
    let param;
    if (startDate && endDate) {
      param = getDateRangeFromDates(startDate, endDate);
    }
    if (!param) {
      param = month || undefined;
    }
    const result = await fetchAllReports(param, userId, { debug });
    const json = { rows: result.rows || [], meta: result.meta || {} };
    if (result._debug) json._debug = result._debug;
    if (result._hint) json._hint = result._hint;
    res.json(json);
  } catch (e) {
    console.error("[ads] report error:", e.message);
    res.status(500).json({ error: "レポートの取得に失敗しました。" });
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
    res.json({ success: ok });
  } catch (e) {
    console.error("[ads] auth-sources delete error:", e.message);
    res.status(500).json({ error: "削除に失敗しました" });
  }
});

/** POST /api/ads/google/accounts - アカウント追加（API認証元選択式） */
router.post("/google/accounts", async (req, res) => {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "ログインが必要です" });
  const { name, customer_id, api_auth_source_id } = req.body || {};
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
    const accountId = await createAccount(userId, {
      name: (name || "").trim(),
      customerId: cid,
      apiAuthSourceId: authId,
    });
    if (!accountId) {
      return res.status(500).json({ error: "アカウントの登録に失敗しました" });
    }
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
    return res.json({ success: true });
  } catch (e) {
    console.error("[ads] disconnect error:", e.message);
    return res.status(500).json({ error: "連携解除に失敗しました。" });
  }
});

module.exports = router;
