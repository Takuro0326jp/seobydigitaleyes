/**
 * 管理コンソール: API認証元管理ページ
 * 認証元（OAuth資格情報）をグローバルに管理する
 */

const adsBase = "/api/ads";

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { credentials: "include", ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export async function render(container) {
  container.innerHTML = `<div id="ads-settings-root"><p class="text-slate-400">読み込み中...</p></div>`;
  await renderPage();
}

/** OAuth 戻り: #/ads-settings?meta=… など（ルートは init.js で path のみ使用） */
function readAdsSettingsHashQuery() {
  const raw = (window.location.hash || "").replace(/^#/, "");
  const q = raw.indexOf("?");
  if (q < 0) return new URLSearchParams();
  return new URLSearchParams(raw.slice(q + 1));
}

function stripAdsSettingsHashQuery() {
  const raw = (window.location.hash || "").replace(/^#/, "");
  const q = raw.indexOf("?");
  if (q < 0) return;
  const path = raw.slice(0, q) || "ads-settings";
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/${path.replace(/^\//, "")}`);
}

async function renderPage() {
  const root = document.getElementById("ads-settings-root");
  if (!root) return;

  const hp = readAdsSettingsHashQuery();
  const oauthBanner = (() => {
    const metaOk = hp.get("meta") === "auth_linked";
    const metaErr = hp.get("meta_error");
    const gOk = hp.get("google_ads") === "auth_linked";
    const yOk = hp.get("yahoo_ads") === "auth_linked";
    const gErr = hp.get("google_ads_error");
    const yErr = hp.get("yahoo_ads_error");
    if (metaOk) {
      stripAdsSettingsHashQuery();
      return `<div class="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Meta の認証元を連携しました（認証元 ID: ${escHtml(hp.get("auth_source") || "—")}）。</div>`;
    }
    if (gOk) {
      stripAdsSettingsHashQuery();
      return `<div class="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Google Ads の認証元を連携しました（認証元 ID: ${escHtml(hp.get("auth_source") || "—")}）。</div>`;
    }
    if (yOk) {
      stripAdsSettingsHashQuery();
      return `<div class="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Yahoo 広告の認証元を連携しました（認証元 ID: ${escHtml(hp.get("auth_source") || "—")}）。</div>`;
    }
    const dec = (s) => {
      try {
        return decodeURIComponent(s);
      } catch (_) {
        return s;
      }
    };
    if (metaErr) {
      stripAdsSettingsHashQuery();
      return `<div class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Meta 連携エラー: ${escHtml(dec(metaErr))}</div>`;
    }
    if (gErr) {
      stripAdsSettingsHashQuery();
      return `<div class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Google Ads 連携エラー: ${escHtml(dec(gErr))}</div>`;
    }
    if (yErr) {
      stripAdsSettingsHashQuery();
      return `<div class="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Yahoo 連携エラー: ${escHtml(dec(yErr))}</div>`;
    }
    return "";
  })();

  let authSources = [];
  try {
    authSources = await fetchJson(`${adsBase}/admin/auth-sources`);
  } catch (e) {
    root.innerHTML = `<p class="text-red-600">認証元の取得に失敗しました: ${escHtml(e.message)}</p>`;
    return;
  }

  const googleSources = authSources.filter((s) => s.platform === "google");
  const yahooSources = authSources.filter((s) => s.platform === "yahoo");
  const metaSources = authSources.filter((s) => s.platform === "meta");

  root.innerHTML = `
    <div class="space-y-8">
      ${oauthBanner}
      <div>
        <h2 class="text-lg font-bold text-slate-800 mb-1">API認証元管理</h2>
        <p class="text-sm text-slate-500 mb-6">OAuth認証元をグローバルに管理します。ここで設定した認証元は全案件で共通利用されます。</p>
      </div>

      <!-- Google Ads 認証元 -->
      <div class="bg-white rounded-2xl border border-slate-200 p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold text-slate-800">Google Ads 認証元</h3>
          <button id="btn-add-google" class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition">
            + Google で連携
          </button>
        </div>
        ${googleSources.length === 0
          ? `<p class="text-sm text-slate-400">Google Ads の認証元はまだ登録されていません。</p>`
          : `<table class="w-full text-sm">
              <thead><tr class="text-left text-slate-500 border-b border-slate-100">
                <th class="py-2 font-medium">名前</th>
                <th class="py-2 font-medium">メールアドレス</th>
                <th class="py-2 font-medium">MCC ID</th>
                <th class="py-2 font-medium">登録日</th>
                <th class="py-2 font-medium"></th>
              </tr></thead>
              <tbody>
                ${googleSources.map((s) => `
                  <tr class="border-b border-slate-50 hover:bg-slate-50">
                    <td class="py-3 font-medium text-slate-800">${escHtml(s.name)}</td>
                    <td class="py-3 text-slate-600">${escHtml(s.google_email || "—")}</td>
                    <td class="py-3">
                      ${s.login_customer_id
                        ? `<span class="text-slate-700">${escHtml(s.login_customer_id)}</span>`
                        : `<span class="text-amber-600 text-xs">未設定</span>`}
                      <button class="ml-2 text-xs text-indigo-600 hover:underline" data-mcc-id="${s.id}" data-mcc-current="${escHtml(s.login_customer_id || "")}">編集</button>
                    </td>
                    <td class="py-3 text-slate-500">${s.created_at ? new Date(s.created_at).toLocaleDateString("ja") : "—"}</td>
                    <td class="py-3 text-right">
                      <button class="text-xs text-red-500 hover:text-red-700" data-delete-auth="${s.id}">削除</button>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>`
        }
      </div>

      <!-- Yahoo 広告 認証元 -->
      <div class="bg-white rounded-2xl border border-slate-200 p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold text-slate-800">Yahoo 広告 認証元</h3>
          <button id="btn-add-yahoo" class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition">
            + Yahoo で連携
          </button>
        </div>
        ${yahooSources.length === 0
          ? `<p class="text-sm text-slate-400">Yahoo 広告の認証元はまだ登録されていません。</p>`
          : `<table class="w-full text-sm">
              <thead><tr class="text-left text-slate-500 border-b border-slate-100">
                <th class="py-2 font-medium">名前</th>
                <th class="py-2 font-medium">登録日</th>
                <th class="py-2 font-medium"></th>
              </tr></thead>
              <tbody>
                ${yahooSources.map((s) => `
                  <tr class="border-b border-slate-50 hover:bg-slate-50">
                    <td class="py-3 font-medium text-slate-800">${escHtml(s.name)}</td>
                    <td class="py-3 text-slate-500">${s.created_at ? new Date(s.created_at).toLocaleDateString("ja") : "—"}</td>
                    <td class="py-3 text-right">
                      <button class="text-xs text-red-500 hover:text-red-700" data-delete-auth="${s.id}">削除</button>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>`
        }
      </div>

      <!-- Meta 広告 認証元 -->
      <div class="bg-white rounded-2xl border border-slate-200 p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold text-slate-800">Meta 広告 認証元（Facebook / Instagram）</h3>
          <button id="btn-add-meta" class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition">
            + Meta で連携
          </button>
        </div>
        ${metaSources.length === 0
          ? `<p class="text-sm text-slate-400">Meta 広告の認証元はまだ登録されていません。</p>
             <p class="text-xs text-slate-400 mt-2">※ .env の META_APP_ID / META_APP_SECRET の設定が必要です。<br>Meta for Developers でアプリを作成し Marketing API を有効化してください。</p>`
          : `<table class="w-full text-sm">
              <thead><tr class="text-left text-slate-500 border-b border-slate-100">
                <th class="py-2 font-medium">名前</th>
                <th class="py-2 font-medium">アカウント</th>
                <th class="py-2 font-medium">有効期限</th>
                <th class="py-2 font-medium">登録日</th>
                <th class="py-2 font-medium"></th>
              </tr></thead>
              <tbody>
                ${metaSources.map((s) => {
                  const email = s.google_email || "—";
                  const expiry = s.expiry_date ? new Date(Number(s.expiry_date)).toLocaleDateString("ja") : "—";
                  const isExpired = s.expiry_date && Number(s.expiry_date) < Date.now();
                  return `
                  <tr class="border-b border-slate-50 hover:bg-slate-50">
                    <td class="py-3 font-medium text-slate-800">${escHtml(s.name)}</td>
                    <td class="py-3 text-slate-600">${escHtml(email)}</td>
                    <td class="py-3 ${isExpired ? "text-red-600" : "text-slate-500"}">
                      ${escHtml(expiry)}${isExpired ? ` <span class="text-xs text-red-500 font-medium">期限切れ</span>` : ""}
                    </td>
                    <td class="py-3 text-slate-500">${s.created_at ? new Date(s.created_at).toLocaleDateString("ja") : "—"}</td>
                    <td class="py-3 text-right">
                      <button class="text-xs text-indigo-600 hover:underline mr-3" data-meta-accounts="${s.id}">広告アカウント確認</button>
                      <button class="text-xs text-red-500 hover:text-red-700" data-delete-auth="${s.id}">削除</button>
                    </td>
                  </tr>
                `}).join("")}
              </tbody>
            </table>`
        }
      </div>
    </div>
  `;

  // イベント: Google 連携追加
  document.getElementById("btn-add-google")?.addEventListener("click", () => {
    const name = prompt("認証元の名前を入力してください（例: クライアントA MCC）");
    if (!name?.trim()) return;
    window.location.href = `${adsBase}/google/connect?mode=global&name=${encodeURIComponent(name.trim())}`;
  });

  // イベント: Yahoo 連携追加
  document.getElementById("btn-add-yahoo")?.addEventListener("click", () => {
    const name = prompt("認証元の名前を入力してください（例: クライアントA Yahoo）");
    if (!name?.trim()) return;
    window.location.href = `${adsBase}/yahoo/connect?mode=global&name=${encodeURIComponent(name.trim())}`;
  });

  // イベント: Meta 連携追加
  document.getElementById("btn-add-meta")?.addEventListener("click", () => {
    const name = prompt("認証元の名前を入力してください（例: クライアントA Meta）");
    if (!name?.trim()) return;
    window.location.href = `${adsBase}/meta/connect?mode=global&name=${encodeURIComponent(name.trim())}`;
  });

  // イベント: Meta 広告アカウント確認
  root.querySelectorAll("[data-meta-accounts]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.metaAccounts;
      btn.textContent = "取得中...";
      btn.disabled = true;
      try {
        const data = await fetchJson(`${adsBase}/meta/auth-sources/${id}/adaccounts`);
        const accounts = data.accounts || [];
        if (accounts.length === 0) {
          alert("この認証元に紐づく広告アカウントはありません。");
        } else {
          const list = accounts.map((a) => `${a.name || "名前なし"} (${a.id})`).join("\n");
          alert(`広告アカウント一覧（${accounts.length}件）:\n\n${list}`);
        }
      } catch (e) {
        alert("広告アカウントの取得に失敗しました: " + e.message);
      } finally {
        btn.textContent = "広告アカウント確認";
        btn.disabled = false;
      }
    });
  });

  // イベント: MCC ID 編集
  root.querySelectorAll("[data-mcc-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.mccId;
      const current = btn.dataset.mccCurrent || "";
      const newMcc = prompt("MCC ID（Login Customer ID）を入力してください", current);
      if (newMcc === null || newMcc.trim() === current) return;
      try {
        await fetchJson(`${adsBase}/admin/auth-sources/${id}/mcc`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ login_customer_id: newMcc.trim() }),
        });
        await renderPage();
      } catch (e) {
        alert("MCC IDの更新に失敗しました: " + e.message);
      }
    });
  });

  // イベント: 認証元削除
  root.querySelectorAll("[data-delete-auth]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.deleteAuth;
      if (!confirm("この認証元を削除しますか？関連するアカウントも使用できなくなります。")) return;
      try {
        await fetchJson(`${adsBase}/admin/auth-sources/${id}`, { method: "DELETE" });
        await renderPage();
      } catch (e) {
        alert("削除に失敗しました: " + e.message);
      }
    });
  });
}
