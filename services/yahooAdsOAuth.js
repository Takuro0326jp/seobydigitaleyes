/**
 * Yahoo! JAPAN Ads API OAuth2
 * 認証: https://biz-oauth.yahoo.co.jp/oauth
 * scope: yahooads
 */
const pool = require("../db");

const YAHOO_AUTH_URL = "https://biz-oauth.yahoo.co.jp/oauth/v1/authorize";
const YAHOO_TOKEN_URL = "https://biz-oauth.yahoo.co.jp/oauth/v1/token";
const YAHOO_SCOPE = "yahooads";

function getClientConfig() {
  const clientId = (process.env.YAHOO_ADS_CLIENT_ID || process.env.YAHOO_CLIENT_ID || "").trim();
  const clientSecret = (process.env.YAHOO_ADS_CLIENT_SECRET || process.env.YAHOO_CLIENT_SECRET || "").trim();
  return { clientId, clientSecret };
}

function getRedirectUri(req) {
  const base = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
  return `${base.replace(/\/$/, "")}/api/ads/yahoo/callback`;
}

function getAuthUrl(req) {
  const { clientId } = getClientConfig();
  const redirectUri = getRedirectUri(req);
  if (!clientId || !redirectUri) return null;
  const state = require("crypto").randomBytes(24).toString("hex");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: YAHOO_SCOPE,
    state,
  });
  return { url: `${YAHOO_AUTH_URL}?${params.toString()}`, state };
}

async function exchangeCodeForTokens(code, redirectUri, state) {
  const { clientId, clientSecret } = getClientConfig();
  if (!clientId || !clientSecret) return null;

  const res = await fetch(YAHOO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yahoo token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in || 3600,
    expiry_date: data.expires_in ? Date.now() + (data.expires_in - 60) * 1000 : null,
  };
}

async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = getClientConfig();
  if (!clientId || !clientSecret || !refreshToken) return null;

  const res = await fetch(YAHOO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yahoo token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    expires_in: data.expires_in || 3600,
    expiry_date: data.expires_in ? Date.now() + (data.expires_in - 60) * 1000 : null,
  };
}

module.exports = {
  YAHOO_SCOPE,
  getClientConfig,
  getRedirectUri,
  getAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
};
