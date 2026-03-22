/**
 * 運用型広告 媒体別データ取得の集約
 */
const { fetchGoogleAdsReport, fetchGoogleAdsReportWithMeta } = require("./googleAds");
const { fetchYahooAdsReport, fetchYahooAdsReportWithMeta } = require("./yahooAds");
const { fetchMicrosoftAdsReport } = require("./microsoftAds");

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

  const status = await getConnectionStatus(userId);
  const fetchGoogle = status.google?.connected ?? false;
  const fetchYahoo = status.yahoo?.connected ?? false;
  const fetchMicrosoft = status.microsoft?.connected ?? false;

  const mediaCalled = [];
  if (fetchGoogle) mediaCalled.push("google");
  if (fetchYahoo) mediaCalled.push("yahoo");
  if (fetchMicrosoft) mediaCalled.push("microsoft");
  if (mediaCalled.length > 0) {
    console.log("[Ads] API呼び出し:", mediaCalled.join(", "), `(${startDate}〜${endDate})`);
  }

  const promises = [];
  if (fetchGoogle) promises.push(fetchGoogleAdsReportWithMeta(startDate, endDate, userId, options));
  else promises.push(Promise.resolve({ rows: [], customerId: null }));
  if (fetchYahoo) promises.push(fetchYahooAdsReportWithMeta(startDate, endDate, userId, options));
  else promises.push(Promise.resolve({ rows: [], customerId: null }));
  if (fetchMicrosoft) promises.push(fetchMicrosoftAdsReport(startDate, endDate));
  else promises.push(Promise.resolve([]));

  const [googleResult, yahooResult, microsoft] = await Promise.all(promises);

  const googleRows = googleResult.rows || [];
  const yahooRows = yahooResult.rows || [];
  const microsoftRows = Array.isArray(microsoft) ? microsoft : [];
  const res = {
    rows: [...googleRows, ...yahooRows, ...microsoftRows],
    meta: {
      google_customer_id: googleResult.customerId || null,
      yahoo_account_id: yahooResult.customerId || null,
      requested_startDate: startDate,
      requested_endDate: endDate,
      google_row_count: googleRows.length,
      yahoo_row_count: yahooRows.length,
      microsoft_row_count: microsoftRows.length,
      _media_called: mediaCalled,
    },
    _debug: googleResult._debug,
  };
  if (googleResult._hint) res._hint = googleResult._hint;
  if (yahooResult._hint && !res._hint) res._hint = yahooResult._hint;
  else if (yahooResult._hint) res._hint = (res._hint || "") + " " + yahooResult._hint;
  if (yahooResult._debug) res._yahoo_debug = yahooResult._debug;
  return res;
}

async function getConnectionStatus(userId = null) {
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
      googleAuthSources = await apiAuthSources.list(userId, "google");
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
      yahooAuthSources = await apiAuthSources.list(userId, "yahoo");
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
