/**
 * header.js — 共通ヘッダー（プロジェクト一覧・各ページで読み込み）
 * 1. 共通ヘッダー描画
 * 2. ユーザーメニュー・ログアウト
 */
(function () {
  "use strict";

  if (window.__seoHeaderInitialized) return;
  window.__seoHeaderInitialized = true;

  if (
    window.location.pathname.includes("result.html") ||
    window.location.pathname.includes("link-structure.html") ||
    window.location.pathname.includes("mobile.html") ||
    window.location.pathname.includes("llmo.html") ||
    window.location.pathname.includes("domain.html") ||
    window.location.pathname.includes("security.html") ||
    window.location.pathname.includes("gsc.html") ||
    window.location.pathname.includes("gsc-indexhealth.html") ||
    window.location.pathname.includes("gsc-technical.html") ||
    window.location.pathname.includes("gsc-opportunities.html") ||
    window.location.pathname.includes("gsc-monitoring.html")
  ) {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("scan")) {
      window.location.replace("seo.html");
    }
  }

  async function renderUserNav() {
    const userNav = document.getElementById("header-user-nav");
    if (!userNav) return;

    let userName = "User";
    let userRole = "user";
    let userAvatar = null;

    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const user = await res.json();
        if (user && user.email) {
          userName = user.email;
          userRole = (user.role || "user").toLowerCase();
        }
      }
    } catch (err) {
      console.warn("user fetch failed");
    }

    const roleLabel =
      userRole === "master" || userRole === "admin"
        ? "マスター権限"
        : "一般権限";

    const avatarContent = userAvatar
      ? `<img src="${userAvatar}" class="w-full h-full object-cover">`
      : `<span class="text-white text-xs font-bold">${userName.charAt(0).toUpperCase()}</span>`;

    userNav.innerHTML = `
        <div class="text-right hidden sm:block border-r border-slate-100 pr-4 mr-1">
            <p class="text-[11px] font-bold text-slate-900">${userName} さん</p>
            <p class="text-[9px] text-slate-400 font-medium">${roleLabel}</p>
        </div>
        <div class="relative group">
            <button id="user-icon-btn"
                class="w-10 h-10 bg-slate-900 rounded-full flex items-center justify-center border border-slate-200 hover:bg-blue-600 transition-all focus:outline-none overflow-hidden">
                ${avatarContent}
            </button>
            <div id="logout-menu"
                class="hidden absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden">
                <div class="px-4 py-3 border-b border-slate-50 bg-slate-50/50">
                    <p class="text-[9px] text-slate-400 font-black uppercase tracking-[0.2em] mb-0.5">Account Status</p>
                    <p class="text-[11px] font-bold text-slate-700 truncate">${roleLabel} ログイン中</p>
                </div>
                ${
                  userRole === "admin" || userRole === "master"
                    ? `<a href="admin.html"
class="block px-4 py-3 text-[11px] font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors border-b border-slate-50">
管理コンソール
</a>`
                    : ""
                }
                <a href="settings.html"
                    class="block px-4 py-3 text-[11px] font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors border-b border-slate-50">
                    アカウント設定
                </a>
                <a href="seo.html"
                    class="block px-4 py-3 text-[11px] font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors">
                    検証サイト一覧
                </a>
                <button id="header-logout-btn"
                    class="w-full text-left px-4 py-3 text-[11px] font-bold text-red-500 hover:bg-red-50 border-t border-slate-50 transition-colors">
                    ログアウト
                </button>
            </div>
        </div>
    `;

    const iconBtn = document.getElementById("user-icon-btn");
    const menu = document.getElementById("logout-menu");

    if (iconBtn && menu) {
      iconBtn.onclick = (e) => {
        e.stopPropagation();
        menu.classList.toggle("hidden");
      };
      document.onclick = () => menu.classList.add("hidden");
    }

    window.addEventListener("seo:profile-updated", (e) => {
      const name = e.detail?.name || "";
      const nav = document.getElementById("header-user-nav");
      if (nav) {
        const nameEl = nav.querySelector(".text-slate-900");
        if (nameEl) nameEl.textContent = name ? `${name} さん` : nameEl.textContent;
      }
    });

    const logoutBtn = document.getElementById("header-logout-btn");
    if (logoutBtn) {
      logoutBtn.onclick = () => {
        if (confirm("ログアウトしますか？")) {
          fetch("/api/auth/logout", {
            method: "POST",
            credentials: "include",
          }).finally(() => {
            localStorage.clear();
            window.location.replace("index.html");
          });
        }
      };
    }
  }

  function loadCommonHeader() {
    const container = document.getElementById("header-container");
    if (!container) return;

    const path = window.location.pathname.split("/").pop() || "index.html";
    const urlSuffix = window.location.search || "";

    const isHideNavPage =
      path.includes("index.html") ||
      path.includes("seo.html") ||
      path.includes("settings.html") ||
      path === "index";

    const isActive = (target) => {
      const isSeoActive = target === "seo" && path.includes("result.html");
      const isGscActive = target === "gsc" && (path.includes("gsc.html") || path.includes("gsc-indexhealth.html") || path.includes("gsc-technical.html") || path.includes("gsc-monitoring.html"));
      const isAdsActive = target === "ads" && path.includes("ads.html");
      const isLinkStructureActive = target === "link-structure" && path.includes("link-structure.html");
      const isOtherActive = target !== "seo" && target !== "gsc" && target !== "ads" && (path.includes(target) || (target === "link-structure" && path.includes("link-structure.html")));
      return isSeoActive || isGscActive || isAdsActive || isLinkStructureActive || isOtherActive
        ? "border-blue-600 text-blue-600"
        : "border-transparent text-slate-400 hover:text-slate-600";
    };

    container.innerHTML = `
    <header class="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div class="h-16 flex items-center justify-between px-8 border-b border-slate-100">
           <div class="flex items-center gap-6">
    <a href="seo.html" class="flex items-center gap-3 hover:opacity-80 transition-opacity">
        <img src="/img/d_logo.png" alt="Logo" class="w-8 h-8" onerror="this.style.display='none'">
        <span class="text-lg font-bold text-slate-900">
            SEO Scan <span class="text-slate-400 font-medium text-[10px] ml-1 uppercase tracking-wider">by DIGITALEYES</span>
        </span>
    </a>
    <div id="header-target-domain" class="text-xs font-bold text-slate-500"></div>
    <div id="header-nav-left"></div>
</div>
            <div class="flex items-center gap-4">
                <div id="header-user-nav" class="flex items-center gap-4"></div>
            </div>
        </div>
        <div class="px-8 flex items-center bg-white overflow-x-auto scrollbar-hide ${isHideNavPage ? "hidden" : ""}">
            <div class="flex items-center gap-8 whitespace-nowrap pt-4">
                <a href="result.html${urlSuffix}" class="tab-btn pb-4 text-sm font-bold border-b-2 transition-colors ${isActive("seo")}">SEO & Structure</a>
                <a href="link-structure.html${urlSuffix}" class="tab-btn pb-4 text-sm font-bold border-b-2 transition-colors ${isActive("link-structure")}">Link Structure</a>
                <a href="mobile.html${urlSuffix}" class="tab-btn pb-4 text-sm font-bold border-b-2 transition-colors ${isActive("mobile")}">Mobile Friendly</a>
                <a href="llmo.html${urlSuffix}" class="tab-btn pb-4 text-sm font-bold border-b-2 transition-colors ${isActive("llmo")}">LLMO Analysis</a>
                <a href="gsc.html${urlSuffix}" class="tab-btn pb-4 text-sm font-bold border-b-2 transition-colors ${isActive("gsc")}">Search Console</a>
                <a href="domain.html${urlSuffix}" class="tab-btn pb-4 text-sm font-bold border-b-2 transition-colors ${isActive("domain")}">Domain Authority</a>
                <a href="security.html${urlSuffix}" class="tab-btn pb-4 text-sm font-bold border-b-2 transition-colors ${isActive("security")}">Security</a>
                <a href="strategy.html${urlSuffix}" class="tab-btn pb-4 text-sm font-bold border-b-2 transition-colors ${isActive("strategy")}">SEO Strategy</a>
                <a href="ads.html${urlSuffix}" class="tab-btn pb-4 text-sm font-bold border-b-2 transition-colors ${isActive("ads")}">ADs</a>
            </div>
        </div>
    </header>
    `;

    const leftNav = document.getElementById("header-nav-left");
    const showButtonPages = [
      "result.html",
      "link-structure.html",
      "settings.html",
      "mobile.html",
      "llmo.html",
      "gsc.html",
      "gsc-indexhealth.html",
      "gsc-technical.html",
      "gsc-opportunities.html",
      "domain.html",
      "security.html",
      "strategy.html",
      "ads.html",
    ];

    if (leftNav && showButtonPages.some((p) => path.includes(p))) {
      leftNav.innerHTML = `
            <a href="seo.html"
               class="bg-slate-900 text-white text-[10px] font-bold py-2 px-4 rounded-lg hover:bg-blue-600 transition shadow-sm active:scale-95">
                診断一覧へ
            </a>`;
    }

    if (path !== "index.html") {
      void renderUserNav();
    }
  }

  let headerDomainLoaded = false;

  function setHeaderTargetDomain() {
    if (headerDomainLoaded) return;
    headerDomainLoaded = true;

    const el = document.getElementById("header-target-domain");
    if (!el) return;

    const params = new URLSearchParams(window.location.search);
    const scanId = params.get("scan");
    if (!scanId) return;

    fetch(`/api/scans/${scanId}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!data.scan?.target_url) return;
        const domain = new URL(data.scan.target_url).hostname;
        el.innerHTML = `
        <span class="text-slate-400">Target</span>
        <span class="ml-1 text-slate-800">${domain}</span>
        `;
      })
      .catch(() => {});
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadCommonHeader();
    setHeaderTargetDomain();
  });
})();
