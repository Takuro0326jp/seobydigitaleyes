/**
 * 管理コンソール 初期化・ルーティング
 */
import { checkAdminAuth } from "./auth.js";
import { render as renderDashboard } from "./pages/dashboard.js";
import { render as renderUsers } from "./pages/users.js";
import { render as renderCompanies } from "./pages/companies.js";
import { render as renderScans } from "./pages/scans.js";
import { render as renderLinkAnalysis } from "./pages/link-analysis.js";

const routes = {
  "/": renderDashboard,
  "/users": renderUsers,
  "/companies": renderCompanies,
  "/scans": renderScans,
  "/link-analysis": renderLinkAnalysis,
};

function getRoute() {
  const hash = window.location.hash.slice(1) || "/";
  return hash;
}

function setNavActive(route) {
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.remove("nav-active");
    if (el.dataset.route === route) el.classList.add("nav-active");
  });
}

async function navigate(route) {
  const normalized = route === "" ? "/" : route;
  const render = routes[normalized];
  const container = document.getElementById("admin-content");

  if (!render || !container) {
    container.innerHTML = "<p class='text-slate-500'>ページが見つかりません</p>";
    return;
  }

  setNavActive(normalized);
  container.innerHTML = "<p class='text-slate-500'>読み込み中...</p>";

  try {
    await render(container);
  } catch (err) {
    if (err.message?.includes("403")) {
      container.innerHTML = `
        <div class="bg-red-50 border border-red-200 rounded-xl p-6">
          <p class="text-red-700 font-medium">管理者権限が必要です</p>
          <a href="/" class="inline-block mt-4 text-indigo-600 hover:underline">ログイン画面へ</a>
        </div>
      `;
    } else {
      container.innerHTML = `<p class="text-red-600">エラー: ${err.message}</p>`;
    }
  }
}

async function init() {
  const user = await checkAdminAuth();
  if (!user) {
    window.location.href = "/";
    return;
  }

  window.addEventListener("hashchange", () => navigate(getRoute()));
  navigate(getRoute());
}

init();
