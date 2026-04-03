/**
 * header.js — 共通ヘッダー（プロジェクト一覧・各ページで読み込み）
 * 1. 共通ヘッダー描画
 * 2. ユーザーメニュー・ログアウト
 */
(function () {
  "use strict";

  if (window.__seoHeaderInitialized) return;
  window.__seoHeaderInitialized = true;

  /** 上部タブ遷移時に scan が消えないよう、最後に開いたスキャン ID を保持 */
  const LAST_SCAN_STORAGE_KEY = "seoscan:lastScanId";

  function persistScanIdFromCurrentUrl() {
    try {
      const p = new URLSearchParams(window.location.search);
      const s = (p.get("scan") || p.get("scanId") || "").trim();
      if (s) sessionStorage.setItem(LAST_SCAN_STORAGE_KEY, s);
    } catch (_e) {
      /* ignore */
    }
  }

  function navQuerySuffix() {
    const raw = window.location.search || "";
    if (/\bscan=/.test(raw) || /\bscanId=/.test(raw)) return raw;
    try {
      const last = (sessionStorage.getItem(LAST_SCAN_STORAGE_KEY) || "").trim();
      if (!last) return raw;
      if (!raw) return `?scan=${encodeURIComponent(last)}`;
      const q = raw.startsWith("?") ? raw.slice(1) : raw;
      const p = new URLSearchParams(q);
      if (p.has("scan") || p.has("scanId")) return raw;
      p.set("scan", last);
      return "?" + p.toString();
    } catch (_e) {
      return raw;
    }
  }

  if (
    window.location.pathname.includes("result.html") ||
    window.location.pathname.includes("link-structure.html") ||
    window.location.pathname.includes("mobile.html") ||
    window.location.pathname.includes("llmo.html") ||
    window.location.pathname.includes("domain.html") ||
    window.location.pathname.includes("security.html") ||
    window.location.pathname.includes("gsc.html") ||
    window.location.pathname.includes("gsc-task.html") ||
    window.location.pathname.includes("gsc-indexhealth.html") ||
    window.location.pathname.includes("gsc-technical.html") ||
    window.location.pathname.includes("gsc-opportunities.html") ||
    window.location.pathname.includes("gsc-monitoring.html")
  ) {
    const params = new URLSearchParams(window.location.search);
    const scanParam = params.get("scan") || params.get("scanId");
    if (!scanParam) {
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

  function injectAiBadgeStyles() {
    if (document.getElementById("header-ai-badge-css")) return;
    const s = document.createElement("style");
    s.id = "header-ai-badge-css";
    s.textContent = `
      @keyframes header-ai-rainbow-glow {
        0%, 100% { box-shadow: 0 0 10px 1px rgba(99,102,241,0.18), 0 0 22px 3px rgba(99,102,241,0.07); }
        14% { box-shadow: 0 0 10px 1px rgba(139,92,246,0.2), 0 0 22px 3px rgba(139,92,246,0.08); }
        28% { box-shadow: 0 0 10px 1px rgba(168,85,247,0.18), 0 0 22px 3px rgba(168,85,247,0.07); }
        42% { box-shadow: 0 0 10px 1px rgba(236,72,153,0.16), 0 0 22px 3px rgba(236,72,153,0.06); }
        57% { box-shadow: 0 0 10px 1px rgba(251,146,60,0.17), 0 0 22px 3px rgba(251,146,60,0.07); }
        71% { box-shadow: 0 0 10px 1px rgba(250,204,21,0.16), 0 0 22px 3px rgba(250,204,21,0.06); }
        85% { box-shadow: 0 0 10px 1px rgba(45,212,191,0.17), 0 0 22px 3px rgba(45,212,191,0.07); }
      }
      @keyframes header-ai-diamond-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes header-ai-gradient-shift {
        0%, 100% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
      }
      .header-ai-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        padding: 0.2rem 0.6rem 0.2rem 0.45rem;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.92);
        border: 1px solid rgba(196, 181, 253, 0.45);
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #64748b;
        white-space: nowrap;
        animation: header-ai-rainbow-glow 14s ease-in-out infinite;
        box-shadow: 0 0 10px 1px rgba(99,102,241,0.15), 0 0 20px 2px rgba(99,102,241,0.06);
      }
      .header-ai-badge .header-ai-diamond {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 0.65rem;
        height: 0.65rem;
        font-size: 7px;
        line-height: 1;
        color: #a78bfa;
        animation: header-ai-diamond-spin 12s linear infinite;
        transform-origin: center center;
      }
      .header-ai-badge .header-ai-mode-label {
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.08em;
        background: linear-gradient(
          105deg,
          #64748b 0%,
          #6366f1 14%,
          #8b5cf6 28%,
          #a855f7 42%,
          #db2777 56%,
          #ea580c 70%,
          #0d9488 84%,
          #64748b 100%
        );
        background-size: 220% auto;
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        -webkit-text-fill-color: transparent;
        animation: header-ai-gradient-shift 12s ease-in-out infinite;
      }
    `;
    document.head.appendChild(s);
  }

  function loadCommonHeader() {
    const container = document.getElementById("header-container");
    if (!container) return;

    injectAiBadgeStyles();
    persistScanIdFromCurrentUrl();

    const path = window.location.pathname.split("/").pop() || "index.html";
    const urlSuffix = navQuerySuffix();

    const isHideNavPage =
      path.includes("index.html") ||
      path.includes("seo.html") ||
      path.includes("settings.html") ||
      path === "index";

    // Detect active main group
    const activeGroup = (() => {
      if (path.includes("gsc-task.html")) return "task";
      if (path.includes("result.html") || path.includes("link-structure.html") || path.includes("mobile.html") || path.includes("llmo.html")) return "seo";
      if (path.includes("gsc.html") || path.includes("gsc-indexhealth.html") || path.includes("gsc-technical.html") || path.includes("gsc-opportunities.html") || path.includes("gsc-monitoring.html")) return "gsc";
      if (path.includes("domain.html")) return "domain";
      if (path.includes("security.html")) return "security";
      if (path.includes("strategy.html")) return "strategy";
      if (path.includes("ads.html")) return "ads";
      return "";
    })();

    const mainTab = (group, label, href) => {
      const active = activeGroup === group;
      return `<a href="${href}${urlSuffix}" class="tab-btn pb-4 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${active ? "border-blue-600 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"}">${label}</a>`;
    };

    const subTab = (pageKey, label, href) => {
      const active = path.includes(pageKey);
      return `<a href="${href}${urlSuffix}" class="sub-tab-btn pb-4 text-xs font-black tracking-widest uppercase transition-colors whitespace-nowrap border-b-2 ${active ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600"}">${label}</a>`;
    };

    const subNavWrapper = (content) => `
      <div class="px-8 flex items-center bg-slate-50 border-t border-slate-100 overflow-x-auto ${isHideNavPage ? "hidden" : ""}" style="min-height:44px">
        <div class="flex items-center gap-6 pt-4">
          ${content}
        </div>
      </div>`;

    // Secondary nav: SEO subtabs
    const seoSubNav = activeGroup === "seo" ? subNavWrapper(`
          ${subTab("result.html",        "Structure",      "result.html")}
          ${subTab("link-structure.html","Link Structure",  "link-structure.html")}
          ${subTab("mobile.html",        "Mobile Friendly", "mobile.html")}
          ${subTab("llmo.html",          "LLMO Analysis",   "llmo.html")}
    `) : "";

    // Secondary nav: Search Console subtabs
    const gscSubNav = activeGroup === "gsc" ? subNavWrapper(`
          ${subTab("gsc.html",              "Performance",  "gsc.html")}
          ${subTab("gsc-indexhealth.html",  "Index Health", "gsc-indexhealth.html")}
          ${subTab("gsc-technical.html",    "Technical",    "gsc-technical.html")}
          ${subTab("gsc-opportunities.html","Opportunities","gsc-opportunities.html")}
    `) : "";

    container.innerHTML = `
    <header class="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div class="h-16 flex items-center justify-between px-8 border-b border-slate-100">
           <div class="flex items-center gap-6">
    <div class="flex items-center gap-2 sm:gap-3 shrink-0">
    <a href="seo.html" class="flex items-center gap-3 hover:opacity-80 transition-opacity">
        <img src="/img/d_logo.png" alt="Logo" class="w-8 h-8" onerror="this.style.display='none'">
        <span class="text-lg font-bold text-slate-900">
            SEO Scan <span class="text-slate-400 font-medium text-[10px] ml-1 uppercase tracking-wider">by DIGITALEYES</span>
        </span>
    </a>
    <span class="header-ai-badge" title="AIを活用した分析・提案モード" role="img" aria-label="+ AI mode">
        <span class="header-ai-diamond" aria-hidden="true">◆</span>
        <span class="header-ai-mode-label">+ AI mode</span>
    </span>
    </div>
    <div id="header-target-domain" class="text-xs font-bold text-slate-500"></div>
    <div id="header-nav-left"></div>
</div>
            <div class="flex items-center gap-4">
                <div id="header-user-nav" class="flex items-center gap-4"></div>
            </div>
        </div>
        <div class="px-8 flex items-center bg-white overflow-x-auto ${isHideNavPage ? "hidden" : ""}" style="scrollbar-gutter:stable">
            <div class="flex items-center gap-4 sm:gap-6 pt-4">
                ${mainTab("task",     "TASK",             "gsc-task.html")}
                ${mainTab("seo",      "SEO",                 "result.html")}
                ${mainTab("gsc",      "Search Console",      "gsc.html")}
                ${mainTab("domain",   "Domain Authority",    "domain.html")}
                ${mainTab("security", "Security",            "security.html")}
                ${mainTab("strategy", "SEO Strategy",        "strategy.html")}
                ${mainTab("ads",      "ADs",                 "ads.html")}
            </div>
        </div>
        ${seoSubNav}
        ${gscSubNav}
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
      "gsc-task.html",
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
    let scanId = params.get("scan") || params.get("scanId");
    if (!scanId) {
      try {
        scanId = sessionStorage.getItem(LAST_SCAN_STORAGE_KEY);
      } catch (_e) {
        scanId = null;
      }
    }
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
