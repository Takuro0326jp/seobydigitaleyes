/**
 * Yahoo! 広告 API 連携
 * 環境変数: YAHOO_ADS_ACCESS_TOKEN, YAHOO_ADS_ACCOUNT_ID 等
 * 拡張ポイント: https://ads-api.yahoo.co.jp/
 */
async function fetchYahooAdsReport(startDate, endDate) {
  const accessToken = (process.env.YAHOO_ADS_ACCESS_TOKEN || "").trim();
  const accountId = (process.env.YAHOO_ADS_ACCOUNT_ID || "").trim();

  if (!accessToken || !accountId) {
    return [];
  }

  try {
    // Yahoo! 広告 API v12 (Reporting API)
    const start = startDate.replace(/-/g, "");
    const end = endDate.replace(/-/g, "");
    const url = `https://ads-api.yahoo.co.jp/v12/rest/reporting/getReport?accountId=${accountId}&startDate=${start}&endDate=${end}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      console.warn("[Yahoo Ads] API error:", res.status, await res.text());
      return [];
    }

    const data = await res.json();
    const rows = [];
    const reports = data?.data?.reports || data?.reports || [];
    for (const r of reports) {
      rows.push({
        media: "Yahoo! 広告",
        campaign: r.campaignName || r.campaign_name || "",
        impressions: r.impressions || r.impressionCount || 0,
        clicks: r.clicks || r.clickCount || 0,
        cost: r.cost || r.spend || 0,
        conversions: r.conversions || r.conversionCount || 0,
      });
    }
    return rows;
  } catch (err) {
    console.error("[Yahoo Ads] API error:", err.message);
    return [];
  }
}

module.exports = { fetchYahooAdsReport };
