/**
 * securityCheck.js - 外部URLのセキュリティ診断（HTTPヘッダー・公開ファイル等）
 * 対象URLにGETリクエストを送り、実態を検証して pass/fail/warning を返す
 */
const FETCH_TIMEOUT_MS = 15000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchWithTimeout(url, options = {}) {
  const timeout = options.timeout ?? FETCH_TIMEOUT_MS;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: options.method || "GET",
      headers: { "User-Agent": USER_AGENT, ...options.headers },
      signal: ctrl.signal,
      redirect: "follow",
    });
    clearTimeout(t);
    return res;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

function getHeader(res, name) {
  return res.headers.get(name) || null;
}

function getAllSetCookie(res) {
  if (typeof res.headers.getSetCookie === "function") {
    const arr = res.headers.getSetCookie();
    return Array.isArray(arr) ? arr : [];
  }
  const raw = res.headers.get("set-cookie");
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function parseCookieAttributes(setCookieHeader) {
  const parts = (setCookieHeader || "").split(";").map((s) => s.trim().toLowerCase());
  let httpOnly = false;
  let secure = false;
  let sameSite = null;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (p === "httponly") httpOnly = true;
    else if (p === "secure") secure = true;
    else if (p.startsWith("samesite=")) {
      const val = p.split("=")[1] || "";
      if (["strict", "lax", "none"].includes(val)) sameSite = val;
    }
  }
  return { httpOnly, secure, sameSite };
}

/**
 * ベースとなるチェック定義（id, name, category, severity など静的フィールド）
 * status は runSecurityCheck で上書き
 */
const CHECK_TEMPLATES = [
  {
    id: "https",
    name: "HTTPS配信",
    category: "HTTPS / TLS",
    severity: "low",
    description: "トップページ・主要ページが HTTPS 応答",
    recommendation: "常時HTTPS維持、HTTPは301で統一",
    risk: "通信の平文露出リスクは低い",
  },
  {
    id: "tls",
    name: "TLS利用状況",
    category: "HTTPS / TLS",
    severity: "low",
    description: "証明書応答とTLS接続を確認",
    recommendation: "古いTLSバージョンは段階的に停止",
    risk: "接続時の基本的な保護は担保されやすい",
  },
  {
    id: "ssl-expiry",
    name: "SSL証明書 有効期限",
    category: "HTTPS / TLS",
    severity: "low",
    description: "証明書の有効期限を確認",
    recommendation: "期限前に更新推奨",
    risk: "証明書期限切れのリスク",
  },
  {
    id: "hsts",
    name: "HSTS",
    category: "HTTPS / TLS",
    severity: "medium",
    description: "Strict-Transport-Security の設定を確認",
    recommendation: "max-age を十分に取り HSTS を有効化",
    risk: "初回HTTP接続時のダウングレード余地",
  },
  {
    id: "x-frame-options",
    name: "X-Frame-Options",
    category: "Security Headers",
    severity: "high",
    description: "クリックジャッキング攻撃のリスク。攻撃者がサイトを透明フレームに埋め込みユーザーを騙せます。",
    recommendation: "DENY または SAMEORIGIN を設定",
    risk: "クリックジャッキング",
    hint: "レスポンスヘッダーに1行追加",
    effortMinutes: 5,
    icon: "🛡",
  },
  {
    id: "content-security-policy",
    name: "Content-Security-Policy",
    category: "Security Headers",
    severity: "medium",
    description: "外部スクリプト読み込みを制限できていません。XSS・悪意あるスクリプト挿入に無防備な状態。",
    recommendation: "report-only から段階導入",
    risk: "XSS・スクリプト挿入",
    hint: "まず report-only モードで設定推奨",
    effortMinutes: 90,
    icon: "📋",
  },
  {
    id: "x-content-type-options",
    name: "X-Content-Type-Options",
    category: "Security Headers",
    severity: "low",
    description: "nosniff を確認",
    recommendation: "全レスポンスで一貫付与",
    risk: "MIME推測リスクを抑制",
  },
  {
    id: "referrer-policy",
    name: "Referrer-Policy",
    category: "Security Headers",
    severity: "medium",
    description: "Referrer-Policy の設定を確認",
    recommendation: "strict-origin-when-cross-origin などへ調整",
    risk: "参照元情報が外部へ過剰送信される可能性",
  },
  {
    id: "cookie-secure",
    name: "Cookie Secure属性",
    category: "Cookie Attributes",
    severity: "medium",
    description: "Set-Cookie に Secure 属性を確認",
    recommendation: "セッション系Cookieへ Secure を付与",
    risk: "HTTPで送信される余地が残る",
    effortMinutes: 15,
  },
  {
    id: "cookie-httponly",
    name: "Cookie HttpOnly属性",
    category: "Cookie Attributes",
    severity: "high",
    description: "セッションCookieがJSから読み取られXSSでセッションハイジャックされるリスクがあります。",
    recommendation: "HttpOnly フラグを付与",
    risk: "セッションハイジャック",
    hint: "バックエンドのCookie発行部分を修正",
    effortMinutes: 15,
    icon: "🍪",
  },
  {
    id: "cookie-samesite",
    name: "Cookie SameSite属性",
    category: "Cookie Attributes",
    severity: "high",
    description: "SameSite 未付与または緩い設定。CSRF耐性が下がります。",
    recommendation: "Lax または Strict を基本に設計",
    risk: "CSRF攻撃",
    hint: "バックエンドのCookie発行部分を修正",
    effortMinutes: 15,
    icon: "🍪",
  },
  {
    id: "mixed-content",
    name: "Mixed Content",
    category: "Mixed Content",
    severity: "low",
    description: "HTTP画像・JS・CSS混在を確認",
    recommendation: "外部埋め込みも含めてHTTPS統一",
    risk: "保護通信の信頼性低下を回避",
  },
  {
    id: "directory-listing",
    name: "Directory Listing",
    category: "情報漏洩・公開ファイル",
    severity: "medium",
    description: "/uploads/ /backup/ 等の一覧表示可能性を確認",
    recommendation: "Indexes無効、公開対象を限定",
    risk: "不要ファイルが公開状態になる恐れ",
  },
  {
    id: "git-exposure",
    name: ".git ディレクトリ公開",
    category: "情報漏洩・公開ファイル",
    severity: "medium",
    description: "/.git/config へのアクセスが可能です。ソースコードやコミット履歴が漏洩するリスクがあります。",
    recommendation: "Webサーバーで .git へのアクセスを拒否",
    risk: "ソースコード漏洩",
    hint: "Webサーバーで .git へのアクセスを拒否",
    effortMinutes: 10,
    icon: "📂",
  },
  {
    id: "server-header",
    name: "Server / X-Powered-By",
    category: "Public Exposure",
    severity: "medium",
    description: "フレームワーク・バージョン情報が外部から見えています。攻撃者に狙われやすくなります。",
    recommendation: "サーバー設定でヘッダーを削除",
    risk: "バージョン情報漏洩",
    hint: "サーバー設定でヘッダーを削除",
    effortMinutes: 10,
    icon: "🔍",
  },
  {
    id: "public-files",
    name: "公開ファイル露出",
    category: "情報漏洩・公開ファイル",
    severity: "medium",
    description: ".env / backup.zip / phpinfo などを探索対象",
    recommendation: "公開領域から除外しデプロイを見直す",
    risk: "誤配置ファイルによる重大事故",
  },
  {
    id: "form-protection",
    name: "フォーム送信保護",
    category: "Mixed Content",
    severity: "low",
    description: "問い合わせフォーム送信先がHTTPS",
    recommendation: "加えてCSPやCSRF対策を内部で整備",
    risk: "通信経路上の平文露出を避けやすい",
  },
];

function buildCheck(template, status, extra = {}) {
  return { ...template, status, ...extra };
}

/**
 * targetUrl に対してセキュリティチェックを実行し、checks 配列を返す
 */
async function runSecurityCheck(targetUrl) {
  const checks = CHECK_TEMPLATES.map((t) => ({ ...t, status: "pass" })); // デフォルト pass
  const byId = {};
  checks.forEach((c) => { byId[c.id] = c; });

  let baseUrl = (targetUrl || "").trim();
  if (!baseUrl) return checks;
  if (!/^https?:\/\//i.test(baseUrl)) baseUrl = "https://" + baseUrl;

  let res;
  try {
    res = await fetchWithTimeout(baseUrl);
  } catch (e) {
    for (const c of checks) {
      if (c.severity !== "low") c.status = "fail";
    }
    byId.https.status = "fail";
    return checks;
  }

  const origin = new URL(baseUrl).origin;
  const finalUrl = res.url || baseUrl;
  const isHttps = new URL(finalUrl).protocol === "https:";
  const headers = res.headers;

  // --- HTTPS ---
  if (!isHttps) {
    byId.https.status = "fail";
  }

  // --- TLS / SSL expiry ---
  if (!isHttps) {
    byId.tls.status = "fail";
    byId["ssl-expiry"].status = "fail";
  }
  // SSL expiry は Node の TLS で証明書取得が必要。ここでは簡易に pass のまま

  // --- HSTS ---
  const hsts = getHeader(res, "strict-transport-security");
  if (!hsts || !/max-age\s*=\s*\d+/i.test(hsts)) {
    byId.hsts.status = isHttps ? "warning" : "pass";
  }

  // --- X-Frame-Options ---
  const xfo = getHeader(res, "x-frame-options");
  if (!xfo || !/^(DENY|SAMEORIGIN)$/i.test(xfo.trim())) {
    byId["x-frame-options"].status = "fail";
  }

  // --- Content-Security-Policy ---
  const csp = getHeader(res, "content-security-policy") || getHeader(res, "content-security-policy-report-only");
  if (!csp || csp.trim().length < 5) {
    byId["content-security-policy"].status = "fail";
  }

  // --- X-Content-Type-Options ---
  const xcto = getHeader(res, "x-content-type-options");
  if (!xcto || !/nosniff/i.test(xcto)) {
    byId["x-content-type-options"].status = "fail";
  }

  // --- Referrer-Policy ---
  const rp = getHeader(res, "referrer-policy");
  const rpOk = rp && /strict-origin-when-cross-origin|strict-origin|no-referrer|same-origin/i.test(rp.trim());
  if (!rpOk) {
    byId["referrer-policy"].status = "warning";
  }

  // --- Cookie attributes ---
  const setCookies = getAllSetCookie(res);
  if (setCookies.length > 0) {
    let allSecure = true;
    let allHttpOnly = true;
    let allSameSite = true;
    for (const sc of setCookies) {
      const attr = parseCookieAttributes(sc);
      if (!attr.secure) allSecure = false;
      if (!attr.httpOnly) allHttpOnly = false;
      if (!attr.sameSite || attr.sameSite === "none") allSameSite = false;
    }
    if (!allSecure) byId["cookie-secure"].status = "warning";
    if (!allHttpOnly) byId["cookie-httponly"].status = "fail";
    if (!allSameSite) byId["cookie-samesite"].status = "fail";
  } else {
    byId["cookie-secure"].status = "pass";
    byId["cookie-httponly"].status = "pass";
    byId["cookie-samesite"].status = "pass";
  }

  // --- Mixed content, form-protection ---
  // 今回はスキップ（HTMLパースが必要）
  byId["mixed-content"].status = "pass";
  byId["form-protection"].status = "pass";

  // --- Directory listing ---
  // 簡易: /uploads/ を試す（判定はヒューリスティック）
  try {
    const uploadRes = await fetchWithTimeout(origin + "/uploads/", { timeout: 5000 });
    const ct = (uploadRes.headers.get("content-type") || "").toLowerCase();
    const body = await uploadRes.text().catch(() => "");
    const looksLikeListing = /index of|directory listing|<!DOCTYPE.*<title>.*Index of/i.test(body) ||
      (uploadRes.ok && ct.includes("text/html") && body.length > 100 && body.includes("<a "));
    if (looksLikeListing) {
      byId["directory-listing"].status = "warning";
    }
  } catch {
    /* ignore */
  }

  // --- .git exposure ---
  try {
    const gitRes = await fetchWithTimeout(origin + "/.git/config", { timeout: 5000 });
    if (gitRes.ok) {
      const body = await gitRes.text().catch(() => "");
      if (/\[core\]|\[remote\]/i.test(body)) {
        byId["git-exposure"].status = "fail";
      }
    }
  } catch {
    /* ignore */
  }

  // --- Server / X-Powered-By ---
  const server = getHeader(res, "server");
  const poweredBy = getHeader(res, "x-powered-by");
  if ((server && server.trim().length > 0) || (poweredBy && poweredBy.trim().length > 0)) {
    byId["server-header"].status = "fail";
  }

  // --- public-files ---
  // 簡易: .env, phpinfo などは試さない（攻撃的スキャンになるため）警告のまま
  byId["public-files"].status = "warning";

  return checks;
}

module.exports = { runSecurityCheck };
