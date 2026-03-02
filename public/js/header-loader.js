/**
 * header-loader.js
 * 1. 認証ガード
 * 2. 共通ヘッダー描画（名前・アイコン反映版）
 * 3. ユーザーメニュー・ログイン/ログアウト制御
 */

(function() {
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const path = window.location.pathname;
    const fileName = path.split('/').pop().toLowerCase().replace('.html', '') || "index";

    const protectedPages = ["result", "settings", "seo", "llmo", "gsc", "domain", "security", "strategy", "mobile", "admin"];
    
    if (protectedPages.includes(fileName) && !isLoggedIn) {
        window.location.replace('index.html');
        return; 
    }
})();

function loadCommonHeader() {
    const container = document.getElementById('header-container');
    if (!container) return;

    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const path = window.location.pathname.split("/").pop() || "index.html";
    
    const urlParams = new URLSearchParams(window.location.search);
    const currentSiteUrl = urlParams.get('url');
    const urlSuffix = currentSiteUrl ? `?url=${encodeURIComponent(currentSiteUrl)}` : '';

    const isHideNavPage = path.includes('index.html') || path.includes('seo.html') || path === 'index';

    const isActive = (target) => {
        const isSeoActive = (target === 'seo' && path.includes('result.html'));
        const isOtherActive = (target !== 'seo' && path.includes(target));
        return (isSeoActive || isOtherActive) ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600';
    };

    container.innerHTML = `
    <header class="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div class="h-16 flex items-center justify-between px-8 border-b border-slate-100">
            <div class="flex items-center gap-6"> 
                <a href="${isLoggedIn ? 'seo.html' : 'index.html'}" class="flex items-center gap-3 hover:opacity-80 transition-opacity">
                    <img src="img/d_logo.png" alt="Logo" class="w-8 h-8">
                    <span class="text-lg font-bold text-slate-900">
                        SEO Scan <span class="text-slate-400 font-medium text-[10px] ml-1 uppercase tracking-wider">by DIGITALEYES</span>
                    </span>
                </a>
                <div id="header-nav-left"></div>
            </div>
            
            <div class="flex items-center gap-4">
                <div id="header-user-nav" class="flex items-center gap-4"></div>
            </div>
        </div>

        <div class="px-8 flex items-center bg-white overflow-x-auto scrollbar-hide ${isHideNavPage ? 'hidden' : ''}">
            <div class="flex items-center gap-8 whitespace-nowrap pt-4">
                <a href="result.html${urlSuffix}" class="tab-btn pb-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${isActive('seo')}">
                    SEO & Structure
                </a>
                <a href="mobile.html${urlSuffix}" class="tab-btn pb-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${isActive('mobile')}">
                    Mobile Friendly
                </a>
                <a href="llmo.html${urlSuffix}" class="tab-btn pb-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${isActive('llmo')}">
                    LLMO Analysis
                </a>
                <a href="gsc.html${urlSuffix}" class="tab-btn pb-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${isActive('gsc')}">
                    Search Console
                </a>
                <a href="domain.html${urlSuffix}" class="tab-btn pb-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${isActive('domain')}">
                    Domain Authority
                </a>
                <a href="security.html${urlSuffix}" class="tab-btn pb-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${isActive('security')}">
                    Security
                </a>
                <a href="strategy.html${urlSuffix}" class="tab-btn pb-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${isActive('strategy')}">
                    SEO Strategy
                </a>
            </div>
        </div>
    </header>
    `;

    const leftNav = document.getElementById('header-nav-left');
    const showButtonPages = ['result.html', 'settings.html', 'mobile.html', 'llmo.html', 'gsc.html', 'domain.html', 'security.html', 'strategy.html'];
    if (leftNav && showButtonPages.some(p => path.includes(p))) {
        leftNav.innerHTML = `<a href="seo.html" class="bg-slate-900 text-white text-[10px] font-bold py-2 px-4 rounded-lg hover:bg-blue-600 transition shadow-sm active:scale-95">診断一覧へ</a>`;
    }

    renderUserNav();
}

function renderUserNav() {
    const userNav = document.getElementById('header-user-nav');
    if (!userNav) return;
    
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const userName = localStorage.getItem('userName') || 'Guest User';
    const userAvatar = localStorage.getItem('userAvatar');
    const userRole = (localStorage.getItem('userRole') || 'user').toLowerCase();

    if (isLoggedIn) {
        // --- 1. 管理者メニューの制御 ---
        const adminMenu = (userRole === 'master' || userRole === 'admin') 
            ? `<a href="admin.html" class="block px-4 py-3 text-[11px] font-bold text-blue-600 hover:bg-blue-50 transition-colors border-b border-slate-50">ユーザー管理</a>`
            : '';

        // --- 2. 名前横のロール表示バッジの制御 ---
        const roleLabel = (userRole === 'master' || userRole === 'admin')
            ? userRole.toUpperCase()
            : '一般権限';

        const avatarContent = userAvatar 
            ? `<img src="${userAvatar}" class="w-full h-full object-cover">` 
            : `<span class="text-white text-xs font-bold">${userName.charAt(0).toUpperCase()}</span>`;

        userNav.innerHTML = `
            <div class="text-right hidden sm:block border-r border-slate-100 pr-4 mr-1">
                <p class="text-[11px] font-bold text-slate-900">${userName} さん</p>
                <p class="text-[9px] text-slate-400 font-medium">${roleLabel}</p>
            </div>
            <div class="relative group">
                <button id="user-icon-btn" class="w-10 h-10 bg-slate-900 rounded-full flex items-center justify-center border border-slate-200 hover:bg-blue-600 transition-all focus:outline-none overflow-hidden">
                    ${avatarContent}
                </button>
                <div id="logout-menu" class="hidden absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden">
                    <div class="px-4 py-3 border-b border-slate-50 bg-slate-50/50">
                        <p class="text-[9px] text-slate-400 font-black uppercase tracking-[0.2em] mb-0.5">Account Status</p>
                        <p class="text-[11px] font-bold text-slate-700 truncate">${roleLabel} ログイン中</p>
                    </div>
                    ${adminMenu} 
                    <a href="settings.html" class="block px-4 py-3 text-[11px] font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors border-b border-slate-50">アカウント設定</a>
                    <a href="seo.html" class="block px-4 py-3 text-[11px] font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors">検証サイト一覧</a>
                    <button id="header-logout-btn" class="w-full text-left px-4 py-3 text-[11px] font-bold text-red-500 hover:bg-red-50 border-t border-slate-50 transition-colors">ログアウト</button>
                </div>
            </div>`;
            
        const iconBtn = document.getElementById('user-icon-btn');
        const menu = document.getElementById('logout-menu');
        if (iconBtn && menu) {
            iconBtn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); };
            document.onclick = () => menu.classList.add('hidden');
        }
        
        const logoutBtn = document.getElementById('header-logout-btn');
        if (logoutBtn) {
            logoutBtn.onclick = () => {
                if(confirm('ログアウトしますか？')) { 
                    localStorage.clear(); 
                    window.location.replace('index.html'); 
                }
            };
        }
    } else {
        // --- 3. 未ログイン時の処理（重複を整理し、機能を100%保持） ---
        const isIndexPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname === '';
        
        if (isIndexPage) {
            userNav.innerHTML = `<div class="py-2.5 px-6 opacity-0 pointer-events-none">ログイン</div>`;
        } else {
            userNav.innerHTML = `
                <a href="index.html?mode=login" id="header-login-link" class="bg-blue-600 text-white text-[10px] font-bold py-2.5 px-6 rounded-lg hover:bg-blue-700 transition shadow-sm active:scale-95">
                    ログイン
                </a>
            `;
        }
    }
}

document.addEventListener('DOMContentLoaded', loadCommonHeader);