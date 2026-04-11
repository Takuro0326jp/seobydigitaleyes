/**
 * 運用型広告 媒体別データ取得の集約
 */
const { fetchGoogleAdsReport, fetchGoogleAdsReportWithMeta } = require("./googleAds");
const { fetchYahooAdsReport, fetchYahooAdsReportWithMeta } = require("./yahooAds");
const { getCreativeReportsDebug } = require("./yahooAds");
const { fetchMicrosoftAdsReport } = require("./microsoftAds");
const { fetchMetaInsightsReport } = require("./metaAds");

function getDateRangeForMonth(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    const d = new Date();
    ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  const [y, m] = ym.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    startDate: `${y}-${pad(m)}-01`,
    endDate: `${y}-${pad(m)}-${new Date(y, m, 0).getDate()}`,
  };
}

function dateKeyForDaily(d) {
  const raw = String(d ?? "").replace(/\D/g, "").slice(0, 8);
  return /^\d{8}$/.test(raw) ? raw : "";
}

function mergeDailyRows(yahoo, meta, google = []) {
  const byDate = new Map();
  yahoo.forEach((r) => {
    const key = dateKeyForDaily(r.date || r.day);
    if (!key) return;
    byDate.set(key, { ...r, date: key });
  });
  const mergeIn = (arr) => {
    arr.forEach((r) => {
      const key = dateKeyForDaily(r.date || r.day);
      if (!key) return;
      if (!byDate.has(key)) byDate.set(key, { date: key, impressions: 0, clicks: 0, cost: 0, conversions: 0 });
      const acc = byDate.get(key);
      acc.impressions += Number(r.impressions) || 0;
      acc.clicks += Number(r.clicks) || 0;
      acc.cost += Number(r.cost) || 0;
      acc.conversions += Number(r.conversions) || 0;
    });
  };
  mergeIn(meta);
  mergeIn(google);
  return [...byDate.values()].sort((a, b) => (a.date || a.day || "").localeCompare(b.date || b.day || ""));
}

/** startDate/endDate を直接指定した場合の日付範囲（YYYY-MM-DD形式） */
function getDateRangeFromDates(startDate, endDate) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (re.test(startDate) && re.test(endDate) && startDate <= endDate) {
    return { startDate, endDate };
  }
  return null;
}

async function fetchAllReports(monthOrRange, userId = null, options = {}) {
  let startDate, endDate;
  if (typeof monthOrRange === "object" && monthOrRange?.startDate && monthOrRange?.endDate) {
    ({ startDate, endDate } = monthOrRange);
  } else {
    const range = getDateRangeForMonth(monthOrRange);
    startDate = range.startDate;
    endDate = range.endDate;
  }

  const companyUrlId = options?.company_url_id || null;
  const status = await getConnectionStatus(userId, companyUrlId);
  const fetchGoogle = status.google?.connected ?? false;
  const fetchYahoo = status.yahoo?.connected ?? false;
  const fetchMicrosoft = status.microsoft?.connected ?? false;
  // Meta: company_url_id ベースの場合は紐付けから取得
  let adAccountId = (options?.ad_account_id || "").trim();
  if (!adAccountId && companyUrlId) {
    adAccountId = status.meta?.meta_ad_account_id || "";
  }
  const hasMetaToken = !!(process.env.META_ACCESS_TOKEN || "").trim();
  const fetchMeta = !!(adAccountId && hasMetaToken);
  const mediaCalled = [];
  if (fetchGoogle) mediaCalled.push("google");
  if (fetchYahoo) mediaCalled.push("yahoo");
  if (fetchMicrosoft) mediaCalled.push("microsoft");
  if (fetchMeta) mediaCalled.push("meta");
  if (mediaCalled.length > 0) {
    console.log("[Ads] API呼び出し:", mediaCalled.join(", "), `(${startDate}〜${endDate})`);
  }

  const promises = [];
  if (fetchGoogle) promises.push(fetchGoogleAdsReportWithMeta(startDate, endDate, userId, options));
  else
    promises.push(
      Promise.resolve({
        rows: [],
        areaRows: [],
        hourRows: [],
        dailyRows: [],
        keywordRows: [],
        adRows: [],
        assetRows: [],
        customerId: null,
      })
    );
  if (fetchYahoo) promises.push(fetchYahooAdsReportWithMeta(startDate, endDate, userId, options));
  else
    promises.push(
      Promise.resolve({
        rows: [],
        areaRows: [],
        hourRows: [],
        dailyRows: [],
        keywordRows: [],
        adRows: [],
        assetRows: [],
        customerId: null,
      })
    );
  if (fetchMicrosoft) promises.push(fetchMicrosoftAdsReport(startDate, endDate));
  else promises.push(Promise.resolve([]));
  if (fetchMeta) promises.push(fetchMetaInsightsReport(adAccountId, startDate, endDate));
  else promises.push(Promise.resolve({ rows: [], areaRows: [], hourRows: [], dailyRows: [], keywordRows: [], adRows: [], meta: {} }));

  const results = await Promise.all(promises);
  const googleResult = results[0];
  const yahooResult = results[1];
  const microsoft = results[2];
  const metaResult = results[3] || { rows: [], areaRows: [], hourRows: [], dailyRows: [], keywordRows: [], adRows: [], meta: {} };

  const googleRows = googleResult.rows || [];
  const yahooRows = yahooResult.rows || [];
  const microsoftRows = Array.isArray(microsoft) ? microsoft : [];
  const metaRows = metaResult.rows || [];
  let adRows = yahooResult.adRows || [];
  let assetRows = yahooResult.assetRows || [];
  let _fallbackAd = 0;
  let _fallbackAsset = 0;
  if (fetchYahoo && (adRows.length === 0 || assetRows.length === 0)) {
    try {
      const fallback = await getCreativeReportsDebug(startDate, endDate, userId);
      const gotAd = adRows.length === 0 && Array.isArray(fallback.adRows) && fallback.adRows.length > 0;
      const gotAsset = assetRows.length === 0 && Array.isArray(fallback.assetRows) && fallback.assetRows.length > 0;
      if (gotAd) {
        adRows = fallback.adRows;
        _fallbackAd = adRows.length;
      }
      if (gotAsset) {
        assetRows = fallback.assetRows;
        _fallbackAsset = assetRows.length;
      }
      console.log("[Ads] クリエイティブフォールバック: ad=" + (gotAd ? adRows.length : "主取得") + ", asset=" + (gotAsset ? assetRows.length : "主取得") + (fallback.error ? " error=" + fallback.error : ""));
    } catch (e) {
      console.warn("[Ads] クリエイティブフォールバック失敗:", e.message);
    }
  }
  if (adRows.length === 0 && yahooRows.length > 0) {
    const yahooCampaigns = yahooRows.filter((r) => (r.media || "").indexOf("Yahoo") >= 0);
    if (yahooCampaigns.length > 0) {
      adRows = yahooCampaigns.map((r) => ({
        campaign: r.campaign || r.name || "—",
        adGroup: "—",
        adName: "(キャンペーン)",
        impressions: r.impressions || 0,
        clicks: r.clicks || 0,
        cost: r.cost || 0,
        conversions: r.conversions || 0,
      }));
      console.log("[Ads] AD空のためキャンペーンデータで代替: " + adRows.length + " 件");
    }
  }
  const googleAdRowsWithMedia = (googleResult.adRows || []).map((r) => ({ ...r, media: r.media || "Google Ads" }));
  const metaAdRows = (metaResult.adRows || []).map((r) => ({ ...r, media: r.media || "Meta" }));
  const yahooAdRowsWithMedia = adRows.map((r) => ({ ...r, media: "Yahoo広告" }));
  adRows = [...googleAdRowsWithMedia, ...yahooAdRowsWithMedia, ...metaAdRows];
  const yahooDailyRows = yahooResult.dailyRows || [];
  const metaDailyRows = metaResult.dailyRows || [];
  const googleDailyRows = googleResult.dailyRows || [];
  const dailyRowsMerged = mergeDailyRows(yahooDailyRows, metaDailyRows, googleDailyRows);
  const yahooAreaWithMedia = (yahooResult.areaRows || []).map((r) => ({ ...r, media: "Yahoo広告" }));
  const googleAreaRows = (googleResult.areaRows || []).map((r) => ({ ...r, media: r.media || "Google Ads" }));
  const yahooHourWithMedia = (yahooResult.hourRows || []).map((r) => ({ ...r, media: "Yahoo広告" }));
  const googleHourWithMedia = (googleResult.hourRows || []).map((r) => ({ ...r, media: r.media || "Google Ads" }));
  const yahooKeywordWithMedia = (yahooResult.keywordRows || []).map((r) => ({ ...r, media: "Yahoo広告" }));
  const googleKeywordWithMedia = (googleResult.keywordRows || []).map((r) => ({ ...r, media: r.media || "Google Ads" }));
  const metaKeywordWithMedia = (metaResult.keywordRows || []).map((r) => ({ ...r, media: "Meta" }));
  const metaError = (metaResult.meta && metaResult.meta.error) || (adAccountId && !hasMetaToken ? "META_ACCESS_TOKEN が .env に設定されていません" : null);
  const res = {
    rows: [...googleRows, ...yahooRows, ...microsoftRows, ...metaRows],
    areaRows: [...yahooAreaWithMedia, ...googleAreaRows, ...(metaResult.areaRows || [])],
    hourRows: [...yahooHourWithMedia, ...googleHourWithMedia, ...(metaResult.hourRows || []).map((r) => ({ ...r, media: "Meta" }))],
    dailyRows: dailyRowsMerged,
    keywordRows: [...yahooKeywordWithMedia, ...googleKeywordWithMedia, ...metaKeywordWithMedia],
    adRows,
    assetRows,
    meta: {
      google_customer_id: googleResult.customerId || null,
      google_auth_source_id: googleResult.authSourceId || null,
      yahoo_account_id: yahooResult.customerId || null,
      meta_account_id: adAccountId || null,
      meta_error: metaError,
      google_api_error: googleResult.google_api_error || null,
      requested_startDate: startDate,
      requested_endDate: endDate,
      google_row_count: googleRows.length,
      yahoo_row_count: yahooRows.length,
      microsoft_row_count: microsoftRows.length,
      meta_row_count: metaRows.length,
      _media_called: mediaCalled,
    },
    _debug: { ...googleResult._debug, ...yahooResult._debug },
    _yahooRawSample: yahooResult._yahooRawSample || null,
    _creativeDiagnostic: yahooResult._creativeDiagnostic || null,
    _fallbackCreative: _fallbackAd > 0 || _fallbackAsset > 0 ? { ad: _fallbackAd, asset: _fallbackAsset } : undefined,
  };
  if (googleResult._hint) res._hint = googleResult._hint;
  if (yahooResult._hint && !res._hint) res._hint = yahooResult._hint;
  else if (yahooResult._hint) res._hint = (res._hint || "") + " " + yahooResult._hint;
  return res;
}

async function getConnectionStatus(userId = null, companyUrlId = null) {
  // ── company_url_id ベースの接続状態判定 ──
  if (companyUrlId) {
    const { getAccountForCompanyUrl, listAssignments } = require("../companyUrlAdsAccounts");
    const apiAuthSources = require("../apiAuthSources");
    const allAuthSources = await apiAuthSources.listAllPlatformsForCompanyUrl(companyUrlId);
    const assignments = await listAssignments(companyUrlId);

    const googleAcc = await getAccountForCompanyUrl(companyUrlId, "google");
    const hasGoogle = !!(googleAcc?.refresh_token && process.env.GOOGLE_ADS_DEVELOPER_TOKEN && googleAcc.customer_id);

    const yahooAcc = await getAccountForCompanyUrl(companyUrlId, "yahoo");
    const hasYahoo = !!(yahooAcc?.refresh_token && (process.env.YAHOO_ADS_CLIENT_ID || process.env.YAHOO_ADS_ACCESS_TOKEN));

    const metaAssign = assignments.find((a) => a.platform === "meta");

    const hasMicrosoft = !!(
      process.env.MICROSOFT_ADS_CLIENT_ID &&
      process.env.MICROSOFT_ADS_CLIENT_SECRET &&
      process.env.MICROSOFT_ADS_REFRESH_TOKEN &&
      process.env.MICROSOFT_ADS_CUSTOMER_ID
    );

    // この Target に紐づくアカウント・認証元のみ（他ドメインと共有しない）
    let googleAccounts = [];
    let yahooAccounts = [];
    const googleAssignment = assignments.find((a) => a.platform === "google");
    const yahooAssignment = assignments.find((a) => a.platform === "yahoo");
    try {
      const { listAccountsForCompanyUrl: listGoogleForUrl } = require("../googleAdsAccounts");
      googleAccounts = (await listGoogleForUrl(companyUrlId)).map((a) => ({
        ...a,
        is_selected: googleAssignment ? a.id === googleAssignment.ads_account_id : false,
      }));
    } catch (_) {}
    try {
      const { listAccountsForCompanyUrl: listYahooForUrl } = require("../yahooAdsAccounts");
      yahooAccounts = (await listYahooForUrl(companyUrlId)).map((a) => ({
        ...a,
        is_selected: yahooAssignment ? a.id === yahooAssignment.ads_account_id : false,
      }));
    } catch (_) {}

    return {
      google: {
        connected: hasGoogle,
        customer_id: googleAcc?.customer_id || null,
        login_customer_id: googleAcc?.login_customer_id || null,
        accounts: googleAccounts,
        auth_sources: allAuthSources.filter((s) => s.platform === "google"),
        account_debug: googleAcc ? { account_id: googleAcc.id, name: googleAcc.name, customer_id: googleAcc.customer_id, has_refresh_token: !!googleAcc.refresh_token } : null,
      },
      yahoo: {
        connected: hasYahoo,
        accounts: yahooAccounts,
        auth_sources: allAuthSources.filter((s) => s.platform === "yahoo"),
      },
      meta: {
        meta_ad_account_id: metaAssign?.meta_ad_account_id || null,
        auth_sources: allAuthSources.filter((s) => s.platform === "meta"),
      },
      microsoft: { connected: !!hasMicrosoft },
      assignments,
    };
  }

  // ── 従来の userId ベースの接続状態判定 ──
  let hasGoogle =
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    (process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID) &&
    (process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET) &&
    (process.env.GOOGLE_ADS_REFRESH_TOKEN && process.env.GOOGLE_ADS_CUSTOMER_ID);

  let googleCustomerId = null;
  let googleLoginCustomerId = null;
  let googleAccounts = [];
  let googleAuthSources = [];
  let accountDebug = null;
  if (userId) {
    try {
      const { listAccounts, getSelectedAccount } = require("../googleAdsAccounts");
      const apiAuthSources = require("../apiAuthSources");
      const allGoogleAuth = await apiAuthSources.listAll("google");
      const userGoogleAuth = await apiAuthSources.list(userId, "google");
      googleAuthSources = allGoogleAuth.length > 0 ? allGoogleAuth : userGoogleAuth;
      const accounts = await listAccounts(userId);
      googleAccounts = accounts;
      const selectedAcc = await getSelectedAccount(userId);
      if (selectedAcc) {
        accountDebug = {
          account_id: selectedAcc.id,
          name: selectedAcc.name,
          customer_id: selectedAcc.customer_id || null,
          login_customer_id: selectedAcc.login_customer_id || null,
          has_refresh_token: !!selectedAcc.refresh_token,
          hint: !selectedAcc.login_customer_id
            ? "MCC配下のアカウントの場合、login_customer_id（MCC ID）が必要です。API認証元にMCC IDを登録してください。"
            : null,
        };
        googleCustomerId = selectedAcc.customer_id || googleCustomerId;
        googleLoginCustomerId = selectedAcc.login_customer_id || googleLoginCustomerId;
        if (selectedAcc.refresh_token && process.env.GOOGLE_ADS_DEVELOPER_TOKEN) hasGoogle = true;
      } else if (accounts.length) {
        const sel = accounts.find((a) => a.is_selected) || accounts[0];
        accountDebug = {
          account_id: sel.id,
          name: sel.name,
          customer_id: sel.customer_id || null,
          login_customer_id: sel.login_customer_id || null,
          has_refresh_token: !!sel.api_auth_source_id,
          hint: !sel.login_customer_id
            ? "MCC配下のアカウントの場合、login_customer_id（MCC ID）が必要です。API認証元の「MCC設定」でMCC IDを登録してください。"
            : "アカウントが選択されていない可能性があります。一覧のラジオボタンで選択し、画面を更新してください。",
        };
        hasGoogle = !!(process.env.GOOGLE_ADS_DEVELOPER_TOKEN && accounts.some((a) => a.customer_id));
        const selected = accounts.find((a) => a.is_selected) || accounts[0];
        if (selected) {
          googleCustomerId = selected.customer_id;
          googleLoginCustomerId = selected.login_customer_id;
        }
      }
      if (googleAuthSources.length && !hasGoogle) {
        hasGoogle = !!(process.env.GOOGLE_ADS_DEVELOPER_TOKEN && googleAuthSources.length > 0);
      }
      if (!googleCustomerId) {
        const { getTokensForUser } = require("../googleAdsOAuth");
        const tokens = await getTokensForUser(userId);
        if (tokens?.refresh_token && process.env.GOOGLE_ADS_DEVELOPER_TOKEN) hasGoogle = true;
        if (tokens?.customer_id) googleCustomerId = tokens.customer_id;
        if (tokens?.login_customer_id) googleLoginCustomerId = tokens.login_customer_id;
      }
      // アカウント・認証元が両方空 = ユーザーが連携解除した状態。APIは叩かない
      if (googleAccounts.length === 0 && googleAuthSources.length === 0) {
        hasGoogle = false;
        googleCustomerId = null;
        googleLoginCustomerId = null;
        accountDebug = null;
      }
    } catch (e) {
      console.warn("[ads] getConnectionStatus error:", e.message);
    }
  }

  let hasYahoo = !!(process.env.YAHOO_ADS_ACCESS_TOKEN && process.env.YAHOO_ADS_ACCOUNT_ID);
  let yahooAccounts = [];
  let yahooAuthSources = [];
  if (userId) {
    try {
      const yahooAdsAccounts = require("../yahooAdsAccounts");
      const apiAuthSources = require("../apiAuthSources");
      const allYahooAuth = await apiAuthSources.listAll("yahoo");
      const userYahooAuth = await apiAuthSources.list(userId, "yahoo");
      yahooAuthSources = allYahooAuth.length > 0 ? allYahooAuth : userYahooAuth;
      yahooAccounts = await yahooAdsAccounts.listAccounts(userId);
      const selectedYahoo = await yahooAdsAccounts.getSelectedAccount(userId);
      if (selectedYahoo?.refresh_token && process.env.YAHOO_ADS_CLIENT_ID) hasYahoo = true;
    } catch (e) {
      if (process.env.NODE_ENV !== "production") console.warn("[ads] getConnectionStatus yahoo error:", e.message);
    }
  }
  if (yahooAuthSources.length && !hasYahoo) {
    hasYahoo = !!(process.env.YAHOO_ADS_CLIENT_ID && process.env.YAHOO_ADS_CLIENT_SECRET && yahooAccounts.some((a) => a.account_id));
  }
  const hasMicrosoft =
    process.env.MICROSOFT_ADS_CLIENT_ID &&
    process.env.MICROSOFT_ADS_CLIENT_SECRET &&
    process.env.MICROSOFT_ADS_REFRESH_TOKEN &&
    process.env.MICROSOFT_ADS_CUSTOMER_ID;

  return {
    google: {
      connected: !!hasGoogle,
      customer_id: googleCustomerId,
      login_customer_id: googleLoginCustomerId,
      accounts: googleAccounts,
      auth_sources: googleAuthSources,
      account_debug: accountDebug,
    },
    yahoo: {
      connected: !!hasYahoo,
      accounts: yahooAccounts,
      auth_sources: yahooAuthSources,
    },
    microsoft: { connected: !!hasMicrosoft },
  };
}

module.exports = {
  fetchAllReports,
  getConnectionStatus,
  getDateRangeForMonth,
  getDateRangeFromDates,
};
