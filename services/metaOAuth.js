/**
 * Meta (Facebook) Marketing API OAuth ヘルパー
 * https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
 */

function getClientConfig() {
  return {
    appId: (process.env.META_APP_ID || "").trim(),
    appSecret: (process.env.META_APP_SECRET || "").trim(),
  };
}

function getRedirectUri(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
  return `${proto}://${host}/api/ads/meta/callback`;
}

/**
 * Meta OAuth 認可 URL を生成
 */
function getAuthUrl(req, state) {
  const { appId } = getClientConfig();
  const redirectUri = getRedirectUri(req);
  const scopes = "ads_read,ads_management,business_management";
  const url = new URL("https://www.facebook.com/v25.0/dialog/oauth");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  return url.toString();
}

/**
 * 認可コードをアクセストークンに交換
 */
async function exchangeCodeForTokens(code, redirectUri) {
  const { appId, appSecret } = getClientConfig();
  const url = new URL("https://graph.facebook.com/v25.0/oauth/access_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);

  const resp = await fetch(url.toString());
  const data = await resp.json().catch(() => ({}));
  if (data.error) {
    throw new Error(data.error.message || "Meta token exchange failed");
  }
  if (!data.access_token) {
    throw new Error("access_token が返されませんでした");
  }

  // 短期トークンを長期トークンに交換
  const longLived = await exchangeForLongLivedToken(data.access_token);
  return longLived;
}

/**
 * 短期トークンを長期トークン（約60日間有効）に交換
 */
async function exchangeForLongLivedToken(shortLivedToken) {
  const { appId, appSecret } = getClientConfig();
  const url = new URL("https://graph.facebook.com/v25.0/oauth/access_token");
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortLivedToken);

  const resp = await fetch(url.toString());
  const data = await resp.json().catch(() => ({}));
  if (data.error) {
    throw new Error(data.error.message || "Long-lived token exchange failed");
  }
  const expiresIn = data.expires_in || 5184000; // default 60 days
  return {
    access_token: data.access_token,
    expiry_date: Date.now() + (expiresIn - 60) * 1000,
  };
}

/**
 * ユーザー情報を取得（名前・メールアドレス）
 */
async function fetchUserInfo(accessToken) {
  const url = `https://graph.facebook.com/v25.0/me?fields=name,email&access_token=${encodeURIComponent(accessToken)}`;
  const resp = await fetch(url);
  const data = await resp.json().catch(() => ({}));
  if (data.error) return { name: "", email: "" };
  return { name: data.name || "", email: data.email || "" };
}

/**
 * 広告アカウント一覧を取得
 */
async function fetchAdAccounts(accessToken) {
  const accounts = [];
  let url = `https://graph.facebook.com/v25.0/me/adaccounts?fields=id,name,account_status&limit=100&access_token=${encodeURIComponent(accessToken)}`;
  while (url) {
    const resp = await fetch(url);
    const data = await resp.json().catch(() => ({}));
    if (data.error) throw new Error(data.error.message || "Failed to fetch ad accounts");
    (data.data || []).forEach((a) => accounts.push(a));
    url = data.paging?.next || null;
  }
  return accounts;
}

module.exports = {
  getClientConfig,
  getRedirectUri,
  getAuthUrl,
  exchangeCodeForTokens,
  exchangeForLongLivedToken,
  fetchUserInfo,
  fetchAdAccounts,
};
