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
    if (document.getElementById("ai-mode-badge-css")) return;
    const s = document.createElement("style");
    s.id = "ai-mode-badge-css";
    s.textContent = `
      .ai-mode-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 12px 4px 8px;
        border-radius: 999px;
        border: 1px solid rgb(196, 181, 253);
        background: transparent;
        margin-top: 6px;
        width: fit-content;
        white-space: nowrap;
      }
      .ai-mode-badge__icon {
        font-size: 12px;
        color: rgb(167, 139, 250);
        line-height: 1;
        display: inline-block;
        transform-origin: center center;
        animation: ai-mode-icon-rotate 6s ease-in-out infinite;
      }
      .ai-mode-badge__text {
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.07em;
        line-height: 1;
        background: linear-gradient(
          90deg,
          rgb(167, 139, 250) 0%,
          rgb(96, 165, 250) 40%,
          rgb(167, 139, 250) 80%,
          rgb(96, 165, 250) 100%
        );
        background-size: 200% auto;
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
        color: transparent;
        animation: ai-mode-shimmer 5s linear infinite;
      }
      @keyframes ai-mode-shimmer {
        0% { background-position: 0% 50%; }
        100% { background-position: 200% 50%; }
      }
      @keyframes ai-mode-icon-rotate {
        0% { transform: rotate(0deg) scale(1); opacity: 1; }
        25% { transform: rotate(90deg) scale(1.2); opacity: 0.8; }
        50% { transform: rotate(180deg) scale(1); opacity: 1; }
        75% { transform: rotate(270deg) scale(1.2); opacity: 0.8; }
        100% { transform: rotate(360deg) scale(1); opacity: 1; }
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
      <div class="px-3 sm:px-8 flex items-center bg-slate-50 border-t border-slate-100 overflow-x-auto ${isHideNavPage ? "hidden" : ""}" style="min-height:44px;-webkit-overflow-scrolling:touch">
        <div class="flex items-center gap-4 sm:gap-6 pt-3 sm:pt-4">
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
        <div class="flex items-center justify-between px-3 sm:px-8 border-b border-slate-100" style="min-height:56px">
           <div class="flex items-center gap-2 sm:gap-6 min-w-0">
    <div class="flex items-center gap-2 shrink-0">
    <a href="seo.html" class="flex items-center gap-2 hover:opacity-80 transition-opacity">
        <img src="/img/d_logo.png" alt="Logo" style="width:28px;height:28px;max-width:28px;max-height:28px" class="sm:!w-8 sm:!h-8" onerror="this.style.display='none'">
        <span class="text-sm sm:text-lg font-bold text-slate-900 whitespace-nowrap">
            SEO Scan <span class="text-slate-400 font-medium text-[10px] ml-1 uppercase tracking-wider hidden sm:inline">by DIGITALEYES</span>
        </span>
    </a>
    <div class="ai-mode-badge hidden sm:inline-flex" title="AIを活用した分析・提案モード" role="img" aria-label="＋AI mode">
        <span class="ai-mode-badge__icon" aria-hidden="true">✦</span>
        <span class="ai-mode-badge__text">＋AI mode</span>
    </div>
    </div>
    <div id="header-target-domain" class="text-xs font-bold text-slate-500 hidden sm:block truncate"></div>
    <div id="header-nav-left" class="hidden sm:block shrink-0"></div>
</div>
            <div class="flex items-center gap-2 sm:gap-4 shrink-0">
                <div id="header-user-nav" class="flex items-center gap-2 sm:gap-4"></div>
            </div>
        </div>
        <div class="px-3 sm:px-8 flex items-center bg-white overflow-x-auto ${isHideNavPage ? "hidden" : ""}" style="scrollbar-gutter:stable;-webkit-overflow-scrolling:touch">
            <div class="flex items-center gap-3 sm:gap-6 pt-3 sm:pt-4" style="padding-bottom:1px">
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

  // ── Pull-to-Refresh ──────────────────────
  function initPullToRefresh() {
    if (!("ontouchstart" in window)) return;
    let startY = 0;
    let pulling = false;
    let indicator = null;

    function getIndicator() {
      if (indicator) return indicator;
      indicator = document.createElement("div");
      indicator.id = "ptr-indicator";
      indicator.innerHTML = '<div class="ptr-spinner"></div><span>引っ張って更新</span>';
      document.body.prepend(indicator);
      const s = document.createElement("style");
      s.textContent = `
        #ptr-indicator{position:fixed;top:-60px;left:0;right:0;height:60px;display:flex;align-items:center;justify-content:center;gap:8px;
          background:#fff;border-bottom:1px solid #e2e8f0;z-index:9999;transition:transform .25s ease;font-size:13px;font-weight:600;color:#64748b}
        #ptr-indicator.visible{transform:translateY(60px)}
        #ptr-indicator.refreshing span{display:none}
        .ptr-spinner{width:20px;height:20px;border:2.5px solid #e2e8f0;border-top-color:#6366f1;border-radius:50%;animation:none}
        #ptr-indicator.refreshing .ptr-spinner{animation:ptr-spin .6s linear infinite}
        @keyframes ptr-spin{to{transform:rotate(360deg)}}
      `;
      document.head.appendChild(s);
      return indicator;
    }

    document.addEventListener("touchstart", (e) => {
      if (window.scrollY > 5) return;
      startY = e.touches[0].clientY;
      pulling = true;
    }, { passive: true });

    document.addEventListener("touchmove", (e) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 40 && window.scrollY <= 0) {
        const el = getIndicator();
        el.classList.add("visible");
        el.classList.remove("refreshing");
        el.querySelector("span").textContent = dy > 100 ? "離して更新" : "引っ張って更新";
      } else {
        if (indicator) indicator.classList.remove("visible");
      }
    }, { passive: true });

    document.addEventListener("touchend", () => {
      if (!pulling) return;
      pulling = false;
      if (indicator && indicator.classList.contains("visible")) {
        const el = getIndicator();
        const span = el.querySelector("span");
        if (span.textContent === "離して更新") {
          el.classList.add("refreshing");
          setTimeout(() => window.location.reload(), 400);
        } else {
          el.classList.remove("visible");
        }
      }
    }, { passive: true });
  }

  // ── モバイル用ボトムナビ ──────────────────────
  function initBottomNav() {
    if (window.innerWidth > 768) return;
    const path = window.location.pathname.split("/").pop() || "index.html";
    const isHideNavPage = path.includes("index.html") || path === "index";
    if (isHideNavPage) return;

    const urlSuffix = navQuerySuffix();
    const activeGroup = (() => {
      if (path.includes("gsc-task.html")) return "task";
      if (path.includes("result.html") || path.includes("link-structure.html") || path.includes("mobile.html") || path.includes("llmo.html")) return "seo";
      if (path.includes("gsc.html") || path.includes("gsc-indexhealth.html") || path.includes("gsc-technical.html") || path.includes("gsc-opportunities.html") || path.includes("gsc-monitoring.html")) return "gsc";
      if (path.includes("domain.html")) return "domain";
      if (path.includes("security.html")) return "security";
      if (path.includes("strategy.html")) return "strategy";
      if (path.includes("ads.html")) return "ads";
      if (path.includes("seo.html") || path.includes("settings.html")) return "home";
      return "";
    })();

    const tabs = [
      { id: "home", icon: "⌂", label: "ホーム", href: "seo.html" },
      { id: "task", icon: "✓", label: "TASK", href: "gsc-task.html" + urlSuffix },
      { id: "seo", icon: "◉", label: "SEO", href: "result.html" + urlSuffix },
      { id: "gsc", icon: "◎", label: "GSC", href: "gsc.html" + urlSuffix },
      { id: "ads", icon: "▣", label: "ADs", href: "ads.html" + urlSuffix },
      { id: "more", icon: "⋯", label: "その他", href: "#" },
    ];

    const nav = document.createElement("nav");
    nav.id = "bottom-nav";
    nav.innerHTML = tabs.map(t => {
      const active = t.id === activeGroup || (t.id === "home" && activeGroup === "home");
      return `<a href="${t.href}" class="bnav-item${active ? " bnav-active" : ""}" data-bnav="${t.id}">
        <span class="bnav-icon">${t.icon}</span><span class="bnav-label">${t.label}</span>
      </a>`;
    }).join("");
    document.body.appendChild(nav);

    // 「その他」メニュー
    const moreItems = [
      { label: "Domain Authority", href: "domain.html" + urlSuffix, id: "domain" },
      { label: "Security", href: "security.html" + urlSuffix, id: "security" },
      { label: "SEO Strategy", href: "strategy.html" + urlSuffix, id: "strategy" },
      { label: "設定", href: "settings.html", id: "settings" },
    ];
    const overlay = document.createElement("div");
    overlay.id = "bnav-more-overlay";
    overlay.innerHTML = `<div id="bnav-more-menu">${moreItems.map(m =>
      `<a href="${m.href}" class="bnav-more-item${activeGroup === m.id ? " bnav-more-active" : ""}">${m.label}</a>`
    ).join("")}</div>`;
    document.body.appendChild(overlay);

    nav.querySelector('[data-bnav="more"]').addEventListener("click", (e) => {
      e.preventDefault();
      overlay.classList.toggle("open");
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.remove("open");
    });

    // スタイル注入
    const s = document.createElement("style");
    s.textContent = `
      @media(min-width:769px){#bottom-nav,#bnav-more-overlay{display:none!important}}
      #bottom-nav{position:fixed;bottom:0;left:0;right:0;height:64px;background:#fff;border-top:1px solid #e2e8f0;
        display:flex;align-items:stretch;z-index:9998;padding-bottom:env(safe-area-inset-bottom,0)}
      .bnav-item{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
        text-decoration:none;color:#94a3b8;font-size:10px;font-weight:700;transition:color .15s}
      .bnav-item.bnav-active{color:#4f46e5}
      .bnav-icon{font-size:20px;line-height:1}
      .bnav-label{font-size:10px;letter-spacing:.02em}
      body{padding-bottom:64px!important}
      #bnav-more-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:none;align-items:flex-end;justify-content:center}
      #bnav-more-overlay.open{display:flex}
      #bnav-more-menu{width:100%;max-width:400px;background:#fff;border-radius:20px 20px 0 0;padding:24px 20px calc(24px + env(safe-area-inset-bottom,0));
        display:flex;flex-direction:column;gap:4px}
      .bnav-more-item{display:block;padding:14px 16px;border-radius:12px;font-size:15px;font-weight:600;color:#334155;text-decoration:none}
      .bnav-more-item:active{background:#f1f5f9}
      .bnav-more-active{color:#4f46e5;background:#eef2ff}
    `;
    document.head.appendChild(s);

    // ヘッダーのメインタブをモバイルで非表示（ボトムナビに移行）
    const headerTabs = document.querySelector("header .overflow-x-auto");
    if (headerTabs && !isHideNavPage) {
      headerTabs.style.cssText += ";display:none";
      // サブナビは残す
    }
  }

  function bootCommonHeader() {
    loadCommonHeader();
    setHeaderTargetDomain();
    initPullToRefresh();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initBottomNav);
    } else {
      initBottomNav();
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootCommonHeader);
  } else {
    bootCommonHeader();
  }
})();
