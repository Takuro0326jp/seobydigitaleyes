/**
 * スキャン一覧ページのエントリ
 * 処理の流れ: 認証 → 一覧取得 → 描画
 */
import { fetchMe, fetchScansList, logout } from "./api.js";
import { requireLogin } from "./auth.js";
import {
  renderUserBar,
  renderScanTable,
  renderError,
  renderLoading
} from "./render.js";

const rootId = "seo-list-root";
const userBarId = "seo-user-email";

async function init() {
  const root = document.getElementById(rootId);
  const userBar = document.getElementById(userBarId);

  const me = await requireLogin(fetchMe);
  if (!me) return;

  renderUserBar(userBar, me);
  renderLoading(root);

  document.getElementById("seo-logout-btn")?.addEventListener("click", async () => {
    await logout();
    window.location.replace("/");
  });

  try {
    const list = await fetchScansList();
    renderScanTable(root, Array.isArray(list) ? list : []);
  } catch (e) {
    if (e.status === 401) {
      window.location.replace("/");
      return;
    }
    renderError(root, e.message || "一覧の取得に失敗しました");
  }
}

document.addEventListener("DOMContentLoaded", init);
