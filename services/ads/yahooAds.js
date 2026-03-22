/**
 * Yahoo! JAPAN Ads API 連携
 * ReportDefinitionService でキャンペーンレポート取得
 * ref: https://ads-developers.yahoo.co.jp/en/ads-api/
 */

const API_BASE = "https://ads-search.yahooapis.jp/api/v19";

async function getAccessToken(acc, userId) {
  const expiry = acc.expiry_date ? Number(acc.expiry_date) : 0;
  let accessToken = acc.access_token || null;
  if (expiry && Date.now() >= expiry - 5 * 60 * 1000) {
    const { refreshAccessToken } = require("../yahooAdsOAuth");
    const refreshed = await refreshAccessToken(acc.refresh_token);
    if (refreshed?.access_token) {
      accessToken = refreshed.access_token;
      const apiAuthSources = require("../apiAuthSources");
      if (acc.api_auth_source_id && userId) {
        await apiAuthSources.updateTokens(acc.api_auth_source_id, userId, {
          access_token: refreshed.access_token,
          expiry_date: refreshed.expiry_date,
        });
      }
    }
  }
  return accessToken || acc.access_token;
}

/**
 * Yahoo Ads の診断用：API 呼び出しの詳細を返す
 */
async function fetchYahooAdsReportWithMeta(startDate, endDate, userId = null, options = {}) {
  const wantDebug = !!(options && options.debug);
  const connectionTest = !!(options && options.connectionTest);
  let acc = null;
  if (userId) {
    try {
      const { getSelectedAccount } = require("../yahooAdsAccounts");
      acc = await getSelectedAccount(userId);
    } catch (e) {
      if (process.env.NODE_ENV !== "production") console.warn("[Yahoo Ads] getSelectedAccount error:", e.message);
    }
  }

  if (!acc?.refresh_token) {
    const accessToken = (process.env.YAHOO_ADS_ACCESS_TOKEN || "").trim();
    const accountId = (process.env.YAHOO_ADS_ACCOUNT_ID || "").trim();
    const baseAccountId = (process.env.YAHOO_ADS_BASE_ACCOUNT_ID || accountId || "").trim();
    if (!accessToken || !accountId) {
      return { rows: [], customerId: null };
    }
    acc = {
      account_id: accountId,
      agency_account_id: baseAccountId || accountId,
      access_token: accessToken,
      refresh_token: null,
      api_auth_source_id: null,
      user_id: null,
    };
  }

  const accountId = String(acc.account_id || "").trim();
  let baseAccountId = String(acc.agency_account_id || acc.account_id || "").trim();
  if (baseAccountId.includes("-")) {
    const numPart = baseAccountId.split("-").pop();
    if (/^\d+$/.test(numPart)) baseAccountId = numPart;
  }
  const accessToken = await getAccessToken(acc, userId);

  if (!accessToken || !accountId) {
    return { rows: [], customerId: accountId || null };
  }

  try {
    const start = startDate.replace(/-/g, "");
    const end = endDate.replace(/-/g, "");
    console.log("[Yahoo Ads] レポート取得開始:", accountId, `${startDate}〜${endDate}`, "x-z-base-account-id:", baseAccountId || "(未設定)");

    const fields = ["CAMPAIGN_ID", "CAMPAIGN_NAME", "IMPRESSIONS", "CLICKS", "COST", "CONVERSIONS"];
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "x-z-base-account-id": baseAccountId,
    };

    const addBody = {
      accountId: Number(accountId) || accountId,
      operand: [
        {
          reportName: `CampaignReport_${start}_${end}`,
          reportType: "CAMPAIGN",
          reportDateRangeType: "CUSTOM_DATE",
          dateRange: { startDate: start, endDate: end },
          fields,
        },
      ],
    };
    if (process.env.NODE_ENV !== "production") {
      console.log("[Yahoo Ads] Add request body:", JSON.stringify(addBody));
    }

    const addRes = await fetch(`${API_BASE}/ReportDefinitionService/add`, {
      method: "POST",
      headers,
      body: JSON.stringify(addBody),
    });

    const addText = await addRes.text();
    let addData;
    try {
      addData = JSON.parse(addText);
    } catch {
      addData = {};
    }

    if (!addRes.ok) {
      console.warn("[Yahoo Ads] ReportDefinitionService/add error:", addRes.status, addText?.slice(0, 300), "accountId:", accountId, "x-z-base-account-id:", baseAccountId, "addBody:", JSON.stringify(addBody));
      let hint = "Yahoo Ads API でレポート作成に失敗しました。";
      try {
        const errCode = addData?.errors?.[0]?.code || addData?.error?.code;
        const errMsg = addData?.errors?.[0]?.message || addData?.error?.message || addText?.slice(0, 200);
        if (errCode === "0004" && /URL not found|404/.test(errMsg || "")) {
          hint = "API のURLパスが変更された可能性があります。";
        } else if (/MCC account is not permitted/i.test(errMsg || addText || "")) {
          hint = "MCC account is not permitted: addBody またはヘッダーに代理店IDが混入していないか確認してください。addBody.accountId=" + accountId + ", x-z-base-account-id=" + baseAccountId;
        } else if (errMsg) hint = errMsg;
      } catch (_) {}
      return {
        rows: [],
        customerId: accountId,
        _hint: hint,
        _debug: wantDebug ? { add_status: addRes.status, add_response: addText?.slice(0, 800) } : undefined,
      };
    }

    if (addData?.errors && addData.errors.length > 0) {
      const err = addData.errors[0];
      const errCode = err?.code ?? err?.errorCode ?? "";
      const errMsg = err?.message ?? err?.errorMessage ?? err?.detail ?? JSON.stringify(err);
      const details = err?.details ?? [];
      const baseAccountErr = details.find((d) => (d?.requestKey || d?.request_key) === "x-z-base-account-id");
      let hint = `Yahoo Ads API エラー: [${errCode}] ${errMsg}`;
      if (baseAccountErr) {
        hint += ` x-z-base-account-id は数値形式が必要です。代理店アカウントには「1002467041」のように数値のみを入力するか、belga8241waler-1002467041 の形式（ハイフン後の数値部分が使用されます）で入力してください。`;
      }
      console.warn("[Yahoo Ads] Add errors:", addData.errors);
      return {
        rows: [],
        customerId: accountId,
        _hint: hint,
        _debug: wantDebug ? { add_response: addData, errors: addData.errors } : undefined,
      };
    }

    function findReportId(obj, depth = 0) {
      if (depth > 10 || !obj || typeof obj !== "object") return null;
      if (obj.reportJobId != null && obj.reportJobId !== "") return String(obj.reportJobId);
      if (obj.reportId != null && obj.reportId !== "") return String(obj.reportId);
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) {
          for (const item of v) {
            const r = findReportId(item, depth + 1);
            if (r) return r;
          }
        } else if (v && typeof v === "object") {
          const r = findReportId(v, depth + 1);
          if (r) return r;
        }
      }
      return null;
    }

    const reportId =
      addData?.rval?.values?.[0]?.reportDefinition?.reportJobId ??
      addData?.rval?.values?.[0]?.reportDefinition?.reportJobID ??
      addData?.rval?.values?.[0]?.reportDefinition?.reportId ??
      addData?.rval?.values?.[0]?.reportJobId ??
      addData?.rval?.values?.[0]?.reportId ??
      addData?.reportDefinition?.reportJobId ??
      addData?.reportJobId ??
      findReportId(addData);
    let reportIdStr = reportId != null ? String(reportId) : null;
    const rid = addData?.rid ? String(addData.rid) : null;

    let isNumericId = reportIdStr && /^\d+$/.test(reportIdStr);
    let useRid = !isNumericId && rid;

    if (!reportIdStr && !useRid) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[Yahoo Ads] add response:", JSON.stringify(addData).slice(0, 1200));
      }
      return {
        rows: [],
        customerId: accountId,
        _hint: "Yahoo Ads レポートIDの取得に失敗しました。APIレスポンスに reportJobId または rid が見つかりません。",
        _debug: wantDebug ? { add_status: addRes?.status, add_response: addData } : undefined,
      };
    }

    const reportName = `CampaignReport_${start}_${end}`;
    const diagnosticOnly = !!connectionTest;
    let jobStatus = "IN_PROGRESS";
    let attempts = 0;
    const maxAttempts = diagnosticOnly ? 1 : 60;
    let getError = null;
    let lastGetValues = [];

    while ((jobStatus === "IN_PROGRESS" || jobStatus === "WAITING" || jobStatus === "WAIT") && attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, attempts === 0 ? (diagnosticOnly ? 500 : 3000) : 2000));
      attempts++;

      const getBody = useRid
        ? { accountId: Number(accountId) || accountId, reportTypes: ["CAMPAIGN"], numberResults: 500 }
        : { accountId: Number(accountId) || accountId, reportJobIds: [Number(reportIdStr)] };
      const getRes = await fetch(`${API_BASE}/ReportDefinitionService/get`, {
        method: "POST",
        headers,
        body: JSON.stringify(getBody),
      });

      const getText = await getRes.text();
      if (!getRes.ok) {
        getError = { status: getRes.status, body: getText?.slice(0, 600) };
        console.warn("[Yahoo Ads] ReportDefinitionService/get error:", getRes.status, getText?.slice(0, 300));
        break;
      }
      if (diagnosticOnly) {
        return {
          rows: [],
          customerId: accountId,
          _hint: "接続OK: Add・Get API は正常に動作しています。レポート取得には時間がかかります。",
          _connectionOk: true,
          _debug: wantDebug ? { add_ok: true, get_ok: true, rid } : undefined,
        };
      }

      let getData;
      try {
        getData = JSON.parse(getText);
      } catch {
        getData = {};
      }
      const values = getData?.rval?.values ?? getData?.reportDefinitions ?? getData?.value ?? [];
      if (values.length > 0) lastGetValues = values;
      let greport = null;
      if (useRid && Array.isArray(values) && values.length > 0) {
        const getReportDef = (v) => v?.reportDefinition || v;
        const getName = (d) => d?.reportName || d?.report_name || "";
        const getStatus = (d) => d?.reportJobStatus || d?.jobStatus || d?.status;
        const nameMatches = (d) => {
          const name = getName(d);
          return name === reportName || (name && (name.includes(start) || name.includes(end)));
        };
        let match = values.find((v) => {
          const def = getReportDef(v);
          return nameMatches(def) && ["COMPLETED", "COMPLETED_WITH_EXCLUDED_DATA"].includes(getStatus(def));
        });
        if (!match) {
          match = values.find((v) => {
            const def = getReportDef(v);
            return ["COMPLETED", "COMPLETED_WITH_EXCLUDED_DATA"].includes(getStatus(def));
          });
        }
        if (match) {
          greport = getReportDef(match);
          if (greport?.reportJobId != null) {
            reportIdStr = String(greport.reportJobId);
            useRid = false;
            isNumericId = true;
            jobStatus = "COMPLETED";
            break;
          }
        }
        const inProgress = values.find((v) => {
          const def = getReportDef(v);
          return nameMatches(def) || (getName(def) && getName(def).includes("CampaignReport"));
        });
        greport = inProgress ? getReportDef(inProgress) : null;
      } else {
        const gv0 = values[0];
        greport = gv0?.reportDefinition || gv0 || getData?.reportDefinitions?.[0] || getData?.value?.[0] || getData;
      }
      jobStatus = greport?.reportJobStatus || greport?.jobStatus || greport?.status || "IN_PROGRESS";
      if (jobStatus === "COMPLETED" || jobStatus === "COMPLETED_WITH_EXCLUDED_DATA") {
        if (useRid && greport?.reportJobId != null) {
          reportIdStr = String(greport.reportJobId);
          useRid = false;
          isNumericId = true;
        }
        break;
      }
      if (jobStatus === "FAILED" || jobStatus === "REJECTED") {
        console.warn("[Yahoo Ads] Report job failed:", jobStatus, getData);
        return { rows: [], customerId: accountId };
      }
    }

    if (jobStatus !== "COMPLETED" && jobStatus !== "COMPLETED_WITH_EXCLUDED_DATA") {
      console.warn("[Yahoo Ads] Report job not completed:", jobStatus, "after", attempts, "attempts");
      let hint = "Yahoo Ads レポートの生成がタイムアウトしました。しばらく待って再試行してください。";
      if (getError) {
        hint = `Get API がエラーを返しました (HTTP ${getError.status})。API バージョンやパラメータを確認してください。`;
      }
      const getSnippet =
        useRid && lastGetValues.length > 0
          ? { count: lastGetValues.length, sample: lastGetValues.slice(0, 5).map((v) => ({ name: (v?.reportDefinition || v)?.reportName, status: (v?.reportDefinition || v)?.reportJobStatus })) }
          : null;
      return {
        rows: [],
        customerId: accountId,
        _hint: hint,
        _debug: wantDebug || useRid
          ? { getError, reportId: reportIdStr || rid, attempts, reportName, getSnippet }
          : (getError ? { getError, reportId: reportIdStr || rid } : null),
      };
    }

    const downloadBody = useRid
      ? { accountId: Number(accountId) || accountId, rid }
      : { accountId: Number(accountId) || accountId, reportJobId: Number(reportIdStr) };
    const downloadRes = await fetch(`${API_BASE}/ReportDefinitionService/download`, {
      method: "POST",
      headers,
      body: JSON.stringify(downloadBody),
    });

    if (!downloadRes.ok) {
      const errText = await downloadRes.text();
      console.warn("[Yahoo Ads] ReportDefinitionService/download error:", downloadRes.status, errText);
      return { rows: [], customerId: accountId };
    }

    const contentType = downloadRes.headers.get("content-type") || "";
    let rows = [];

    if (contentType.includes("application/json")) {
      const data = await downloadRes.json();
      const reports = data?.reportDefinitions || data?.value || data?.rows || (Array.isArray(data) ? data : []);
      const byCampaign = new Map();
      for (const r of reports) {
        const cid = String(r.CAMPAIGN_ID || r.campaignId || r.campaign_id || "0");
        const name = r.CAMPAIGN_NAME || r.campaignName || r.campaign_name || "";
        if (!byCampaign.has(cid)) byCampaign.set(cid, { name, impressions: 0, clicks: 0, cost: 0, conversions: 0 });
        const acc = byCampaign.get(cid);
        acc.impressions += Number(r.IMPRESSIONS || r.impressions || 0);
        acc.clicks += Number(r.CLICKS || r.clicks || 0);
        acc.cost += Number(r.COST || r.cost || 0);
        acc.conversions += Number(r.CONVERSIONS || r.conversions || 0);
      }
      for (const [, v] of byCampaign) {
        rows.push({
          media: "Yahoo! 広告",
          campaign: v.name,
          impressions: v.impressions,
          clicks: v.clicks,
          cost: v.cost,
          conversions: v.conversions,
        });
      }
    } else {
      const text = await downloadRes.text();
      const lines = text.trim().split(/\r?\n/);
      if (lines.length > 1) {
        const header = lines[0].toLowerCase();
        const impIdx = header.split(",").findIndex((c) => /impression|impressions/.test(c));
        const clickIdx = header.split(",").findIndex((c) => /click|clicks/.test(c));
        const costIdx = header.split(",").findIndex((c) => /cost|spend/.test(c));
        const convIdx = header.split(",").findIndex((c) => /conversion|conversions/.test(c));
        const nameIdx = header.split(",").findIndex((c) => /campaign|name/.test(c));
        const idIdx = header.split(",").findIndex((c) => /campaign.?id|id/.test(c));

        const byCampaign = new Map();
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
          const cid = cols[idIdx] || cols[0] || "0";
          const name = (cols[nameIdx] || cols[1] || "").replace(/^"|"$/g, "");
          if (!byCampaign.has(cid)) byCampaign.set(cid, { name, impressions: 0, clicks: 0, cost: 0, conversions: 0 });
          const acc = byCampaign.get(cid);
          acc.impressions += Number(cols[impIdx] || cols[impIdx >= 0 ? impIdx : 2] || 0);
          acc.clicks += Number(cols[clickIdx] || cols[clickIdx >= 0 ? clickIdx : 3] || 0);
          acc.cost += Number(cols[costIdx] || cols[costIdx >= 0 ? costIdx : 4] || 0);
          acc.conversions += Number(cols[convIdx] || cols[convIdx >= 0 ? convIdx : 5] || 0);
        }
        for (const [, v] of byCampaign) {
          rows.push({
            media: "Yahoo! 広告",
            campaign: v.name,
            impressions: v.impressions,
            clicks: v.clicks,
            cost: v.cost,
            conversions: v.conversions,
          });
        }
      }
    }

    if (rows.length > 0) {
      console.log(`[Yahoo Ads] 取得完了: ${rows.length}件 (${startDate}〜${endDate})`);
    } else {
      console.log(`[Yahoo Ads] 取得完了: 0件 (${startDate}〜${endDate})`);
    }
    return { rows, customerId: accountId };
  } catch (err) {
    console.error("[Yahoo Ads] API error:", err.message);
    return {
      rows: [],
      customerId: accountId || null,
      _hint: "Yahoo Ads API エラー: " + (err.message || "不明"),
      _debug: wantDebug ? { error: err.message, stack: err.stack } : undefined,
    };
  }
}

async function fetchYahooAdsReport(startDate, endDate, userId = null) {
  const { rows } = await fetchYahooAdsReportWithMeta(startDate, endDate, userId);
  return rows;
}

/**
 * AccountService/get で権限を診断（MCC許可の切り分け用）
 * 200+アカウント情報 → 接続OK、MCCレポートAPI未承認の可能性
 * 403 Account not found / Access denied → トークンに1438170への権限なし
 * 403 MCC account is not permitted → 接続OKだがMCC権限未申請
 */
async function testYahooAccountService(userId) {
  let acc = null;
  if (userId) {
    try {
      const { getSelectedAccount } = require("../yahooAdsAccounts");
      acc = await getSelectedAccount(userId);
    } catch (e) {
      return { ok: false, error: "getSelectedAccount error: " + e.message };
    }
  }
  if (!acc?.refresh_token && !acc?.access_token) {
    const at = (process.env.YAHOO_ADS_ACCESS_TOKEN || "").trim();
    const aid = (process.env.YAHOO_ADS_ACCOUNT_ID || "").trim();
    const bid = (process.env.YAHOO_ADS_BASE_ACCOUNT_ID || aid || "").trim();
    if (!at || !aid) return { ok: false, error: "Yahoo認証情報がありません" };
    acc = { account_id: aid, agency_account_id: bid, access_token: at, refresh_token: null };
  }
  const accountId = String(acc.account_id || "").trim();
  let baseAccountId = String(acc.agency_account_id || acc.account_id || "").trim();
  if (baseAccountId.includes("-")) {
    const numPart = baseAccountId.split("-").pop();
    if (/^\d+$/.test(numPart)) baseAccountId = numPart;
  }
  const accessToken = await getAccessToken(acc, userId);
  if (!accessToken) return { ok: false, error: "アクセストークンが取得できません" };
  const url = `${API_BASE}/AccountService/get`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "x-z-base-account-id": baseAccountId,
  };
  const body = { accountIds: [Number(accountId) || accountId] };
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { _raw: text };
    }
    return {
      ok: res.ok,
      status: res.status,
      accountId,
      baseAccountId,
      body,
      response: data,
      interpretation:
        res.ok
          ? "200+アカウント情報 → 接続権限あり。MCCのレポートAPI申請が未承認の可能性"
          : /Account not found|Access denied/i.test(text)
            ? "このトークンでは" + accountId + "へのアクセス権限がない"
            : /MCC account is not permitted/i.test(text)
              ? "接続はできているがMCC権限が未申請"
              : null,
    };
  } catch (e) {
    return { ok: false, error: e.message, accountId, baseAccountId };
  }
}

module.exports = { fetchYahooAdsReport, fetchYahooAdsReportWithMeta, testYahooAccountService };
