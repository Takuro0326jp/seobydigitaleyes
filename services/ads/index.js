/**
 * 運用型広告 媒体別データ取得の集約
 */
const { fetchGoogleAdsReport, fetchGoogleAdsReportWithMeta } = require("./googleAds");
const { fetchYahooAdsReport } = require("./yahooAds");
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

  const [googleResult, yahoo, microsoft] = await Promise.all([
    fetchGoogleAdsReportWithMeta(startDate, endDate, userId, options),
    fetchYahooAdsReport(startDate, endDate),
    fetchMicrosoftAdsReport(startDate, endDate),
  ]);

  const res = {
    rows: [...(googleResult.rows || []), ...yahoo, ...microsoft],
    meta: { google_customer_id: googleResult.customerId || null },
    _debug: googleResult._debug,
  };
  if (googleResult._hint) res._hint = googleResult._hint;
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
        const { getTokensForUser } = require("./googleAdsOAuth");
        const tokens = await getTokensForUser(userId);
        if (tokens?.refresh_token && process.env.GOOGLE_ADS_DEVELOPER_TOKEN) hasGoogle = true;
        if (tokens?.customer_id) googleCustomerId = tokens.customer_id;
        if (tokens?.login_customer_id) googleLoginCustomerId = tokens.login_customer_id;
      }
    } catch (e) {
      console.warn("[ads] getConnectionStatus error:", e.message);
    }
  }

  const hasYahoo = process.env.YAHOO_ADS_ACCESS_TOKEN && process.env.YAHOO_ADS_ACCOUNT_ID;
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
    yahoo: { connected: !!hasYahoo },
    microsoft: { connected: !!hasMicrosoft },
  };
}

module.exports = {
  fetchAllReports,
  getConnectionStatus,
  getDateRangeForMonth,
  getDateRangeFromDates,
};
