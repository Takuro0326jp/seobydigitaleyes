/**
 * Yahoo! JAPAN Ads API 連携
 * ReportDefinitionService でキャンペーン・エリア・時間帯・キーワードレポート取得
 * ref: https://ads-developers.yahoo.co.jp/en/ads-api/
 */

const API_BASE = "https://ads-search.yahooapis.jp/api/v19";
const API_BASE_DISPLAY = "https://ads-display.yahooapis.jp/api/v19";

function num(v) {
  if (v === undefined || v === null || v === "") return 0;
  const s = String(v).replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function str(v) {
  return String(v || "").trim();
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
}

function flattenRow(row) {
  const out = { ...row };
  if (row && typeof row === "object") {
    if (row.reportDefinition && typeof row.reportDefinition === "object") Object.assign(out, row.reportDefinition);
    if (row.values) {
      const v = row.values;
      if (Array.isArray(v) && v.length > 0) {
        if (v[0] && typeof v[0] === "object" && ("key" in v[0] || "name" in v[0])) {
          v.forEach((item) => {
            const k = item.key ?? item.name;
            if (k != null) out[k] = item.value ?? item.values ?? item;
          });
        } else {
          Object.assign(out, Object.fromEntries(v.map((val, i) => [String(i), val])));
        }
      } else if (typeof v === "object" && !Array.isArray(v)) {
        Object.assign(out, v);
      }
    }
  }
  return out;
}

function getVal(row, ...keys) {
  let r = row;
  if (typeof row === "object" && row !== null && (row.reportDefinition || row.values || row.value)) {
    r = flattenRow(row);
  }
  const variants = new Set();
  for (const k of keys) {
    variants.add(k);
    variants.add(k.toLowerCase());
    variants.add(k.toLowerCase().replace(/_/g, " "));
    variants.add(k.toLowerCase().replace(/ /g, "_"));
    variants.add(norm(k));
  }
  for (const k of variants) {
    const v = r[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  const targetNorms = keys.map((k) => norm(k));
  for (const [rk, rv] of Object.entries(r || {})) {
    if (rv === undefined || rv === null || rv === "") continue;
    if (rk.startsWith("_")) continue;
    if (targetNorms.includes(norm(rk))) return rv;
  }
  if (Array.isArray(r._vals) && r._colIndexMap) {
    for (const k of keys) {
      const idx = r._colIndexMap[norm(k)] ?? r._colIndexMap[k.toLowerCase()] ?? r._colIndexMap[k.toLowerCase().replace(/_/g, "")];
      if (idx != null) {
        const v = r._vals[idx];
        if (v !== undefined && v !== null && v !== "") return v;
      }
    }
  }
  return "";
}

function getColIdx(row, ...keyGroups) {
  if (!row?._vals || !row?._colIndexMap) return -1;
  const map = row._colIndexMap;
  for (const keys of keyGroups) {
    const klist = Array.isArray(keys) ? keys : [keys];
    for (const k of klist) {
      const idx = map[norm(k)] ?? map[String(k).toLowerCase()] ?? map[String(k).toLowerCase().replace(/_/g, " ")];
      if (idx != null) return idx;
    }
  }
  return -1;
}

async function getAccessToken(acc, userId) {
  const expiry = acc.expiry_date ? Number(acc.expiry_date) : 0;
  let accessToken = acc.access_token || null;
  if (expiry && Date.now() >= expiry - 5 * 60 * 1000) {
    const { refreshAccessToken } = require("../yahooAdsOAuth");
    const refreshed = await refreshAccessToken(acc.refresh_token);
    if (refreshed?.access_token) {
      accessToken = refreshed.access_token;
      const apiAuthSources = require("../apiAuthSources");
      if (acc.api_auth_source_id) {
        if (userId) {
          await apiAuthSources.updateTokens(acc.api_auth_source_id, userId, {
            access_token: refreshed.access_token,
            expiry_date: refreshed.expiry_date,
          });
        } else {
          await apiAuthSources.updateTokensGlobal(acc.api_auth_source_id, {
            access_token: refreshed.access_token,
            expiry_date: refreshed.expiry_date,
          });
        }
      }
    }
  }
  return accessToken || acc.access_token;
}

/** レポート1件あたりの最大待機時間（ミリ秒） */
const REPORT_TIMEOUT_MS = 60 * 1000;
/** 初回ポーリング前の待機（ミリ秒） */
const POLL_INITIAL_MS = 1000;
/** ポーリング間隔（ミリ秒） */
const POLL_INTERVAL_MS = 1000;
/** ポーリング最大試行回数 */
const MAX_POLL_ATTEMPTS = 30;
/** 複数レポート同時開始による Yahoo 側 Frequency limit（get 403）を避ける、開始間隔（ms） */
const REPORT_STAGGER_MS = 500;

function withReportTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ rows: [], error: `timeout (${ms / 1000}s)` }), ms)),
  ]);
}

/**
 * 単一レポートの add → poll → download → parse を実行
 * タイムアウト時は { rows: [] } を返す（他レポートを妨げない）
 */
async function fetchOneReport({
  headers,
  accountId,
  start,
  end,
  reportType,
  fields,
  reportName,
  parseRows,
  diagnosticOnly,
  captureRaw,
  rawOnly,
  timeoutMs = REPORT_TIMEOUT_MS,
  apiBase = API_BASE,
}) {
  const addBody = {
    accountId: Number(accountId) || accountId,
    operand: [{ reportName, reportType, reportDateRangeType: "CUSTOM_DATE", dateRange: { startDate: start, endDate: end }, fields }],
  };
  const addRes = await fetch(`${apiBase}/ReportDefinitionService/add`, {
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
  if (!addRes.ok || (addData?.errors && addData.errors.length > 0)) {
    return { rows: [], error: addText?.slice(0, 300) };
  }
  const rawReportDef = addData?.rval?.values?.[0]?.reportDefinition;
  let reportDef = typeof rawReportDef === "string" ? (() => { try { return JSON.parse(rawReportDef); } catch { return null; } })() : rawReportDef;
  const reportIdStr = reportDef?.reportJobId ?? reportDef?.reportJobID ?? reportDef?.reportId ?? addData?.rval?.values?.[0]?.reportJobId ?? null;
  const rid = addData?.rid ? String(addData.rid) : null;
  const isNumericId = reportIdStr && /^\d+$/.test(String(reportIdStr));
  const useRid = !isNumericId && rid;
  if (!reportIdStr) {
    console.log(`[Yahoo Ads] ${reportType} add full response:`, JSON.stringify(addData).substring(0, 500));
  }
  if (!reportIdStr && !useRid) return { rows: [], error: "reportJobId not found" };
  console.log(`[Yahoo Ads] ${reportType} jobId:`, reportIdStr, "useRid:", useRid);

  const startTime = Date.now();
  let jobStatus = "IN_PROGRESS";
  let attempts = 0;
  const maxAttempts = diagnosticOnly ? 1 : MAX_POLL_ATTEMPTS;
  while ((jobStatus === "IN_PROGRESS" || jobStatus === "WAITING" || jobStatus === "WAIT") && attempts < maxAttempts) {
    if (Date.now() - startTime > timeoutMs) {
      return { rows: [], error: `timeout after ${Math.round((Date.now() - startTime) / 1000)}s` };
    }
    const waitMs = attempts === 0 ? (diagnosticOnly ? 500 : POLL_INITIAL_MS) : POLL_INTERVAL_MS;
    await new Promise((r) => setTimeout(r, waitMs));
    attempts++;
    const reportJobIdNum = reportIdStr && /^\d+$/.test(String(reportIdStr)) ? Number(reportIdStr) : null;
    const getBody = useRid
      ? { accountId: Number(accountId) || accountId, reportTypes: [reportType], numberResults: 500 }
      : { accountId: Number(accountId) || accountId, reportJobIds: reportJobIdNum != null && !Number.isNaN(reportJobIdNum) ? [reportJobIdNum] : [] };
    const getRes = await fetch(`${apiBase}/ReportDefinitionService/get`, { method: "POST", headers, body: JSON.stringify(getBody) });
    const getText = await getRes.text();
    if (!getRes.ok) return { rows: [], error: `get ${getRes.status}: ${getText?.slice(0, 200)}` };
    if (diagnosticOnly) return { rows: [], _connectionOk: true };
    let getData;
    try {
      getData = JSON.parse(getText);
    } catch {
      getData = {};
    }
    const gvalues = getData?.rval?.values ?? getData?.reportDefinitions ?? getData?.value ?? [];
    const greport = gvalues[0]?.reportDefinition ?? gvalues[0];
    jobStatus = greport?.reportJobStatus ?? greport?.jobStatus ?? greport?.status ?? "IN_PROGRESS";
    if (jobStatus === "COMPLETED" || jobStatus === "COMPLETED_WITH_EXCLUDED_DATA") break;
    if (jobStatus === "FAILED" || jobStatus === "REJECTED") return { rows: [], error: jobStatus };
  }
  if (jobStatus !== "COMPLETED" && jobStatus !== "COMPLETED_WITH_EXCLUDED_DATA") {
    return { rows: [], error: `timeout after ${attempts} attempts` };
  }
  const downloadBody = useRid
    ? { accountId: Number(accountId) || accountId, rid }
    : { accountId: Number(accountId) || accountId, reportJobId: Number(reportIdStr) };
  const downloadRes = await fetch(`${apiBase}/ReportDefinitionService/download`, {
    method: "POST",
    headers,
    body: JSON.stringify(downloadBody),
  });
  if (!downloadRes.ok) return { rows: [], error: `download ${downloadRes.status}` };

  // ダウンロード後にジョブをremove（60件上限対策）
  const reportJobIdNum = reportIdStr && /^\d+$/.test(String(reportIdStr)) ? Number(reportIdStr) : null;
  if (reportJobIdNum != null && !Number.isNaN(reportJobIdNum)) {
    const removeBody = {
      accountId: Number(accountId) || accountId,
      operand: [{ reportJobId: reportJobIdNum }],
    };
    await fetch(`${apiBase}/ReportDefinitionService/remove`, {
      method: "POST",
      headers,
      body: JSON.stringify(removeBody),
    }).catch(() => {});
  }

  const contentType = downloadRes.headers.get("content-type") || "";
  if (rawOnly) {
    const text = await downloadRes.text();
    return { _rawDownload: text.slice(0, 4000), _contentType: contentType, _lineCount: text.split(/\r?\n/).length };
  }
  const bodyText = await downloadRes.text();
  let rawRows = [];
  if (contentType.includes("application/json")) {
    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      data = {};
    }
    rawRows = data?.rows || data?.value || data?.reportDefinitions || (Array.isArray(data) ? data : []);
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      const rvalVals = data?.rval?.values;
      if (Array.isArray(rvalVals) && rvalVals.length > 0) {
        rawRows = rvalVals.map((r) => (r && (r.values || r.reportDefinition)) ? flattenRow(r) : r);
      }
    }
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      const reportDef = data?.rval?.values?.[0]?.reportDefinition;
      const inner = typeof reportDef === "object" && reportDef !== null ? reportDef : null;
      const innerRows = inner?.rows ?? inner?.values ?? (Array.isArray(inner) ? inner : null);
      if (Array.isArray(innerRows) && innerRows.length > 0) rawRows = innerRows;
    }
  }
  if (rawRows.length === 0 && bodyText && !bodyText.trimStart().startsWith("{") && (bodyText.includes("\n") || bodyText.includes("\r")) && (bodyText.includes(",") || bodyText.includes("\t"))) {
    const lines = bodyText.trim().split(/\r?\n/);
    if (lines.length > 1) {
      const header = lines[0];
      const delim = header.includes("\t") && header.split("\t").length > 3 ? "\t" : ",";
      const splitLine = (line) => {
        const out = [];
        let cur = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') inQuotes = !inQuotes;
          else if (ch === delim && !inQuotes) {
            out.push(cur.replace(/^"|"$/g, "").trim());
            cur = "";
          } else cur += ch;
        }
        out.push(cur.replace(/^"|"$/g, "").trim());
        return out;
      };
      let text = bodyText.charCodeAt(0) === 0xfeff ? bodyText.slice(1) : bodyText;
      const lns = text.trim().split(/\r?\n/);
      const cols = splitLine(lns[0]).map((c) => c.toLowerCase());
      const cm = {};
      cols.forEach((c, idx) => {
        const n = norm(c);
        if (!cm[n]) cm[n] = idx;
        cm[c] = idx;
        cm[c.replace(/ /g, "_")] = idx;
      });
      for (let i = 1; i < lns.length; i++) {
        const vals = splitLine(lns[i]);
        const row = { _vals: vals, _colIndexMap: cm };
        cols.forEach((c, idx) => {
          const val = (vals[idx] || "").replace(/^"|"$/g, "").trim();
          row[c] = val;
          const keyAlt = c.replace(/ /g, "_");
          if (keyAlt !== c) row[keyAlt] = val;
        });
        rawRows.push(row);
      }
    }
  }
  const colIndexMap = {};
  const normalizeRow = (row) => {
    const out = {};
    for (const [k, v] of Object.entries(row || {})) {
      if (k.startsWith("_")) continue;
      out[k] = v;
      const lower = String(k).toLowerCase();
      if (lower !== k) out[lower] = v;
      const noSpc = lower.replace(/ /g, "_");
      if (noSpc !== lower) out[noSpc] = v;
    }
    return out;
  };
  if (contentType.includes("application/json") && Array.isArray(rawRows) && rawRows.length > 0) {
    rawRows = rawRows.map(normalizeRow);
    const firstKeys = Object.keys(rawRows[0] || {}).filter((k) => !k.startsWith("_"));
    firstKeys.forEach((k, idx) => {
      const n = norm(k);
      if (!colIndexMap[n]) colIndexMap[n] = idx;
      colIndexMap[k] = idx;
    });
    rawRows = rawRows.map((r) => ({ ...r, _vals: firstKeys.map((k) => r[k]), _colIndexMap: colIndexMap }));
  } else if (!contentType.includes("application/json") && rawRows.length === 0) {
    let text = bodyText;
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const lines = text.trim().split(/\r?\n/);
    if (lines.length > 1) {
      const header = lines[0];
      const delim = header.includes("\t") && header.split("\t").length > 3 ? "\t" : ",";
      const splitLine = (line) => {
        const out = [];
        let cur = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') inQuotes = !inQuotes;
          else if (ch === delim && !inQuotes) {
            out.push(cur.replace(/^"|"$/g, "").trim());
            cur = "";
          } else cur += ch;
        }
        out.push(cur.replace(/^"|"$/g, "").trim());
        return out;
      };
      const cols = splitLine(header).map((c) => c.toLowerCase());
      cols.forEach((c, idx) => {
        const n = norm(c);
        if (!colIndexMap[n]) colIndexMap[n] = idx;
        colIndexMap[c] = idx;
        colIndexMap[c.replace(/ /g, "_")] = idx;
      });
      for (let i = 1; i < lines.length; i++) {
        const vals = splitLine(lines[i]);
        const row = { _vals: vals, _colIndexMap: colIndexMap };
        cols.forEach((c, idx) => {
          const val = (vals[idx] || "").replace(/^"|"$/g, "").trim();
          row[c] = val;
          const keyAlt = c.replace(/ /g, "_");
          if (keyAlt !== c) row[keyAlt] = val;
        });
        rawRows.push(row);
      }
    }
  }
  if (reportType === "CAMPAIGN" && rawRows.length === 0) {
    console.warn("[Yahoo Ads] CAMPAIGN download produced 0 raw rows, contentType:", contentType?.slice(0, 50));
  }
  if (reportType === "AD" && rawRows.length === 0 && bodyText) {
    const peek = bodyText.slice(0, 500).replace(/\s+/g, " ");
    console.warn("[Yahoo Ads] AD download produced 0 raw rows. contentType:", contentType?.slice(0, 80), "bodyPreview:", peek);
  }
  const parsed = parseRows(rawRows);
  const ret = Array.isArray(parsed) ? { rows: parsed } : parsed;
  ret._rawRowCount = rawRows.length;
  if (captureRaw && rawRows.length > 0) {
    ret._rawRows = rawRows;
    ret._rawRow0 = rawRows[0];
    ret._rawRow0Keys = Object.keys(rawRows[0]);
  }
  return ret;
}

/**
 * Yahoo Ads の診断用：API 呼び出しの詳細を返す
 */
async function fetchYahooAdsReportWithMeta(startDate, endDate, userId = null, options = {}) {
  const wantDebug = !!(options && options.debug);
  const connectionTest = !!(options && options.connectionTest);
  let acc = null;
  // company_url_id ベースのアカウント解決（優先）
  if (options?.company_url_id) {
    try {
      const { getAccountForCompanyUrl } = require("../companyUrlAdsAccounts");
      acc = await getAccountForCompanyUrl(options.company_url_id, "yahoo");
    } catch (e) {
      if (process.env.NODE_ENV !== "production") console.warn("[Yahoo Ads] getAccountForCompanyUrl error:", e.message);
    }
  } else if (userId) {
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
    console.log("[Yahoo Ads] レポート取得開始:", accountId, `${startDate}〜${endDate}`, "x-z-base-account-id:", baseAccountId || "(未設定)", "body.accountId:", accountId);

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "x-z-base-account-id": baseAccountId || accountId,
    };
    const diagnosticOnly = !!connectionTest;

    const reportConfigs = [
      {
        key: "campaign",
        reportType: "CAMPAIGN",
        fields: ["CAMPAIGN_ID", "CAMPAIGN_NAME", "DAY", "HOUR_OF_DAY", "DAY_OF_WEEK", "IMPS", "CLICKS", "COST", "CONVERSIONS"],
        reportName: `CampaignReport_${start}_${end}`,
        parseRows: (raw) => {
          const byCampaign = new Map();
          const byHour = new Map();
          const byDay = new Map();
          const IMP_KEYS = ["インプレッション数", "表示回数", "IMPS", "imps", "IMPRESSIONS", "impressions"];
          const CLICK_KEYS = ["クリック数", "CLICKS", "clicks"];
          const COST_KEYS = ["費用", "コスト", "広告費", "COST", "cost"];
          const CONV_KEYS = ["コンバージョン数", "CONVERSIONS", "conversions"];
          const CID_KEYS = ["キャンペーンID", "CAMPAIGN_ID", "campaign_id", "campaignID"];
          const CNAME_KEYS = ["キャンペーン名", "CAMPAIGN_NAME", "campaign_name", "campaignName"];
          const DAY_KEYS = ["日", "DAY", "day", "日付", "date"];
          const HOUR_KEYS = ["時間帯", "時間", "HOUR_OF_DAY", "hour_of_day", "hourofday"];
          const DOW_KEYS = ["曜日", "DAY_OF_WEEK", "day_of_week", "dayofweek"];
          const POS = raw[0] ? {
            imps: getColIdx(raw[0], IMP_KEYS),
            clicks: getColIdx(raw[0], CLICK_KEYS),
            cost: getColIdx(raw[0], COST_KEYS),
            conv: getColIdx(raw[0], CONV_KEYS),
            cid: getColIdx(raw[0], CID_KEYS),
            cname: getColIdx(raw[0], CNAME_KEYS),
            hour: getColIdx(raw[0], HOUR_KEYS),
            dow: getColIdx(raw[0], DOW_KEYS),
          } : {};
          const vLen = raw[0]?._vals?.length ?? 0;
          const fallbackPos = vLen >= 8
            ? { imps: 4, clicks: 5, cost: 6, conv: 7, cid: 0, cname: 1, hour: 2, dow: 3 }
            : { imps: 2, clicks: 3, cost: 4, conv: 5, cid: 0, cname: 1, hour: -1, dow: -1 };
          for (const r of raw) {
            let imps = num(getVal(r, ...IMP_KEYS));
            let clicks = num(getVal(r, ...CLICK_KEYS));
            let cost = num(getVal(r, ...COST_KEYS));
            let conv = num(getVal(r, ...CONV_KEYS));
            if (imps === 0 && clicks === 0 && cost === 0 && r._vals && r._vals.length >= 4) {
              let iIdx = POS.imps >= 0 ? POS.imps : fallbackPos.imps;
              let cIdx = POS.clicks >= 0 ? POS.clicks : fallbackPos.clicks;
              let costIdx = POS.cost >= 0 ? POS.cost : fallbackPos.cost;
              let convIdx = POS.conv >= 0 ? POS.conv : fallbackPos.conv;
              imps = num(r._vals[iIdx]);
              clicks = num(r._vals[cIdx]);
              cost = num(r._vals[costIdx]);
              conv = num(r._vals[convIdx]);
              if (imps === 0 && clicks === 0 && cost === 0) {
                const candidates = [
                  [2, 3, 4, 5],
                  [4, 5, 6, 7],
                  [5, 6, 7, 8],
                  [3, 4, 5, 6],
                  [6, 7, 8, 9],
                ];
                for (const [ii, ci, coi, cvi] of candidates) {
                  if (r._vals.length > Math.max(ii, ci, coi, cvi)) {
                    const ti = num(r._vals[ii]);
                    const tc = num(r._vals[ci]);
                    const tco = num(r._vals[coi]);
                    const tcv = num(r._vals[cvi]);
                    if (ti > 0 || tc > 0 || tco > 0 || tcv > 0) {
                      imps = ti;
                      clicks = tc;
                      cost = tco;
                      conv = tcv;
                      break;
                    }
                  }
                }
              }
            }

            let cid = str(getVal(r, ...CID_KEYS) || "0");
            let cname = str(getVal(r, ...CNAME_KEYS));
            if (!cid && r._vals && r._vals.length >= 2) {
              const cidIdx = POS.cid >= 0 ? POS.cid : fallbackPos.cid;
              const cnameIdx = POS.cname >= 0 ? POS.cname : fallbackPos.cname;
              cid = str(r._vals[cidIdx]) || "0";
              cname = str(r._vals[cnameIdx]);
            }
            if (!byCampaign.has(cid)) byCampaign.set(cid, { name: cname, impressions: 0, clicks: 0, cost: 0, conversions: 0 });
            const acc = byCampaign.get(cid);
            acc.impressions += imps;
            acc.clicks += clicks;
            acc.cost += cost;
            acc.conversions += conv;

            let hourVal = str(getVal(r, ...HOUR_KEYS));
            let dowVal = str(getVal(r, ...DOW_KEYS));
            if (!hourVal && r._vals && r._vals.length >= 4) {
              const hourIdx = POS.hour >= 0 ? POS.hour : fallbackPos.hour;
              const dowIdx = POS.dow >= 0 ? POS.dow : fallbackPos.dow;
              hourVal = str(r._vals[hourIdx]);
              dowVal = str(r._vals[dowIdx]);
            }
            const hkey = `${hourVal}_${dowVal}`;
            if (!byHour.has(hkey)) byHour.set(hkey, { hourOfDay: hourVal, dayOfWeek: dowVal, impressions: 0, clicks: 0, cost: 0, conversions: 0 });
            const hacc = byHour.get(hkey);
            hacc.impressions += imps;
            hacc.clicks += clicks;
            hacc.cost += cost;
            hacc.conversions += conv;
            const dayVal = str(getVal(r, ...DAY_KEYS));
            if (dayVal) {
              const day = String(dayVal).replace(/-/g, "").slice(0, 8);
              if (day && /^\d{8}$/.test(day)) {
                if (!byDay.has(day)) byDay.set(day, { date: day, impressions: 0, clicks: 0, cost: 0, conversions: 0 });
                const dacc = byDay.get(day);
                dacc.impressions += imps;
                dacc.clicks += clicks;
                dacc.cost += cost;
                dacc.conversions += conv;
              }
            }
          }
          const dailyRows = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
          const rows = [...byCampaign.entries()].map(([, v]) => ({
            media: "Yahoo検索広告",
            campaign: v.name,
            impressions: v.impressions,
            clicks: v.clicks,
            cost: v.cost,
            conversions: v.conversions,
          }));
          const hourRows = [...byHour.values()].map((v) => ({
            hourOfDay: v.hourOfDay,
            dayOfWeek: v.dayOfWeek,
            impressions: v.impressions,
            clicks: v.clicks,
            cost: v.cost,
            conversions: v.conversions,
          }));
          return { rows, hourRows, dailyRows };
        },
      },
      {
        key: "keywordRows",
        reportType: "SEARCH_QUERY",
        fields: ["SEARCH_QUERY", "KEYWORD", "CAMPAIGN_NAME", "IMPS", "CLICKS", "COST", "CONVERSIONS", "AVG_CPC"],
        reportName: `KeywordsReport_${start}_${end}`,
        parseRows: (raw) =>
          raw.map((r) => ({
            media: "Yahoo検索広告",
            keyword: str(getVal(r, "キーワード", "KEYWORD", "keyword")) || str(getVal(r, "検索クエリ", "SEARCH_QUERY", "search_query")),
            campaign: str(getVal(r, "キャンペーン名", "CAMPAIGN_NAME", "campaign_name")),
            impressions: num(getVal(r, "インプレッション数", "IMPS", "imps", "IMPRESSIONS", "impressions")),
            clicks: num(getVal(r, "クリック数", "CLICKS", "clicks")),
            cost: num(getVal(r, "費用", "コスト", "COST", "cost")),
            conversions: num(getVal(r, "コンバージョン数", "CONVERSIONS", "conversions")),
            avgCpc: num(getVal(r, "平均クリック単価", "AVG_CPC", "avg_cpc")),
          })),
      },
      {
        key: "areaRows",
        reportType: "GEO",
        fields: ["PREFECTURE", "CAMPAIGN_NAME", "IMPS", "CLICKS", "COST", "CONVERSIONS"],
        reportName: `GeoReport_${start}_${end}`,
        parseRows: (raw) =>
          raw.map((r) => ({
            media: "Yahoo検索広告",
            pref: str(getVal(r, "都道府県", "PREFECTURE", "prefecture")),
            campaign: str(getVal(r, "キャンペーン名", "CAMPAIGN_NAME", "campaign_name")),
            impressions: num(getVal(r, "インプレッション数", "IMPS", "imps", "IMPRESSIONS", "impressions")),
            clicks: num(getVal(r, "クリック数", "CLICKS", "clicks")),
            cost: num(getVal(r, "費用", "コスト", "COST", "cost")),
            conversions: num(getVal(r, "コンバージョン数", "CONVERSIONS", "conversions")),
          })),
      },
      {
        key: "adRows",
        reportType: "AD",
        fields: ["CAMPAIGN_NAME", "ADGROUP_NAME", "AD_NAME", "IMPS", "CLICKS", "COST", "CONVERSIONS", "AVG_CPC"],
        reportName: `AdReport_${start}_${end}`,
        parseRows: (raw) =>
          (Array.isArray(raw) ? raw : [])
            .filter((r) => r != null && typeof r === "object")
            .map((r) => {
              let campaign = str(getVal(r, "キャンペーン名", "CAMPAIGN_NAME", "campaign_name", "Campaign Name"));
              let adGroup = str(getVal(r, "広告グループ名", "ADGROUP_NAME", "adgroup_name", "Ad Group Name"));
              let adName = str(getVal(r, "広告名", "AD_NAME", "ad_name", "Ad Name"));
              let impressions = num(getVal(r, "インプレッション数", "表示回数", "IMPS", "imps", "IMPRESSIONS", "impressions"));
              let clicks = num(getVal(r, "クリック数", "CLICKS", "clicks"));
              let cost = num(getVal(r, "費用", "コスト", "広告費", "COST", "cost"));
              let conversions = num(getVal(r, "コンバージョン数", "CONVERSIONS", "conversions"));
              let avgCpc = num(getVal(r, "平均クリック単価", "AVG_CPC", "avg_cpc"));
              if (r._vals && r._vals.length >= 6) {
                const v = r._vals;
                if (!campaign) campaign = str(v[0]);
                if (!adGroup) adGroup = str(v[1]);
                if (!adName) adName = str(v[2]);
                if (impressions === 0 && clicks === 0 && cost === 0) {
                  impressions = num(v[3]);
                  clicks = num(v[4]);
                  cost = num(v[5]);
                }
                if (v.length >= 7 && conversions === 0) conversions = num(v[6]);
                if (v.length >= 8) avgCpc = num(v[7]);
              }
              return { campaign, adGroup, adName, impressions, clicks, cost, conversions, avgCpc };
            }),
      },
      {
        key: "assetRows",
        reportType: "RESPONSIVE_ADS_FOR_SEARCH_ASSET",
        fields: ["CAMPAIGN_NAME", "ADGROUP_NAME", "ASSET_TEXT", "ASSET_TYPE", "IMPS"],
        reportName: `AssetReport_${start}_${end}`,
        parseRows: (raw) =>
          raw.map((r) => ({
            campaign: str(getVal(r, "キャンペーン名", "CAMPAIGN_NAME", "campaign_name")),
            adGroup: str(getVal(r, "広告グループ名", "ADGROUP_NAME", "adgroup_name")),
            assetText: str(getVal(r, "アセット", "ASSET_TEXT", "asset_text")),
            assetType: str(getVal(r, "アセットタイプ", "ASSET_TYPE", "asset_type")),
            impressions: num(getVal(r, "インプレッション数", "IMPS", "imps")),
          })),
      },
    ];

    const results = await Promise.all(
      reportConfigs.map((cfg, idx) =>
        (async () => {
          if (idx > 0) {
            await new Promise((r) => setTimeout(r, idx * REPORT_STAGGER_MS));
          }
          return withReportTimeout(
            fetchOneReport({
              headers,
              accountId,
              start,
              end,
              reportType: cfg.reportType,
              fields: cfg.fields,
              reportName: cfg.reportName,
              parseRows: cfg.parseRows,
              diagnosticOnly,
              captureRaw: wantDebug && idx === 0,
              timeoutMs: REPORT_TIMEOUT_MS,
            }),
            REPORT_TIMEOUT_MS + 60000
          );
        })()
      )
    );

    if (diagnosticOnly && results[0]?._connectionOk) {
      return {
        rows: [],
        areaRows: [],
        hourRows: [],
        dailyRows: [],
        keywordRows: [],
        adRows: [],
        assetRows: [],
        customerId: accountId,
        _hint: "接続OK: Add・Get API は正常に動作しています。レポート取得には時間がかかります。",
        _connectionOk: true,
        _debug: wantDebug ? { add_ok: true, get_ok: true } : undefined,
      };
    }

    const campaignResult = results[0];
    const rows = campaignResult?.rows ?? [];
    const hourRows = campaignResult?.hourRows ?? [];
    const dailyRows = campaignResult?.dailyRows ?? [];
    const keywordRows = results[1]?.error ? [] : (results[1]?.rows ?? []);
    const areaRows = results[2]?.error ? [] : (results[2]?.rows ?? []);
    const adRows = results[3]?.error ? [] : (results[3]?.rows ?? []);
    const assetRows = results[4]?.error ? [] : (results[4]?.rows ?? []);

    const hasError = results.some((r) => r.error);
    let creativeHint = null;
    if (results[3]?.error || results[4]?.error) {
      const parts = [];
      if (results[3]?.error) parts.push(`AD: ${results[3].error}`);
      if (results[4]?.error) parts.push(`Asset: ${results[4].error}`);
      creativeHint = "クリエイティブ (" + parts.join("; ") + ")";
    }
    if (hasError) {
      const errMsg = results.map((r, i) => (r.error ? `${reportConfigs[i].reportType}: ${r.error}` : null)).filter(Boolean).join("; ");
      console.warn("[Yahoo Ads] レポート取得エラー:", errMsg);
    }

    if (rows.length > 0 || areaRows.length > 0 || hourRows.length > 0 || keywordRows.length > 0 || adRows.length > 0 || assetRows.length > 0) {
      console.log(`[Yahoo Ads] 取得完了: campaign=${rows.length}, area=${areaRows.length}, hour=${hourRows.length}, keyword=${keywordRows.length}, ad=${adRows.length}, asset=${assetRows.length} (${startDate}〜${endDate})`);
    } else {
      console.log(`[Yahoo Ads] 取得完了: 0件 (${startDate}〜${endDate})`);
    }
    // --- YDA（ディスプレイ広告）取得 ---
    let ydaRows = [], ydaAreaRows = [], ydaDailyRows = [];
    try {
      const ydaCampaignResult = await withReportTimeout(
        fetchOneReport({
          headers,
          accountId,
          start,
          end,
          reportType: "CAMPAIGN",
          fields: ["CAMPAIGN_ID", "CAMPAIGN_NAME", "DAY", "IMPS", "CLICKS", "COST", "CONVERSIONS"],
          reportName: `YDA_CampaignReport_${start}_${end}`,
          parseRows: (raw) => {
            const byCamp = new Map();
            const byDay = new Map();
            for (const r of raw) {
              const cname = str(getVal(r, "キャンペーン名", "CAMPAIGN_NAME", "campaign_name")) || str(r._vals?.[1]);
              const imps = num(getVal(r, "インプレッション数", "IMPS", "imps", "IMPRESSIONS")) || num(r._vals?.[3]);
              const clicks = num(getVal(r, "クリック数", "CLICKS", "clicks")) || num(r._vals?.[4]);
              const cost = num(getVal(r, "費用", "コスト", "COST", "cost")) || num(r._vals?.[5]);
              const conv = num(getVal(r, "コンバージョン数", "CONVERSIONS", "conversions")) || num(r._vals?.[6]);
              if (!byCamp.has(cname)) byCamp.set(cname, { name: cname, impressions: 0, clicks: 0, cost: 0, conversions: 0 });
              const a = byCamp.get(cname);
              a.impressions += imps; a.clicks += clicks; a.cost += cost; a.conversions += conv;
              const dayVal = str(getVal(r, "日", "DAY", "day", "日付")) || str(r._vals?.[2]);
              if (dayVal) {
                const day = String(dayVal).replace(/-/g, "").slice(0, 8);
                if (/^\d{8}$/.test(day)) {
                  if (!byDay.has(day)) byDay.set(day, { date: day, impressions: 0, clicks: 0, cost: 0, conversions: 0 });
                  const d = byDay.get(day);
                  d.impressions += imps; d.clicks += clicks; d.cost += cost; d.conversions += conv;
                }
              }
            }
            const rows = [...byCamp.values()].map((v) => ({ media: "Yahooディスプレイ広告", campaign: v.name, impressions: v.impressions, clicks: v.clicks, cost: v.cost, conversions: v.conversions }));
            const dailyRows = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
            return { rows, dailyRows };
          },
          apiBase: API_BASE_DISPLAY,
        }),
        REPORT_TIMEOUT_MS + 60000
      );
      ydaRows = ydaCampaignResult?.rows ?? [];
      ydaDailyRows = ydaCampaignResult?.dailyRows ?? [];
      if (ydaRows.length > 0) console.log(`[Yahoo Ads YDA] 取得完了: campaign=${ydaRows.length}`);
    } catch (e) {
      console.warn("[Yahoo Ads YDA] エラー（スキップ）:", e.message);
    }

    // --- YDA 広告レポート（バナー画像付き）---
    let ydaAdRows = [];
    try {
      const ydaAdResult = await withReportTimeout(
        fetchOneReport({
          headers,
          accountId,
          start,
          end,
          reportType: "AD",
          fields: ["CAMPAIGN_NAME", "ADGROUP_NAME", "AD_NAME", "MEDIA_ID", "IMPS", "CLICKS", "COST", "CONVERSIONS"],
          reportName: `YDA_AdReport_${start}_${end}`,
          parseRows: (raw) =>
            raw.map((r) => ({
              media: "Yahooディスプレイ広告",
              campaign: str(getVal(r, "キャンペーン名", "CAMPAIGN_NAME", "campaign_name")) || str(r._vals?.[0]),
              adGroup: str(getVal(r, "広告グループ名", "ADGROUP_NAME", "adgroup_name")) || str(r._vals?.[1]),
              adName: str(getVal(r, "広告名", "AD_NAME", "ad_name")) || str(r._vals?.[2]),
              mediaId: str(getVal(r, "メディアID", "MEDIA_ID", "media_id")) || str(r._vals?.[3]),
              impressions: num(getVal(r, "インプレッション数", "IMPS", "imps")) || num(r._vals?.[4]),
              clicks: num(getVal(r, "クリック数", "CLICKS", "clicks")) || num(r._vals?.[5]),
              cost: num(getVal(r, "費用", "コスト", "COST", "cost")) || num(r._vals?.[6]),
              conversions: num(getVal(r, "コンバージョン数", "CONVERSIONS", "conversions")) || num(r._vals?.[7]),
            })),
          apiBase: API_BASE_DISPLAY,
        }),
        REPORT_TIMEOUT_MS + 60000
      );
      ydaAdRows = ydaAdResult?.rows ?? [];
      if (ydaAdRows.length > 0) console.log(`[Yahoo Ads YDA] 広告取得: ${ydaAdRows.length}件`);

      // MediaService で画像URL取得
      const mediaIds = [...new Set(ydaAdRows.map((r) => r.mediaId).filter(Boolean))];
      if (mediaIds.length > 0) {
        try {
          const mediaBody = {
            accountId: Number(accountId) || accountId,
            mediaIds: mediaIds.slice(0, 500).map((id) => Number(id) || id),
          };
          const mediaRes = await fetch(`${API_BASE_DISPLAY}/MediaService/get`, {
            method: "POST",
            headers,
            body: JSON.stringify(mediaBody),
          });
          const mediaText = await mediaRes.text();
          let mediaData;
          try { mediaData = JSON.parse(mediaText); } catch { mediaData = {}; }
          const mediaUrlMap = new Map();
          const values = mediaData?.rval?.values ?? [];
          for (const v of values) {
            const m = v?.media ?? v?.mediaRecord ?? v;
            const mid = String(m?.mediaId ?? m?.media_id ?? "");
            const url = m?.thumbnailUrl ?? m?.thumbnail_url ?? m?.imageMedia?.url ?? m?.url ?? "";
            if (mid && url) mediaUrlMap.set(mid, url);
          }
          if (mediaUrlMap.size > 0) {
            console.log(`[Yahoo Ads YDA] 画像URL取得: ${mediaUrlMap.size}件`);
            ydaAdRows.forEach((r) => {
              if (r.mediaId && mediaUrlMap.has(r.mediaId)) {
                r.imageUrl = mediaUrlMap.get(r.mediaId);
              }
            });
          }
        } catch (me) {
          console.warn("[Yahoo Ads YDA] MediaService エラー（スキップ）:", me.message);
        }
      }
    } catch (e) {
      console.warn("[Yahoo Ads YDA] 広告レポートエラー（スキップ）:", e.message);
    }

    // YSA + YDA を結合
    const allRows = [...rows, ...ydaRows];
    const allDailyRows = [...dailyRows, ...ydaDailyRows];
    const allAdRows = [...adRows, ...ydaAdRows];

    const out = { rows: allRows, areaRows, hourRows, dailyRows: allDailyRows, keywordRows, adRows: allAdRows, assetRows, customerId: accountId };
    if (creativeHint) out._hint = creativeHint;
    if (results[3]?.error || results[4]?.error || (adRows.length === 0 && assetRows.length === 0)) {
      out._creativeDiagnostic = {
        adError: results[3]?.error || null,
        assetError: results[4]?.error || null,
        adRawCount: results[3]?._rawRowCount ?? (Array.isArray(results[3]?.rows) ? results[3].rows.length : 0),
        adParsedCount: adRows.length,
        assetRawCount: results[4]?._rawRowCount ?? (Array.isArray(results[4]?.rows) ? results[4].rows.length : 0),
        assetParsedCount: assetRows.length,
      };
    }
    if (campaignResult?._rawRow0Keys) {
      const r0 = campaignResult._rawRow0;
      const keys = campaignResult._rawRow0Keys.filter((k) => !k.startsWith("_"));
      out._yahooRawSample = {
        keys,
        row: r0 ? Object.fromEntries(Object.entries(r0).filter(([k]) => !k.startsWith("_"))) : null,
        vals: r0?._vals ? [...r0._vals] : null,
        valsLen: r0?._vals?.length ?? 0,
      };
      if (rows.length > 0 && rows[0]?.cost === 0 && rows[0]?.impressions === 0) {
        console.warn("[Yahoo Ads] PARSE_ZEROS keys=" + keys.join(",") + " vals=" + JSON.stringify(r0?._vals?.slice(0, 12)));
      }
    }
    return out;
  } catch (err) {
    console.error("[Yahoo Ads] API error:", err.message);
    return {
      rows: [],
      areaRows: [],
      hourRows: [],
      dailyRows: [],
      keywordRows: [],
      adRows: [],
      assetRows: [],
      customerId: accountId || null,
      _hint: "Yahoo Ads API エラー: " + (err.message || "不明"),
      _debug: wantDebug ? { error: err.message, stack: err.stack } : undefined,
    };
  }
}

async function fetchYahooAdsReport(startDate, endDate, userId = null) {
  return await fetchYahooAdsReportWithMeta(startDate, endDate, userId);
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
    "x-z-base-account-id": baseAccountId || accountId,
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

async function getCampaignRawDownload(startDate, endDate, userId) {
  let acc = null;
  try {
    const { getSelectedAccount } = require("../yahooAdsAccounts");
    acc = await getSelectedAccount(userId);
  } catch (e) {}
  if (!acc?.refresh_token) return { error: "Yahoo認証なし" };
  const accountId = String(acc.account_id || "").trim();
  let baseAccountId = String(acc.agency_account_id || acc.account_id || "").trim();
  if (baseAccountId.includes("-")) baseAccountId = baseAccountId.split("-").pop();
  const accessToken = await getAccessToken(acc, userId);
  if (!accessToken) return { error: "トークンなし" };
  const start = startDate.replace(/-/g, "");
  const end = endDate.replace(/-/g, "");
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "x-z-base-account-id": baseAccountId || accountId,
  };
  const res = await fetchOneReport({
    headers,
    accountId,
    start,
    end,
    reportType: "CAMPAIGN",
    fields: ["CAMPAIGN_ID", "CAMPAIGN_NAME", "HOUR_OF_DAY", "DAY_OF_WEEK", "IMPS", "CLICKS", "COST", "CONVERSIONS"],
    reportName: `RawDebug_${start}_${end}`,
    parseRows: () => [],
    rawOnly: true,
  });
  return res.error ? { error: res.error } : { raw: res._rawDownload, contentType: res._contentType, lineCount: res._lineCount };
}

/** ReportDefinitionService/getReportFields で有効なフィールド一覧を取得 */
async function getReportFields(reportType, headers) {
  try {
    const res = await fetch(`${API_BASE}/ReportDefinitionService/getReportFields`, {
      method: "POST",
      headers,
      body: JSON.stringify({ reportType }),
    });
    const text = await res.text();
    const data = res.ok ? JSON.parse(text) : null;
    const fields = data?.rval?.fields ?? [];
    return { ok: res.ok, fieldNames: fields.map((f) => f.fieldName).filter(Boolean), rawError: res.ok ? null : text?.slice(0, 500) };
  } catch (e) {
    return { ok: false, fieldNames: [], rawError: e.message };
  }
}

function parseAdRowsForCreative(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((r) => r != null && typeof r === "object")
    .map((r) => {
      let campaign = str(getVal(r, "キャンペーン名", "CAMPAIGN_NAME", "campaign_name", "Campaign Name"));
      let adGroup = str(getVal(r, "広告グループ名", "ADGROUP_NAME", "adgroup_name", "Ad Group Name"));
      let adName = str(getVal(r, "広告名", "AD_NAME", "ad_name", "Ad Name"));
      let impressions = num(getVal(r, "インプレッション数", "表示回数", "IMPS", "imps", "IMPRESSIONS", "impressions"));
      let clicks = num(getVal(r, "クリック数", "CLICKS", "clicks"));
      let cost = num(getVal(r, "費用", "コスト", "広告費", "COST", "cost"));
      let conversions = num(getVal(r, "コンバージョン数", "CONVERSIONS", "conversions"));
      let avgCpc = num(getVal(r, "平均クリック単価", "AVG_CPC", "avg_cpc"));
      if (r._vals && r._vals.length >= 6) {
        const v = r._vals;
        if (!campaign) campaign = str(v[0]);
        if (!adGroup) adGroup = str(v[1]);
        if (!adName) adName = str(v[2]);
        if (impressions === 0 && clicks === 0 && cost === 0) {
          impressions = num(v[3]);
          clicks = num(v[4]);
          cost = num(v[5]);
        }
        if (v.length >= 7 && conversions === 0) conversions = num(v[6]);
        if (v.length >= 8) avgCpc = num(v[7]);
      }
      return { campaign, adGroup, adName, impressions, clicks, cost, conversions, avgCpc };
    });
}

function parseAssetRowsForCreative(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((r) => r != null && typeof r === "object")
    .map((r) => ({
      campaign: str(getVal(r, "キャンペーン名", "CAMPAIGN_NAME", "campaign_name")),
      adGroup: str(getVal(r, "広告グループ名", "ADGROUP_NAME", "adgroup_name")),
      assetText: str(getVal(r, "アセット", "ASSET_TEXT", "asset_text")),
      assetType: str(getVal(r, "アセットタイプ", "ASSET_TYPE", "asset_type")),
      impressions: num(getVal(r, "インプレッション数", "IMPS", "imps")),
    }));
}

/**
 * ReportDefinitionService の滞留ジョブを一括削除
 * get で全ジョブを取得し、remove で全件削除する
 */
async function cleanupReportJobs(userId) {
  let acc = null;
  if (userId) {
    try {
      const { getSelectedAccount } = require("../yahooAdsAccounts");
      acc = await getSelectedAccount(userId);
    } catch (e) {}
  }
  if (!acc?.refresh_token) {
    const at = (process.env.YAHOO_ADS_ACCESS_TOKEN || "").trim();
    const aid = (process.env.YAHOO_ADS_ACCOUNT_ID || "").trim();
    if (!at || !aid) return { error: "Yahoo認証なし", removed: 0 };
    acc = { account_id: aid, agency_account_id: process.env.YAHOO_ADS_BASE_ACCOUNT_ID || aid, access_token: at, refresh_token: null };
  }
  const accountId = String(acc.account_id || "").trim();
  let baseAccountId = String(acc.agency_account_id || acc.account_id || "").trim();
  if (baseAccountId.includes("-")) baseAccountId = baseAccountId.split("-").pop();
  const accessToken = await getAccessToken(acc, userId);
  if (!accessToken) return { error: "トークンなし", removed: 0 };

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "x-z-base-account-id": baseAccountId || accountId,
  };

  const REPORT_TYPES = ["CAMPAIGN", "SEARCH_QUERY", "GEO", "AD", "RESPONSIVE_ADS_FOR_SEARCH_ASSET", "ADGROUP"];
  const allJobIds = new Set();
  for (const reportType of REPORT_TYPES) {
    const getBody = {
      accountId: Number(accountId) || accountId,
      reportTypes: [reportType],
      numberResults: 500,
    };
    const getRes = await fetch(`${API_BASE}/ReportDefinitionService/get`, {
      method: "POST",
      headers,
      body: JSON.stringify(getBody),
    });
    if (!getRes.ok) continue;
    let getData;
    try {
      getData = JSON.parse(await getRes.text());
    } catch {
      continue;
    }
    const values = getData?.rval?.values ?? getData?.reportDefinitions ?? getData?.value ?? [];
    for (const v of values) {
      const def = v?.reportDefinition ?? v;
      const jid = def?.reportJobId ?? def?.reportJobID ?? def?.reportId;
      if (jid != null && /^\d+$/.test(String(jid))) allJobIds.add(Number(jid));
    }
  }

  const jobIdArr = Array.from(allJobIds);
  let removed = 0;
  const BATCH_SIZE = 30;
  for (let i = 0; i < jobIdArr.length; i += BATCH_SIZE) {
    const batch = jobIdArr.slice(i, i + BATCH_SIZE);
    const removeBody = {
      accountId: Number(accountId) || accountId,
      operand: batch.map((reportJobId) => ({ reportJobId })),
    };
    const removeRes = await fetch(`${API_BASE}/ReportDefinitionService/remove`, {
      method: "POST",
      headers,
      body: JSON.stringify(removeBody),
    });
    if (removeRes.ok) removed += batch.length;
    if (i + BATCH_SIZE < jobIdArr.length) await new Promise((r) => setTimeout(r, 250));
  }
  if (allJobIds.size > 0) {
    console.log("[Yahoo Ads] cleanup-jobs: 取得=" + allJobIds.size + "件, 削除=" + removed + "件");
  }
  return { removed, total: allJobIds.size };
}

/** クリエイティブタブ用 AD/Asset レポートの診断（API応答をそのまま返す） */
async function getCreativeReportsDebug(startDate, endDate, userId) {
  let acc = null;
  if (userId) {
    try {
      const { getSelectedAccount } = require("../yahooAdsAccounts");
      acc = await getSelectedAccount(userId);
    } catch (e) {}
  }
  if (!acc?.refresh_token) {
    const at = (process.env.YAHOO_ADS_ACCESS_TOKEN || "").trim();
    const aid = (process.env.YAHOO_ADS_ACCOUNT_ID || "").trim();
    if (!at || !aid) return { error: "Yahoo認証なし", adRows: [], assetRows: [], _diagnostic: true };
    acc = { account_id: aid, agency_account_id: process.env.YAHOO_ADS_BASE_ACCOUNT_ID || aid, access_token: at, refresh_token: null };
  }
  const accountId = String(acc.account_id || "").trim();
  let baseAccountId = String(acc.agency_account_id || acc.account_id || "").trim();
  if (baseAccountId.includes("-")) baseAccountId = baseAccountId.split("-").pop();
  const accessToken = await getAccessToken(acc, userId);
  if (!accessToken) return { error: "トークンなし", _diagnostic: true };
  const start = startDate.replace(/-/g, "");
  const end = endDate.replace(/-/g, "");
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "x-z-base-account-id": baseAccountId || accountId,
  };
  const adFields = await getReportFields("AD", headers);
  const assetFields = await getReportFields("RESPONSIVE_ADS_FOR_SEARCH_ASSET", headers);
  const adRes = await fetchOneReport({
    headers, accountId, start, end,
    reportType: "AD",
    fields: ["CAMPAIGN_NAME", "ADGROUP_NAME", "AD_NAME", "IMPS", "CLICKS", "COST", "CONVERSIONS", "AVG_CPC"],
    reportName: `AdDebug_${start}_${end}`,
    parseRows: parseAdRowsForCreative,
    timeoutMs: 60000,
  });
  let adRows = adRes.error ? [] : (Array.isArray(adRes.rows) ? adRes.rows : []);
  if (adRows.length === 0) {
    const adGroupRes = await fetchOneReport({
      headers, accountId, start, end,
      reportType: "ADGROUP",
      fields: ["CAMPAIGN_NAME", "ADGROUP_NAME", "IMPS", "CLICKS", "COST", "CONVERSIONS"],
      reportName: `AdGroupFallback_${start}_${end}`,
      parseRows: (raw) =>
        (Array.isArray(raw) ? raw : [])
          .filter((r) => r != null && typeof r === "object")
          .map((r) => {
            let campaign = str(getVal(r, "キャンペーン名", "CAMPAIGN_NAME", "campaign_name"));
            let adGroup = str(getVal(r, "広告グループ名", "ADGROUP_NAME", "adgroup_name"));
            let imp = num(getVal(r, "インプレッション数", "IMPS", "imps", "IMPRESSIONS", "impressions"));
            let cl = num(getVal(r, "クリック数", "CLICKS", "clicks"));
            let co = num(getVal(r, "費用", "コスト", "COST", "cost"));
            let cv = num(getVal(r, "コンバージョン数", "CONVERSIONS", "conversions"));
            if (r._vals && r._vals.length >= 5) {
              const v = r._vals;
              if (!campaign) campaign = str(v[0]);
              if (!adGroup) adGroup = str(v[1]);
              if (imp === 0 && cl === 0 && co === 0) {
                imp = num(v[2]);
                cl = num(v[3]);
                co = num(v[4]);
              }
              if (v.length >= 6 && cv === 0) cv = num(v[5]);
            }
            return { campaign, adGroup, adName: "(広告グループ)", impressions: imp, clicks: cl, cost: co, conversions: cv };
          }),
      timeoutMs: 45000,
    });
    if (!adGroupRes.error && Array.isArray(adGroupRes.rows) && adGroupRes.rows.length > 0) {
      adRows = adGroupRes.rows;
      if (process.env.NODE_ENV !== "production") console.log("[Yahoo Ads] AD空のためADGROUPで代替: " + adRows.length + " 件");
    }
  }
  const assetRes = await fetchOneReport({
    headers, accountId, start, end,
    reportType: "RESPONSIVE_ADS_FOR_SEARCH_ASSET",
    fields: ["CAMPAIGN_NAME", "ADGROUP_NAME", "ASSET_TEXT", "ASSET_TYPE", "IMPS"],
    reportName: `AssetDebug_${start}_${end}`,
    parseRows: parseAssetRowsForCreative,
    timeoutMs: 60000,
  });
  const assetRows = assetRes.error ? [] : (Array.isArray(assetRes.rows) ? assetRes.rows : []);
  return {
    adRows,
    assetRows,
    _diagnostic: {
      adFields: adFields.fieldNames,
      assetFields: assetFields.fieldNames,
      adFieldsError: adFields.rawError,
      assetFieldsError: assetFields.rawError,
      ad: { error: adRes.error, rawRowCount: adRes._rawRowCount ?? (Array.isArray(adRes.rows) ? adRes.rows.length : 0), parsedCount: adRows.length, firstRawRow: adRes._rawRow0 || adRes.rows?.[0] || null, firstRawKeys: adRes._rawRow0Keys || (adRes.rows?.[0] ? Object.keys(adRes.rows[0]) : null) },
      asset: { error: assetRes.error, rawRowCount: assetRes._rawRowCount ?? (Array.isArray(assetRes.rows) ? assetRes.rows.length : 0), parsedCount: assetRows.length, firstRawRow: assetRes._rawRow0 || assetRes.rows?.[0] || null, firstRawKeys: assetRes._rawRow0Keys || (assetRes.rows?.[0] ? Object.keys(assetRes.rows[0]) : null) },
    },
  };
}

module.exports = { fetchYahooAdsReport, fetchYahooAdsReportWithMeta, testYahooAccountService, getCampaignRawDownload, getCreativeReportsDebug, cleanupReportJobs };
