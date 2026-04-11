/**
 * Google Ads API 連携
 * 1. 環境変数から取得（GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_*）
 * 2. userId 指定時は google_ads_tokens / getSelectedAccount からトークンを取得
 *
 * 媒体ラベル: 仕様上「Google」表記の例もあるが、ダッシュボードの媒体フィルタと一致させるため "Google Ads" を使用する。
 */
const pool = require("../../db");

/** 依頼マッピング: cost_micros / average_cpc は円に換算 */
function microsToYen(v) {
  return Math.round(Number(v || 0) / 1_000_000);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** CTR は API 上は比率（例: 0.05 = 5%）→ パーセント表示用に ×100 */
function ctrToPercent(m) {
  const v = num(m);
  if (v <= 1 && v >= 0) return v * 100;
  return v;
}

function pickHourFromSegment(seg) {
  if (!seg) return "";
  let h = seg.hour ?? seg.hour_of_day ?? seg.hourOfDay;
  if (h == null || h === "") return "";
  if (typeof h === "object" && h !== null) h = h.name ?? h.toString?.() ?? "";
  const s = String(h).toUpperCase();
  const m = s.match(/HOUR_OF_DAY_(\d{1,2})|(\d{1,2})/);
  if (!m) return "";
  const n = parseInt(m[1] || m[2], 10);
  return Number.isFinite(n) && n >= 0 && n <= 23 ? String(n) : "";
}

function pickDowFromSegment(seg) {
  if (!seg) return "";
  let d = seg.day_of_week ?? seg.dayOfWeek;
  if (d == null || d === "") return "";
  if (typeof d === "object" && d !== null) d = d.name ?? d.toString?.() ?? "";
  return String(d).replace(/^DAY_OF_WEEK_/, "").toUpperCase();
}

const GOOGLE_MEDIA = "Google Ads";

/** advertising_channel_type → 媒体ラベル（文字列 / 数値enum 両対応） */
const CHANNEL_NUM_MAP = { 2: "SEARCH", 3: "DISPLAY", 6: "VIDEO", 7: "SHOPPING", 11: "PERFORMANCE_MAX", 13: "DEMAND_GEN" };
function googleChannelToMedia(channelType) {
  let ch = channelType;
  if (typeof ch === "number" || /^\d+$/.test(String(ch))) ch = CHANNEL_NUM_MAP[Number(ch)] || "";
  ch = String(ch || "").toUpperCase();
  if (ch === "SEARCH") return "Google検索広告";
  if (ch === "DISPLAY") return "Googleディスプレイ広告";
  if (ch === "VIDEO") return "Google動画広告";
  if (ch === "SHOPPING") return "Googleショッピング広告";
  if (ch === "PERFORMANCE_MAX") return "Google P-MAX";
  if (ch === "DEMAND_GEN") return "Google Demand Gen";
  return "Google Ads";
}

/** Google Ads Geo Target ID → 表示名（主要国） */
const GEO_TARGET_NAMES = {
  2392: "日本",
  2840: "アメリカ",
  2826: "イギリス",
  2124: "カナダ",
  2036: "オーストラリア",
  2156: "中国",
  2410: "韓国",
  2158: "台湾",
  2702: "シンガポール",
  2764: "タイ",
  2360: "インドネシア",
  2608: "フィリピン",
  2704: "ベトナム",
  2356: "インド",
  2276: "ドイツ",
  2250: "フランス",
  2380: "イタリア",
  2724: "スペイン",
  2076: "ブラジル",
  2484: "メキシコ",
  2643: "ロシア",
  2344: "香港",
  2458: "マレーシア",
  2554: "ニュージーランド",
};

/** API 例外を画面・_hint 用の短文に（権限エラー時は MCC の案内を付与） */
function userMessageFromGoogleAdsException(err) {
  const m = err?.message || String(err);
  const short = m.length > 380 ? m.slice(0, 380) + "…" : m;
  let extra = "";
  if (/permission|PERMISSION_DENIED|not permitted|does not have permission|USER_PERMISSION_DENIED/i.test(m)) {
    extra =
      " MCC配下の運用アカウントでは、API認証元に MCC ID（login_customer_id）を登録し、Customer ID はクライアント（広告運用）側を指定してください。";
  }
  return `Google Ads API エラー: ${short}${extra}`;
}

async function collectQueryRows(customer, gaql, toArray) {
  const result = await customer.query(gaql);
  const rows = [];
  if (Array.isArray(result)) rows.push(...result);
  else if (result && typeof result[Symbol.asyncIterator] === "function") {
    for await (const row of result) rows.push(row);
  } else if (result && typeof result[Symbol.iterator] === "function") {
    rows.push(...result);
  } else {
    const arr = toArray(result);
    rows.push(...arr);
  }
  return rows;
}

async function safeQuery(customer, gaql, label, toArray) {
  try {
    return await collectQueryRows(customer, gaql, toArray);
  } catch (e) {
    const gaDetail = e?.errors?.map?.((x) => x.message || x).join("; ") || e?.failure?.errors?.[0]?.message || "";
    console.warn(`[Google Ads] GAQL ${label} failed:`, e.message || e, gaDetail ? `| ${gaDetail}` : "");
    return [];
  }
}

/** 主クエリが例外のときだけフォールバック GAQL を試す（空行は「データなし」とみなす） */
async function safeQueryPrimaryFallback(customer, primaryGaql, fallbackGaql, label, toArray) {
  try {
    return await collectQueryRows(customer, primaryGaql, toArray);
  } catch (e) {
    const gaDetail = e?.errors?.map?.((x) => x.message || x).join("; ") || "";
    console.warn(`[Google Ads] GAQL ${label} primary failed:`, e.message || e, gaDetail ? `| ${gaDetail}` : "");
    if (!fallbackGaql) return [];
    try {
      const rows = await collectQueryRows(customer, fallbackGaql, toArray);
      console.warn(`[Google Ads] GAQL ${label} fallback ok, rows=${rows.length}`);
      return rows;
    } catch (e2) {
      const d2 = e2?.errors?.map?.((x) => x.message || x).join("; ") || "";
      console.warn(`[Google Ads] GAQL ${label} fallback failed:`, e2.message || e2, d2 ? `| ${d2}` : "");
      return [];
    }
  }
}

async function fetchGoogleAdsReportWithMeta(startDate, endDate, userId = null, options = {}) {
  const wantDebug = !!(options && options.debug);
  const developerToken = (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
  const clientId = (process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "").trim();

  let refreshToken = (process.env.GOOGLE_ADS_REFRESH_TOKEN || "").trim();
  let customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || "").trim().replace(/-/g, "");
  let loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").trim().replace(/-/g, "");

  // company_url_id ベースのアカウント解決（優先）
  if (options?.company_url_id) {
    try {
      const { getAccountForCompanyUrl } = require("../companyUrlAdsAccounts");
      const acc = await getAccountForCompanyUrl(options.company_url_id, "google");
      if (acc?.refresh_token) {
        refreshToken = acc.refresh_token;
        customerId = String(acc.customer_id || "").trim().replace(/-/g, "") || customerId;
        const lid = String(acc.login_customer_id ?? "").trim().replace(/-/g, "");
        if (lid) loginCustomerId = lid;
      }
    } catch (e) {
      if (process.env.NODE_ENV !== "production") console.warn("[Google Ads] getAccountForCompanyUrl error:", e.message);
    }
  } else if (userId) {
    try {
      const { getSelectedAccount } = require("../googleAdsAccounts");
      const acc = await getSelectedAccount(userId);
      if (acc?.refresh_token) {
        refreshToken = acc.refresh_token;
        customerId = String(acc.customer_id || "").trim().replace(/-/g, "") || customerId;
        const lid = String(acc.login_customer_id ?? "").trim().replace(/-/g, "");
        if (lid) loginCustomerId = lid;
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
    console.warn("[Google Ads] skip fetch: missing_config", {
      has_developer_token: !!developerToken,
      has_customer_id: !!customerId,
    });
    const missingMsg =
      "Google Ads の認証情報が不足しています（Developer Token / OAuth / 選択中アカウントの Customer ID など）。API連携設定と「使用中のアカウント」を確認してください。";
    return {
      rows: [],
      areaRows: [],
      hourRows: [],
      dailyRows: [],
      keywordRows: [],
      adRows: [],
      assetRows: [],
      customerId: null,
      google_api_error: missingMsg,
      _hint: missingMsg,
      _debug: wantDebug
        ? {
            error: "missing_config",
            hint: "developerToken/clientId/clientSecret/refreshToken/customerId のいずれかが未設定",
            has_developer_token: !!developerToken,
            has_client_id: !!clientId,
            has_client_secret: !!clientSecret,
            has_refresh_token: !!refreshToken,
            has_customer_id: !!customerId,
            has_login_customer_id: !!loginCustomerId,
          }
        : undefined,
    };
  }

  const toArray = (r) => {
    if (Array.isArray(r)) return r;
    if (r?.results?.length) return r.results;
    if (r?.response?.length) return r.response;
    if (r?.rows?.length) return r.rows;
    return [];
  };

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
    } else if (userId) {
      // MCC 配下のクライアントアカウントには login_customer_id が必須
      console.warn(
        "[Google Ads] login_customer_id が未設定です (customerId=%s, userId=%s)。" +
        "MCC配下のアカウントの場合、API認証元にMCCのCustomer IDを設定してください。",
        customerId, userId
      );
    }
    const customer = client.Customer(customerOptions);

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
        areaRows: [],
        hourRows: [],
        dailyRows: [],
        keywordRows: [],
        adRows: [],
        assetRows: [],
        customerId,
        google_api_error: hint,
        _debug: wantDebug ? { is_manager_account: true, hint } : undefined,
        _hint: hint,
      };
    }

    const toIso = (d) => {
      const s = String(d || "").trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const c = s.replace(/\D/g, "");
      if (c.length === 8) return `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}`;
      return s;
    };
    const startIso = toIso(startDate);
    const endIso = toIso(endDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startIso) || !/^\d{4}-\d{2}-\d{2}$/.test(endIso) || startIso > endIso) {
      const badRange = { startDate, endDate, startIso, endIso };
      console.warn("[Google Ads] skip fetch: invalid_date_range", badRange);
      const dateHint = "Google Ads の取得に使う日付（開始・終了）が無効です。YYYY-MM-DD 形式で指定してください。";
      return {
        rows: [],
        areaRows: [],
        hourRows: [],
        dailyRows: [],
        keywordRows: [],
        adRows: [],
        assetRows: [],
        customerId,
        google_api_error: dateHint,
        _debug: wantDebug ? { error: "invalid_date_range", ...badRange } : undefined,
        _hint: dateHint,
      };
    }
    const dateWhere = `segments.date BETWEEN '${startIso}' AND '${endIso}'`;

    const qCampaign = `
      SELECT
        segments.date,
        campaign.name,
        campaign.advertising_channel_type,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.conversions,
        metrics.cost_per_conversion,
        metrics.conversions_value
      FROM campaign
      WHERE ${dateWhere}
        AND campaign.status != 'REMOVED'`;

    const qCampaignNoConvValue = `
      SELECT
        segments.date,
        campaign.name,
        campaign.advertising_channel_type,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.conversions,
        metrics.cost_per_conversion
      FROM campaign
      WHERE ${dateWhere}
        AND campaign.status != 'REMOVED'`;

    const qCampaignMinimal = `
      SELECT
        segments.date,
        campaign.name,
        campaign.advertising_channel_type,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM campaign
      WHERE ${dateWhere}
        AND campaign.status != 'REMOVED'`;

    const qArea = `
      SELECT
        segments.date,
        user_location_view.country_criterion_id,
        metrics.cost_micros,
        metrics.impressions,
        metrics.conversions
      FROM user_location_view
      WHERE ${dateWhere}
        AND user_location_view.country_criterion_id != 0`;

    const qHour = `
      SELECT
        segments.date,
        segments.hour,
        segments.day_of_week,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM campaign
      WHERE ${dateWhere}
        AND campaign.status != 'REMOVED'`;

    const qAd = `
      SELECT
        segments.date,
        campaign.name,
        campaign.advertising_channel_type,
        ad_group.name,
        ad_group_ad.ad.name,
        ad_group_ad.ad.type,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions,
        metrics.cost_per_conversion
      FROM ad_group_ad
      WHERE ${dateWhere}
        AND ad_group_ad.status != 'REMOVED'`;

    const qAdNoCostPerConv = `
      SELECT
        segments.date,
        campaign.name,
        campaign.advertising_channel_type,
        ad_group.name,
        ad_group_ad.ad.name,
        ad_group_ad.ad.type,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM ad_group_ad
      WHERE ${dateWhere}
        AND ad_group_ad.status != 'REMOVED'`;

    const qKeyword = `
      SELECT
        segments.date,
        ad_group_criterion.resource_name,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group_criterion.cpc_bid_micros,
        ad_group.name,
        campaign.name,
        campaign.advertising_channel_type,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.conversions,
        metrics.average_cpc
      FROM keyword_view
      WHERE ${dateWhere}
        AND ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.status != 'REMOVED'`;

    const qKeywordNoAvgCpc = `
      SELECT
        segments.date,
        ad_group_criterion.resource_name,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group_criterion.cpc_bid_micros,
        ad_group.name,
        campaign.name,
        campaign.advertising_channel_type,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.conversions
      FROM keyword_view
      WHERE ${dateWhere}
        AND ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.status != 'REMOVED'`;

    const qDaily = `
      SELECT
        segments.date,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM campaign
      WHERE ${dateWhere}
        AND campaign.status != 'REMOVED'`;

    let campaignRows = await safeQuery(customer, qCampaign, "campaign", toArray);
    if (campaignRows.length === 0) {
      campaignRows = await safeQuery(customer, qCampaignNoConvValue, "campaign_no_conversions_value", toArray);
    }
    if (campaignRows.length === 0) {
      campaignRows = await safeQuery(customer, qCampaignMinimal, "campaign_minimal", toArray);
    }

    // 画像アセットクエリ: ad_group_ad_asset_view から画像URLとサイズを取得
    const qAdAssetImage = `
      SELECT
        ad_group_ad_asset_view.ad_group_ad,
        asset.image_asset.full_size.url,
        asset.image_asset.full_size.width_pixels,
        asset.image_asset.full_size.height_pixels,
        asset.type
      FROM ad_group_ad_asset_view
      WHERE asset.type = 'IMAGE'`;

    const [areaRowsRaw, hourRowsRaw, dailyRowsRaw, adRowsRaw, keywordRowsRaw, adImageRaw] = await Promise.all([
      safeQuery(customer, qArea, "user_location_view", toArray),
      safeQuery(customer, qHour, "hour", toArray),
      safeQuery(customer, qDaily, "daily", toArray),
      safeQueryPrimaryFallback(customer, qAd, qAdNoCostPerConv, "ad_group_ad", toArray),
      safeQueryPrimaryFallback(customer, qKeyword, qKeywordNoAvgCpc, "keyword_view", toArray),
      safeQuery(customer, qAdAssetImage, "ad_image_asset", toArray),
    ]);

    // 広告リソース名 → 画像URLマッピング（横長1200x628を優先、なければ最大サイズ）
    const adImageMap = new Map();
    for (const row of adImageRaw) {
      // asset_viewのresource_nameから広告のresource_nameを抽出
      // 形式: customers/{id}/adGroupAdAssetViews/{adGroupId}~{adId}~{assetId}~{fieldType}
      const viewResource = row.ad_group_ad_asset_view?.resource_name
        || row.adGroupAdAssetView?.resourceName || "";
      const m = viewResource.match(/customers\/(\d+)\/adGroupAdAssetViews\/(\d+~\d+)/);
      const adResource = m ? `customers/${m[1]}/adGroupAds/${m[2]}` : "";
      const imgAsset = row.asset?.image_asset || row.asset?.imageAsset || {};
      const fs = imgAsset.full_size || imgAsset.fullSize || {};
      const imageUrl = fs.url || "";
      const w = Number(fs.width_pixels || fs.widthPixels || 0);
      const h = Number(fs.height_pixels || fs.heightPixels || 0);
      if (!adResource || !imageUrl) continue;
      const existing = adImageMap.get(adResource);
      // 優先: 横長(w>h)で大きいもの → なければ最大面積
      const score = (w > h ? 10000000 : 0) + w * h;
      if (!existing || score > existing.score) {
        adImageMap.set(adResource, { url: imageUrl, w, h, score });
      }
    }
    if (adImageMap.size > 0) console.log(`[Google Ads] 画像URL取得: ${adImageMap.size}広告`);

    const byCampaign = new Map();
    for (const row of campaignRows) {
      const name = row.campaign?.name || "";
      const channelType = row.campaign?.advertising_channel_type || row.campaign?.advertisingChannelType || "";
      const m = row.metrics || {};
      if (!byCampaign.has(name)) {
        byCampaign.set(name, {
          name,
          channelType,
          impressions: 0,
          clicks: 0,
          cost: 0,
          conversions: 0,
          conversionsValue: 0,
          ctrNumerator: 0,
        });
      }
      const acc = byCampaign.get(name);
      acc.impressions += num(m.impressions);
      acc.clicks += num(m.clicks);
      acc.cost += microsToYen(m.cost_micros);
      acc.conversions += num(m.conversions);
      acc.conversionsValue += num(m.conversions_value);
      acc.ctrNumerator += ctrToPercent(m.ctr) * num(m.impressions);
    }

    const rows = [];
    for (const [, v] of byCampaign) {
      const ctrPct = v.impressions > 0 ? Math.round((v.ctrNumerator / v.impressions) * 100) / 100 : 0;
      rows.push({
        media: googleChannelToMedia(v.channelType),
        campaign: v.name,
        impressions: v.impressions,
        clicks: v.clicks,
        cost: v.cost,
        conversions: Math.round(v.conversions * 100) / 100,
        conversionsValue: Math.round(v.conversionsValue),
        ctr: ctrPct,
      });
    }

    const byCountry = new Map();
    for (const row of areaRowsRaw) {
      const ulv = row.user_location_view || row;
      const id = ulv.country_criterion_id ?? ulv.countryCriterionId;
      const key = String(id != null ? id : "unknown");
      const m = row.metrics || {};
      if (!byCountry.has(key)) {
        const name = GEO_TARGET_NAMES[Number(key)] || `その他 (${key})`;
        byCountry.set(key, { pref: name, impressions: 0, cost: 0, conversions: 0 });
      }
      const a = byCountry.get(key);
      a.impressions += num(m.impressions);
      a.cost += microsToYen(m.cost_micros);
      a.conversions += num(m.conversions);
    }
    const areaRows = [...byCountry.values()].map((v) => ({
      media: GOOGLE_MEDIA,
      pref: v.pref,
      impressions: v.impressions,
      cost: v.cost,
      conversions: v.conversions,
    }));

    const byHour = new Map();
    for (const row of hourRowsRaw) {
      const seg = row.segments || {};
      const hourVal = pickHourFromSegment(seg);
      const dowVal = pickDowFromSegment(seg);
      const hkey = `${hourVal}_${dowVal}`;
      const m = row.metrics || {};
      if (!byHour.has(hkey)) {
        byHour.set(hkey, {
          hourOfDay: hourVal || "—",
          dayOfWeek: dowVal || "—",
          impressions: 0,
          clicks: 0,
          cost: 0,
          conversions: 0,
        });
      }
      const h = byHour.get(hkey);
      h.impressions += num(m.impressions);
      h.clicks += num(m.clicks);
      h.cost += microsToYen(m.cost_micros);
      h.conversions += num(m.conversions);
    }
    const hourRows = [...byHour.values()];

    const byAd = new Map();
    for (const row of adRowsRaw) {
      const camp = row.campaign?.name || "";
      const channelType = row.campaign?.advertising_channel_type || row.campaign?.advertisingChannelType || "";
      const ag = row.ad_group?.name || row.adGroup?.name || "";
      const ad = row.ad_group_ad?.ad || row.adGroupAd?.ad || {};
      const adName = ad.name || "(広告)";
      const adType = ad.type != null ? String(ad.type).replace(/^AD_TYPE_/, "") : "";
      const key = `${camp}\t${ag}\t${adName}\t${adType}`;
      const m = row.metrics || {};
      // 画像URL: ad_group_adのresource_nameで紐付け
      const adGroupAdResource = row.ad_group_ad?.resource_name || row.adGroupAd?.resourceName || "";
      const imgEntry = adImageMap.get(adGroupAdResource);
      const imageUrl = imgEntry?.url || "";
      if (!byAd.has(key)) {
        byAd.set(key, {
          campaign: camp,
          channelType,
          adGroup: ag,
          adName,
          format: adType,
          imageUrl,
          impressions: 0,
          clicks: 0,
          cost: 0,
          conversions: 0,
        });
      }
      const a = byAd.get(key);
      a.impressions += num(m.impressions);
      a.clicks += num(m.clicks);
      a.cost += microsToYen(m.cost_micros);
      a.conversions += num(m.conversions);
    }
    const adRows = [...byAd.values()].map((v) => ({
      media: googleChannelToMedia(v.channelType),
      campaign: v.campaign,
      adGroup: v.adGroup,
      adName: v.adName,
      impressions: v.impressions,
      clicks: v.clicks,
      cost: v.cost,
      conversions: v.conversions,
      format: v.format,
      imageUrl: v.imageUrl || "",
    }));

    const byKeyword = new Map();
    for (const row of keywordRowsRaw) {
      const crit = row.ad_group_criterion || row.adGroupCriterion || {};
      const kw = crit.keyword || {};
      const text = kw.text || "";
      const camp = row.campaign?.name || "";
      const channelType = row.campaign?.advertising_channel_type || row.campaign?.advertisingChannelType || "";
      const adGroupName = row.ad_group?.name || row.adGroup?.name || "";
      const resourceName = crit.resource_name || crit.resourceName || "";
      const matchType = kw.match_type || kw.matchType || "";
      const status = crit.status || "";
      const cpcBidMicros = num(crit.cpc_bid_micros || crit.cpcBidMicros);
      const key = `${camp}\t${text}\t${matchType}`;
      const m = row.metrics || {};
      const imp = num(m.impressions);
      const clk = num(m.clicks);
      if (!byKeyword.has(key)) {
        byKeyword.set(key, {
          keyword: text,
          campaign: camp,
          adGroup: adGroupName,
          channelType,
          resourceName,
          matchType,
          status,
          cpcBidMicros,
          impressions: 0,
          clicks: 0,
          cost: 0,
          conversions: 0,
          ctrNumerator: 0,
          avgCpcMicrosWeighted: 0,
          avgCpcClkWeight: 0,
        });
      }
      const k = byKeyword.get(key);
      k.impressions += imp;
      k.clicks += clk;
      k.cost += microsToYen(m.cost_micros);
      k.conversions += num(m.conversions);
      k.ctrNumerator += ctrToPercent(m.ctr) * imp;
      const cpcMicros = num(m.average_cpc);
      if (cpcMicros > 0 && clk > 0) {
        k.avgCpcMicrosWeighted += cpcMicros * clk;
        k.avgCpcClkWeight += clk;
      }
      // 最新のリソース名・ステータスを保持
      if (resourceName) k.resourceName = resourceName;
      if (status) k.status = status;
    }
    const keywordRows = [...byKeyword.values()].map((v) => ({
      media: googleChannelToMedia(v.channelType),
      keyword: v.keyword,
      campaign: v.campaign,
      adGroup: v.adGroup,
      resourceName: v.resourceName,
      matchType: v.matchType,
      status: v.status,
      cpcBid: v.cpcBidMicros > 0 ? microsToYen(v.cpcBidMicros) : 0,
      impressions: v.impressions,
      clicks: v.clicks,
      cost: v.cost,
      ctr: v.impressions > 0 ? Math.round((v.ctrNumerator / v.impressions) * 100) / 100 : 0,
      conversions: Math.round(v.conversions * 100) / 100,
      avgCpc: Math.round(
        v.avgCpcClkWeight > 0
          ? microsToYen(v.avgCpcMicrosWeighted / v.avgCpcClkWeight)
          : v.clicks > 0
            ? v.cost / v.clicks
            : 0
      ),
    }));

    const byDay = new Map();
    for (const row of dailyRowsRaw) {
      const seg = row.segments || {};
      const d = seg.date;
      if (!d) continue;
      const key = String(d).replace(/\D/g, "").slice(0, 8);
      if (!/^\d{8}$/.test(key)) continue;
      const m = row.metrics || {};
      if (!byDay.has(key)) {
        byDay.set(key, { date: key, impressions: 0, clicks: 0, cost: 0, conversions: 0 });
      }
      const a = byDay.get(key);
      a.impressions += num(m.impressions);
      a.clicks += num(m.clicks);
      a.cost += microsToYen(m.cost_micros);
      a.conversions += num(m.conversions);
    }
    const dailyRows = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));

    let debugInfo;
    if (wantDebug) {
      debugInfo = {
        customer_id_used: customerId,
        login_customer_id_used: loginCustomerId || "(MCC未設定・MCC配下の場合は必須)",
        date_range: { startDate: startIso, endDate: endIso },
        counts: {
          campaign: rows.length,
          area: areaRows.length,
          hour: hourRows.length,
          ad: adRows.length,
          keyword: keywordRows.length,
          daily: dailyRows.length,
        },
        gaql_campaign: qCampaign.slice(0, 400),
      };
    }

    const emptyHint =
      rows.length === 0
        ? "指定期間にキャンペーンデータがありません。別の月を試すか、Google Ads 管理画面で該当アカウントのキャンペーン・実績を確認してください。MCC の場合は、クライアント（広告運用）アカウント ID を連携してください。"
        : null;

    return {
      rows,
      areaRows,
      hourRows,
      dailyRows,
      keywordRows,
      adRows,
      assetRows: [],
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
        areaRows: [],
        hourRows: [],
        dailyRows: [],
        keywordRows: [],
        adRows: [],
        assetRows: [],
        customerId,
        google_api_error: hint,
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
    const apiUserMsg = userMessageFromGoogleAdsException(err);
    return {
      rows: [],
      areaRows: [],
      hourRows: [],
      dailyRows: [],
      keywordRows: [],
      adRows: [],
      assetRows: [],
      customerId,
      google_api_error: apiUserMsg,
      _hint: apiUserMsg,
      _debug: debugInfo,
    };
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

/**
 * Google Ads キーワード操作（ステータス変更・入札額調整）
 * @param {string} customerId - Google Ads アカウントID
 * @param {string} resourceName - キーワードのリソース名 (customers/xxx/adGroupCriteria/xxx~xxx)
 * @param {object} updates - { status?: "ENABLED"|"PAUSED", cpcBidMicros?: number }
 */
async function mutateKeyword(customerId, resourceName, updates, { refreshToken, loginCustomerId } = {}) {
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
  const developerToken = (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
  if (!clientId || !clientSecret || !developerToken || !refreshToken) {
    throw new Error("Google Ads API の認証情報が不足しています");
  }

  const { GoogleAdsApi } = require("google-ads-api");
  const client = new GoogleAdsApi({ client_id: clientId, client_secret: clientSecret, developer_token: developerToken });
  const opts = { customer_id: customerId, refresh_token: refreshToken };
  if (loginCustomerId) opts.login_customer_id = loginCustomerId;
  const customer = client.Customer(opts);

  const updateObj = { resource_name: resourceName };
  const updateMask = [];
  if (updates.status) {
    updateObj.status = updates.status; // "ENABLED" or "PAUSED"
    updateMask.push("status");
  }
  if (updates.cpcBidMicros != null) {
    updateObj.cpc_bid_micros = updates.cpcBidMicros;
    updateMask.push("cpc_bid_micros");
  }

  const result = await customer.mutateResources([
    {
      _resource: "AdGroupCriterion",
      _operation: "update",
      ...updateObj,
    },
  ]);
  return result;
}

module.exports = { fetchGoogleAdsReport, fetchGoogleAdsReportWithMeta, validateCustomerAccess, mutateKeyword };
