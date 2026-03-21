/**
 * Google Ads API 連携
 * 1. 環境変数から取得（GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_*）
 * 2. userId 指定時は google_ads_tokens からトークンを取得
 */
const pool = require("../../db");

async function fetchGoogleAdsReportWithMeta(startDate, endDate, userId = null, options = {}) {
  const wantDebug = !!(options && options.debug);
  const developerToken = (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
  const clientId = (process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "").trim();

  let refreshToken = (process.env.GOOGLE_ADS_REFRESH_TOKEN || "").trim();
  let customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || "").trim().replace(/-/g, "");
  let loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").trim().replace(/-/g, "");

  if (userId) {
    try {
      const { getSelectedAccount } = require("../googleAdsAccounts");
      const acc = await getSelectedAccount(userId);
      if (acc?.refresh_token) {
        refreshToken = acc.refresh_token;
        customerId = String(acc.customer_id || "").trim().replace(/-/g, "") || customerId;
        const lid = String(acc.login_customer_id ?? "").trim().replace(/-/g, "");
        if (lid) loginCustomerId = lid;
        if (process.env.NODE_ENV !== "production") {
          console.log("[Google Ads] アカウント使用:", {
            account_id: acc?.id,
            customer_id: customerId,
            login_customer_id: loginCustomerId || "(未設定)",
            has_refresh: !!refreshToken,
          });
        }
      }
    } catch (e) {
      if (process.env.NODE_ENV !== "production") console.warn("[Google Ads] getSelectedAccount error:", e.message);
    }
    if (!refreshToken || !customerId) {
      const [rows] = await pool.query(
        "SELECT customer_id, login_customer_id, refresh_token FROM google_ads_tokens WHERE user_id = ? AND refresh_token IS NOT NULL LIMIT 1",
        [userId]
      );
      if (rows.length) {
        refreshToken = rows[0].refresh_token || "";
        const dbCid = (rows[0].customer_id || "").trim().replace(/-/g, "");
        customerId = dbCid || customerId;
        const dbLid = (rows[0].login_customer_id || "").trim().replace(/-/g, "");
        if (dbLid) loginCustomerId = dbLid;
      }
    }
  }

  if (!developerToken || !clientId || !clientSecret || !refreshToken || !customerId) {
    return {
      rows: [],
      customerId: null,
      _debug: wantDebug ? {
        error: "missing_config",
        hint: "developerToken/clientId/clientSecret/refreshToken/customerId のいずれかが未設定",
        has_developer_token: !!developerToken,
        has_client_id: !!clientId,
        has_client_secret: !!clientSecret,
        has_refresh_token: !!refreshToken,
        has_customer_id: !!customerId,
        has_login_customer_id: !!loginCustomerId,
      } : undefined,
    };
  }

  try {
    const { GoogleAdsApi } = require("google-ads-api");
    const client = new GoogleAdsApi({
      client_id: clientId,
      client_secret: clientSecret,
      developer_token: developerToken,
    });

    const customerOptions = {
      customer_id: customerId,
      refresh_token: refreshToken,
    };
    if (loginCustomerId) {
      customerOptions.login_customer_id = loginCustomerId;
    }
    const customer = client.Customer(customerOptions);

    /** MCC（マネージャー）アカウントかどうか判定。MCC の場合は metrics を取得できない */
    const toArray = (r) => {
      if (Array.isArray(r)) return r;
      if (r?.results?.length) return r.results;
      if (r?.response?.length) return r.response;
      if (r?.rows?.length) return r.rows;
      return [];
    };
    let isManagerAccount = false;
    try {
      const custResult = await customer.query("SELECT customer.id, customer.manager FROM customer LIMIT 1");
      let custRows = toArray(custResult);
      if (!custRows.length && custResult && typeof custResult[Symbol.asyncIterator] === "function") {
        custRows = [];
        for await (const row of custResult) custRows.push(row);
      } else if (!custRows.length && custResult && typeof custResult[Symbol.iterator] === "function") {
        custRows = [...custResult];
      }
      const custRow = custRows[0];
      if (custRow?.customer?.manager === true || custRow?.manager === true) {
        isManagerAccount = true;
      }
    } catch (_) {
      /* 判定に失敗しても続行 */
    }

    if (isManagerAccount) {
      const hint =
        "Customer ID " +
        customerId +
        " は MCC（マネージャー）アカウントです。MCC 自身には広告実績がありません。MCC 配下のクライアント（広告運用）アカウントの Customer ID を連携してください。MCC ID は API 認証元の「MCC設定」に登録し、クライアント ID をアカウントとして追加してください。";
      return {
        rows: [],
        customerId,
        _debug: wantDebug ? { is_manager_account: true, hint } : undefined,
        _hint: hint,
      };
    }

    const pad = (s) => String(s).replace(/-/g, "");
    const startCompact = pad(startDate);
    const endCompact = pad(endDate);

    let campaigns = [];
    let result = null;
    let methodUsed = "query";
    /** report() を優先（ATOM 等で動く構成と同様、レスポンス形式が安定） */
    try {
      const reportResult = await customer.report({
        entity: "campaign",
        attributes: ["campaign.id", "campaign.name"],
        metrics: [
          "metrics.impressions",
          "metrics.clicks",
          "metrics.cost_micros",
          "metrics.conversions",
          "metrics.all_conversions",
        ],
        segments: ["segments.date"],
        from_date: startDate,
        to_date: endDate,
      });
      const reportRows = Array.isArray(reportResult) ? reportResult : toArray(reportResult);
      if (reportRows.length > 0) {
        campaigns = reportRows;
        result = reportResult;
        methodUsed = "report";
      }
    } catch (reportErr) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[Google Ads] report() fallback error:", reportErr.message);
      }
    }
    /** report で取れなければ GAQL query を試行 */
    const gaqlPrimary = `SELECT campaign.id, campaign.name,
      metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.all_conversions
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status != 'REMOVED'`;
    const gaqlCompact = `SELECT campaign.id, campaign.name,
      metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.all_conversions
    FROM campaign
    WHERE segments.date BETWEEN '${startCompact}' AND '${endCompact}'
      AND campaign.status != 'REMOVED'`;
    const gaqlLast30 = `SELECT campaign.id, campaign.name,
      metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.all_conversions
    FROM campaign
    WHERE segments.date DURING LAST_30_DAYS
      AND campaign.status != 'REMOVED'`;

    for (const [gaql, label] of [[gaqlPrimary, "BETWEEN"], [gaqlCompact, "BETWEEN_compact"], [gaqlLast30, "LAST_30_DAYS"]]) {
      try {
        result = await customer.query(gaql);
        if (Array.isArray(result)) {
          campaigns = result;
        } else if (result && typeof result[Symbol.asyncIterator] === "function") {
          campaigns = [];
          for await (const row of result) campaigns.push(row);
        } else if (result && typeof result[Symbol.iterator] === "function") {
          campaigns = [...result];
        } else {
          campaigns = toArray(result);
        }
        if (campaigns.length > 0) {
          if (process.env.NODE_ENV !== "production" && label === "LAST_30_DAYS") {
            console.log("[Google Ads] カスタム日付で0件だったため LAST_30_DAYS で取得");
          }
          break;
        }
      } catch (qErr) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[Google Ads] query error:", qErr.message);
        }
      }
    }

    if (campaigns.length === 0 && !result) {
      try {
        const reportOptions = {
          entity: "campaign",
          attributes: ["campaign.id", "campaign.name"],
          metrics: [
            "metrics.impressions",
            "metrics.clicks",
            "metrics.cost_micros",
            "metrics.conversions",
            "metrics.all_conversions",
          ],
          segments: ["segments.date"],
          from_date: startDate,
          to_date: endDate,
        };
        result = await customer.report(reportOptions);
        campaigns = Array.isArray(result) ? result : toArray(result);
      } catch (_) {}
    }
    const gaql = gaqlPrimary;
    if (process.env.NODE_ENV !== "production") {
      console.log("[Google Ads] campaigns count:", campaigns.length);
      if (campaigns.length > 0) {
        console.log("[Google Ads] first row:", JSON.stringify(campaigns[0], null, 2).slice(0, 500));
      }
    }
    let debugInfo;
    if (wantDebug) {
      debugInfo = {
        customer_id_used: customerId,
        login_customer_id_used: loginCustomerId || "(MCC未設定・MCC配下の場合は必須)",
      };
      let rawTruncated = "";
      try {
        rawTruncated = result && typeof result === "object" ? JSON.stringify(result).slice(0, 1500) : String(result || "null");
      } catch (e) {
        rawTruncated = "[JSON.stringify failed: " + (e.message || "?") + "]";
      }
      let firstRow = null;
      if (campaigns.length > 0) {
        try {
          firstRow = JSON.parse(JSON.stringify(campaigns[0]));
        } catch {
          firstRow = { _parse_error: "could not serialize first row" };
        }
      }
      debugInfo = {
        ...debugInfo,
        wantDebug: true,
        method: methodUsed || "query",
        date_range: { startDate, endDate },
        login_customer_id: loginCustomerId || "(未設定・MCC配下の場合は.envにGOOGLE_ADS_LOGIN_CUSTOMER_IDを指定)",
        raw_type: result && Array.isArray(result) ? "array" : (result ? "object" : "null"),
        raw_keys: result && typeof result === "object" && !Array.isArray(result) ? Object.keys(result) : null,
        raw_length: Array.isArray(result) ? result.length : (result?.results?.length ?? result?.response?.length ?? null),
        campaigns_length: campaigns.length,
        first_row: firstRow,
        raw_truncated: rawTruncated,
        hint_empty:
          campaigns.length === 0
            ? "指定期間にキャンペーンデータがありません。想定原因：(1) 期間内に広告実績がない (2) 全キャンペーンが削除済み (3) Customer ID が MCC の場合→MCC配下のクライアントIDを連携してください。別の月を選択するか、Google Ads 管理画面で確認してください。"
            : null,
        gaql_primary: gaqlPrimary,
      };
    } else {
      debugInfo = undefined;
    }
    const rows = [];
    const byCampaign = new Map();

    for (const row of campaigns) {
      const camp = row.campaign || row;
      const m = row.metrics || row;
      const cid = String(
        camp?.id ?? camp?.campaign_id ?? row.campaign_id ?? row["campaign.id"] ?? "0"
      );
      const name =
        camp?.name ?? camp?.campaign_name ?? row.campaign_name ?? row["campaign.name"] ?? "";
      if (!byCampaign.has(cid)) {
        byCampaign.set(cid, { name, impressions: 0, clicks: 0, cost: 0, conversions: 0 });
      }
      const acc = byCampaign.get(cid);
      acc.impressions += Number(
        m?.impressions ?? m?.impression_count ?? row.impressions ?? row["metrics.impressions"] ?? 0
      );
      acc.clicks += Number(
        m?.clicks ?? m?.click_count ?? row.clicks ?? row["metrics.clicks"] ?? 0
      );
      acc.cost +=
        Number(
          m?.cost_micros ?? m?.cost ?? row.cost_micros ?? row["metrics.cost_micros"] ?? 0
        ) / 1_000_000;
      acc.conversions += Number(
        m?.conversions ??
          m?.all_conversions ??
          row.conversions ??
          row.all_conversions ??
          row["metrics.conversions"] ??
          row["metrics.all_conversions"] ??
          0
      );
    }

    for (const [, v] of byCampaign) {
      rows.push({
        media: "Google Ads",
        campaign: v.name,
        impressions: v.impressions,
        clicks: v.clicks,
        cost: v.cost,
        conversions: v.conversions,
      });
    }
    const emptyHint =
      rows.length === 0
        ? "指定期間にキャンペーンデータがありません。別の月を試すか、Google Ads 管理画面で該当アカウントのキャンペーン・実績を確認してください。MCC の場合は、クライアント（広告運用）アカウント ID を連携してください。"
        : null;
    return {
      rows,
      customerId,
      _debug: debugInfo,
      _hint: emptyHint,
    };
  } catch (err) {
    console.error("[Google Ads] API error:", err.message);
    const isManagerError =
      (err.message || "").toLowerCase().includes("metrics cannot be requested for a manager account") ||
      (err.message || "").includes("manager account");
    if (isManagerError) {
      const hint =
        "Customer ID " +
        customerId +
        " は MCC（マネージャー）アカウントの可能性があります。MCC からは広告実績を取得できません。MCC 配下のクライアント（広告運用）アカウントの Customer ID を連携し、MCC ID を API 認証元の「MCC設定」に登録してください。";
      return {
        rows: [],
        customerId,
        _debug: wantDebug ? { error: err.message, is_manager_error: true, hint } : undefined,
        _hint: hint,
      };
    }
    let debugInfo;
    if (wantDebug) {
      const parts = {};
      parts.error_message = err.message;
      parts.error_name = err.name;
      if (err.response?.data) {
        parts.axios_data = err.response.data;
        parts.axios_error = err.response.data?.error;
        parts.axios_error_message = err.response.data?.error?.message;
        const details = err.response.data?.error?.details;
        if (Array.isArray(details) && details[0]) {
          parts.ga_error_detail = details[0];
        }
      }
      if (err.errors?.length) {
        parts.ga_errors = err.errors;
      }
      if (err.request_id) parts.request_id = err.request_id;
      try {
        parts.full_error = JSON.stringify(err, Object.getOwnPropertyNames(err), 2).slice(0, 2000);
      } catch {}
      debugInfo = parts;
    } else {
      debugInfo = undefined;
    }
    return { rows: [], customerId, _debug: debugInfo };
  }
}

async function fetchGoogleAdsReport(startDate, endDate, userId = null) {
  const { rows } = await fetchGoogleAdsReportWithMeta(startDate, endDate, userId);
  return rows;
}

/**
 * Customer ID が MCC 配下（またはアクセス可能）か検証する
 * 成功時 { valid: true }、失敗時 { valid: false, error: string, debug?: object }
 */
async function validateCustomerAccess(customerId, loginCustomerId, refreshToken, userId = null, options = {}) {
  const debug = !!(options && options.debug);
  const cid = (customerId || "").trim().replace(/-/g, "");
  const lid = (loginCustomerId || "").trim().replace(/-/g, "") || null;
  if (!cid) return { valid: false, error: "Customer ID を入力してください" };

  let rt = (refreshToken || "").trim();
  if (userId && !rt) {
    try {
      const { getSelectedAccount } = require("../googleAdsAccounts");
      const acc = await getSelectedAccount(userId);
      if (acc?.refresh_token) rt = acc.refresh_token;
    } catch (_) {}
    if (!rt) {
      const [rows] = await pool.query(
        "SELECT refresh_token FROM google_ads_tokens WHERE user_id = ? AND refresh_token IS NOT NULL LIMIT 1",
        [userId]
      );
      if (rows.length) rt = rows[0].refresh_token || "";
    }
  }
  if (!rt) {
    return { valid: false, error: "検証には Google 連携が必要です。先に「Google でアカウント連携」を完了してください" };
  }

  const developerToken = (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
  const clientId = (process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "").trim();
  if (!developerToken || !clientId || !clientSecret) {
    return { valid: false, error: "サーバー設定が不足しています" };
  }

  try {
    const { GoogleAdsApi } = require("google-ads-api");
    const client = new GoogleAdsApi({
      client_id: clientId,
      client_secret: clientSecret,
      developer_token: developerToken,
    });
    const customerOptions = { customer_id: cid, refresh_token: rt };
    if (lid) customerOptions.login_customer_id = lid;

    const customer = client.Customer(customerOptions);
    await customer.query("SELECT customer.id FROM customer LIMIT 1");
    return { valid: true };
  } catch (err) {
    const rawMsg = err.message || "";
    const msg = rawMsg.toLowerCase();
    let userMsg = "検証に失敗しました: " + rawMsg;
    if (
      msg.includes("permission") ||
      msg.includes("authorization") ||
      msg.includes("access denied") ||
      msg.includes("user does not have permission") ||
      msg.includes("not have permission") ||
      (err.response?.data?.error?.details && JSON.stringify(err.response.data.error.details).includes("PERMISSION"))
    ) {
      userMsg = "この Customer ID は MCC 配下にありません。MCC ID と Customer ID を確認してください";
    }
    const result = { valid: false, error: userMsg };
    if (debug) {
      result.debug = {
        message: rawMsg,
        response: err.response?.data ? JSON.stringify(err.response.data).slice(0, 1500) : null,
        errors: err.errors || null,
      };
    }
    if (process.env.NODE_ENV !== "production") {
      console.warn("[Google Ads] validateCustomerAccess error:", rawMsg, err.response?.data?.error || "");
    }
    return result;
  }
}

module.exports = { fetchGoogleAdsReport, fetchGoogleAdsReportWithMeta, validateCustomerAccess };
