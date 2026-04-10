/**
 * Meta（Facebook）Marketing API Insights 連携
 * /v25.0/act_{AD_ACCOUNT_ID}/insights で各種レポート取得
 */
const CV_ACTION_TYPES = [
  "offsite_conversion.fb_pixel_purchase",
  "offsite_conversion.fb_pixel_complete_registration",
  "offsite_conversion.fb_pixel_lead",
  "onsite_conversion.lead_grouped",
];

function num(v) {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function extractCv(actions) {
  if (!Array.isArray(actions)) return 0;
  for (const at of CV_ACTION_TYPES) {
    const a = actions.find((x) => x && String(x.action_type || "").toLowerCase() === at.toLowerCase());
    if (a && (a.value !== undefined || a["1d_click"] !== undefined)) {
      return num(a.value ?? a["1d_click"]);
    }
  }
  return 0;
}

function extractCpa(costPerAction) {
  if (!Array.isArray(costPerAction)) return 0;
  for (const at of CV_ACTION_TYPES) {
    const a = costPerAction.find((x) => x && String(x.action_type || "").toLowerCase() === at.toLowerCase());
    if (a && (a.value !== undefined || a["1d_click"] !== undefined)) {
      return num(a.value ?? a["1d_click"]);
    }
  }
  return 0;
}

function extractRoas(purchaseRoas) {
  if (!Array.isArray(purchaseRoas) || purchaseRoas.length === 0) return 0;
  const first = purchaseRoas[0];
  return num(first?.value ?? first?.value ?? first["1d_click"]);
}

async function fetchMetaInsightsPage(adAccountId, token, params) {
  const base = `https://graph.facebook.com/v25.0/${adAccountId}/insights`;
  const qs = new URLSearchParams({
    access_token: token,
    fields: params.fields,
    level: params.level,
  });
  if (params.breakdowns) qs.set("breakdowns", params.breakdowns);
  if (params.time_range) qs.set("time_range", JSON.stringify(params.time_range));
  if (params.limit) qs.set("limit", params.limit);
  if (params.time_increment) qs.set("time_increment", params.time_increment);
  const url = params.pagingUrl || `${base}?${qs.toString()}`;
  const resp = await fetch(url);
  const d = await resp.json().catch(() => ({}));
  if (d.error) throw new Error(d.error.message || "Meta API error");
  return d;
}

async function fetchAllPages(adAccountId, token, params) {
  const all = [];
  let url = null;
  do {
    const d = await fetchMetaInsightsPage(adAccountId, token, url ? { ...params, pagingUrl: url } : params);
    const data = d.data || [];
    all.push(...data);
    url = d.paging?.next || null;
  } while (url);
  return all;
}

const TAB_CONFIG = {
  overview: {
    fields: "spend,impressions,ctr,clicks,actions,cost_per_action_type,purchase_roas",
    level: "account",
    breakdowns: null,
    limit: 100,
  },
  area: {
    fields: "spend,actions,cost_per_action_type,purchase_roas",
    level: "account",
    breakdowns: "region",
    limit: 100,
  },
  time: {
    fields: "spend,actions,cost_per_action_type,purchase_roas",
    level: "account",
    breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone",
    limit: 100,
  },
  campaign: {
    fields: "campaign_name,spend,impressions,ctr,actions,cost_per_action_type,purchase_roas,date_start",
    level: "campaign",
    breakdowns: "publisher_platform",
    limit: 500,
    time_increment: 1,
  },
  creative: {
    fields: "ad_id,campaign_name,adset_name,ad_name,spend,impressions,ctr,clicks,actions,cost_per_action_type,purchase_roas",
    level: "ad",
    breakdowns: null,
    limit: 500,
  },
  keyword: {
    fields: "campaign_name,adset_name,spend,impressions,ctr,clicks,actions,cost_per_action_type,cpc",
    level: "adset",
    breakdowns: null,
    limit: 500,
  },
};

/**
 * Meta Insights を取得し、ads レポート形式にマッピング
 * @param {string} adAccountId - act_XXXXXXXXXX
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {{ rows, areaRows, hourRows, dailyRows, keywordRows, adRows, meta }}
 */
async function fetchMetaInsightsReport(adAccountId, startDate, endDate) {
  const token = (process.env.META_ACCESS_TOKEN || "").trim();
  if (!token) {
    return {
      rows: [],
      areaRows: [],
      hourRows: [],
      dailyRows: [],
      keywordRows: [],
      adRows: [],
      meta: { error: "META_ACCESS_TOKEN が設定されていません" },
    };
  }
  const rawId = String(adAccountId || "").trim();
  const actId = rawId.startsWith("act_") ? rawId : "act_" + rawId;
  const timeRange = { since: startDate, until: endDate };

  const rows = [];
  let areaRows = [];
  let hourRows = [];
  let dailyRows = [];
  let keywordRows = [];
  let adRows = [];
  let overviewSpend = 0;
  let overviewCv = 0;

  try {
    const [overviewData, areaData, timeData, campaignData, creativeData, keywordData] = await Promise.all([
      fetchAllPages(actId, token, { ...TAB_CONFIG.overview, time_range: timeRange }),
      fetchAllPages(actId, token, { ...TAB_CONFIG.area, time_range: timeRange }),
      fetchAllPages(actId, token, { ...TAB_CONFIG.time, time_range: timeRange }),
      fetchAllPages(actId, token, { ...TAB_CONFIG.campaign, time_range: timeRange }),
      fetchAllPages(actId, token, { ...TAB_CONFIG.creative, time_range: timeRange }),
      fetchAllPages(actId, token, { ...TAB_CONFIG.keyword, time_range: timeRange }),
    ]);

    function platformToMedia(platform) {
      const p = String(platform || "").toLowerCase();
      if (p === "facebook") return "Facebook広告";
      if (p === "instagram") return "Instagram広告";
      if (p === "audience_network") return "Audience Network";
      if (p === "messenger") return "Messenger広告";
      return "Meta";
    }

    const byCampaignPlatform = new Map();
    campaignData.forEach((r) => {
      const name = r.campaign_name || "（名前なし）";
      const platform = r.publisher_platform || "";
      const key = `${name}\t${platform}`;
      if (!byCampaignPlatform.has(key)) byCampaignPlatform.set(key, { name, platform, impressions: 0, clicks: 0, cost: 0, conversions: 0 });
      const acc = byCampaignPlatform.get(key);
      acc.impressions += num(r.impressions);
      acc.clicks += num(r.clicks);
      acc.cost += num(r.spend);
      acc.conversions += extractCv(r.actions);
    });
    byCampaignPlatform.forEach((acc) => {
      rows.push({
        media: platformToMedia(acc.platform),
        campaign: acc.name,
        impressions: acc.impressions,
        clicks: acc.clicks,
        cost: acc.cost,
        conversions: acc.conversions,
      });
    });
    if (rows.length === 0 && overviewData.length > 0) {
      let tSpend = 0, tImp = 0, tClicks = 0, tCv = 0;
      overviewData.forEach((r) => {
        tSpend += num(r.spend);
        tImp += num(r.impressions);
        tClicks += num(r.clicks);
        tCv += extractCv(r.actions);
      });
      rows.push({
        media: "Meta",
        campaign: "アカウント合計",
        impressions: tImp,
        clicks: tClicks,
        cost: tSpend,
        conversions: tCv,
      });
    }

    areaData.forEach((r) => {
      const spend = num(r.spend);
      const cv = extractCv(r.actions);
      areaRows.push({
        media: "Meta",
        pref: r.region || "—",
        campaign: "Meta",
        impressions: 0,
        clicks: 0,
        cost: spend,
        conversions: cv,
      });
    });

    timeData.forEach((r) => {
      const spend = num(r.spend);
      const cv = extractCv(r.actions);
      const hourVal = r.hourly_stats_aggregated_by_advertiser_time_zone ?? r.hour_of_day ?? "";
      hourRows.push({
        hourOfDay: String(hourVal),
        dayOfWeek: "",
        impressions: 0,
        clicks: 0,
        cost: spend,
        conversions: cv,
      });
    });

    const byDate = new Map();
    campaignData.forEach((r) => {
      const dateStart = r.date_start;
      if (dateStart) {
        const day = String(dateStart).replace(/-/g, "").slice(0, 8);
        if (/^\d{8}$/.test(day)) {
          if (!byDate.has(day)) byDate.set(day, { date: day, impressions: 0, clicks: 0, cost: 0, conversions: 0 });
          const d = byDate.get(day);
          d.impressions += num(r.impressions);
          d.clicks += num(r.clicks);
          d.cost += num(r.spend);
          d.conversions += extractCv(r.actions);
        }
      }
    });
    dailyRows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

    // 広告の画像URL取得（ad_id → creative → thumbnail_url/image_url）
    const adImageMap = new Map();
    try {
      const adIds = [...new Set(creativeData.map((r) => r.ad_id).filter(Boolean))];
      if (adIds.length > 0) {
        // バッチで広告のcreative情報を取得（最大50件ずつ）
        // image_url: フルサイズ静止画、thumbnail_url: 動画サムネ（小さい）
        // object_story_specからimage_hashを取得してフルサイズURL解決
        for (let i = 0; i < adIds.length; i += 50) {
          const batch = adIds.slice(i, i + 50);
          const idsParam = batch.join(",");
          const url = `https://graph.facebook.com/v25.0/?ids=${idsParam}&fields=creative{image_url,thumbnail_url,object_story_spec}&access_token=${token}`;
          const resp = await fetch(url);
          const data = await resp.json().catch(() => ({}));
          if (!data.error) {
            const imageHashes = [];
            for (const [adId, info] of Object.entries(data)) {
              const cr = info?.creative || {};
              // image_urlがあればフルサイズなのでそのまま使う
              if (cr.image_url) {
                adImageMap.set(adId, cr.image_url);
              } else {
                // object_story_specからimage_hashを探す
                const oss = cr.object_story_spec || {};
                const hash = oss.link_data?.image_hash || oss.photo_data?.image_hash || oss.video_data?.image_hash || "";
                if (hash) {
                  imageHashes.push({ adId, hash });
                } else if (cr.thumbnail_url) {
                  adImageMap.set(adId, cr.thumbnail_url);
                }
              }
            }
            // image_hashからフルサイズURLを解決
            if (imageHashes.length > 0) {
              const hashes = [...new Set(imageHashes.map((h) => h.hash))];
              const hashUrl = `https://graph.facebook.com/v25.0/${actId}/adimages?hashes=${JSON.stringify(hashes)}&access_token=${token}`;
              const hashResp = await fetch(hashUrl);
              const hashData = await hashResp.json().catch(() => ({}));
              const hashToUrl = {};
              if (hashData.data) {
                hashData.data.forEach((img) => {
                  if (img.hash && img.url) hashToUrl[img.hash] = img.url;
                  if (img.hash && img.url_128) hashToUrl[img.hash] = hashToUrl[img.hash] || img.url_128;
                });
              }
              imageHashes.forEach(({ adId, hash }) => {
                if (hashToUrl[hash]) adImageMap.set(adId, hashToUrl[hash]);
              });
            }
          }
        }
        if (adImageMap.size > 0) console.log(`[Meta Ads] 画像URL取得: ${adImageMap.size}件`);
      }
    } catch (e) {
      console.warn("[Meta Ads] 画像URL取得エラー（スキップ）:", e.message);
    }

    creativeData.forEach((r) => {
      const spend = num(r.spend);
      const imp = num(r.impressions);
      const clicks = num(r.clicks);
      const cv = extractCv(r.actions);
      adRows.push({
        media: "Meta",
        campaign: r.campaign_name || "—",
        adGroup: r.adset_name || "—",
        adName: r.ad_name || "—",
        impressions: imp,
        clicks,
        cost: spend,
        conversions: cv,
        avgCpc: num(r.cpc),
        imageUrl: adImageMap.get(r.ad_id) || "",
      });
    });

    keywordData.forEach((r) => {
      const spend = num(r.spend);
      const imp = num(r.impressions);
      const clicks = num(r.clicks);
      const cv = extractCv(r.actions);
      keywordRows.push({
        media: "Meta",
        keyword: r.adset_name || "—",
        campaign: r.campaign_name || "—",
        impressions: imp,
        clicks,
        cost: spend,
        conversions: cv,
        avgCpc: num(r.cpc),
      });
    });

    console.log(`[Meta Ads] 取得完了: overview=${rows.length}, area=${areaRows.length}, hour=${hourRows.length}, campaign=${campaignData.length}, creative=${adRows.length}, keyword=${keywordRows.length} (${startDate}〜${endDate})`);
  } catch (e) {
    console.error("[Meta Ads] API error:", e.message);
    return {
      rows: [],
      areaRows: [],
      hourRows: [],
      dailyRows: [],
      keywordRows: [],
      adRows: [],
      meta: { error: e.message || "Meta API エラー" },
    };
  }

  return {
    rows,
    areaRows,
    hourRows,
    dailyRows,
    keywordRows,
    adRows,
    assetRows: [],
    meta: {
      requested_startDate: startDate,
      requested_endDate: endDate,
      meta_account_id: actId,
      meta_row_count: rows.length,
    },
  };
}

module.exports = {
  fetchMetaInsightsReport,
};
