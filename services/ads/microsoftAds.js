/**
 * Microsoft Advertising API 連携
 * 環境変数: MICROSOFT_ADS_CLIENT_ID, MICROSOFT_ADS_CLIENT_SECRET, MICROSOFT_ADS_REFRESH_TOKEN,
 *          MICROSOFT_ADS_CUSTOMER_ID
 * 拡張ポイント: https://docs.microsoft.com/en-us/advertising/
 */
async function fetchMicrosoftAdsReport(startDate, endDate) {
  const clientId = (process.env.MICROSOFT_ADS_CLIENT_ID || "").trim();
  const clientSecret = (process.env.MICROSOFT_ADS_CLIENT_SECRET || "").trim();
  const refreshToken = (process.env.MICROSOFT_ADS_REFRESH_TOKEN || "").trim();
  const customerId = (process.env.MICROSOFT_ADS_CUSTOMER_ID || "").trim();

  if (!clientId || !clientSecret || !refreshToken || !customerId) {
    return [];
  }

  try {
    // OAuth で access_token 取得
    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!tokenRes.ok) {
      console.warn("[Microsoft Ads] Token error:", await tokenRes.text());
      return [];
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) return [];

    // Reporting API
    const res = await fetch(
      `https://reporting.api.ads.microsoft.com/v14/reports?customerId=${customerId}&startDate=${startDate}&endDate=${endDate}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) {
      console.warn("[Microsoft Ads] API error:", res.status, await res.text());
      return [];
    }

    const data = await res.json();
    const rows = [];
    const reports = data?.rows || data?.data || [];
    for (const r of reports) {
      rows.push({
        media: "Microsoft Advertising",
        campaign: r.campaignName || r.CampaignName || "",
        impressions: r.impressions || r.Impressions || 0,
        clicks: r.clicks || r.Clicks || 0,
        cost: r.spend || r.Spend || 0,
        conversions: r.conversions || r.Conversions || 0,
      });
    }
    return rows;
  } catch (err) {
    console.error("[Microsoft Ads] API error:", err.message);
    return [];
  }
}

module.exports = { fetchMicrosoftAdsReport };
