/**
 * seo.js - 検証サイト一覧の管理ロジック
 * 一覧形式、検索、ソート、削除、バックグラウンド解析機能を統合
 */

let allSites = []; // サーバーから取得した全データを保持

/**
 * サーバーからデータを取得して初期化
 */
async function loadSavedSites() {
    const tableBody = document.getElementById('siteListTable');
    
    // 1. 先にログイン情報（メール）を取得
    const email = localStorage.getItem('userEmail');

    // 2. ログインしていない場合は即座にリダイレクト
    if (!email) {
        window.location.replace('index.html');
        return;
    }

    try {
        // 3. APIリクエストは1回だけ！
        const response = await fetch(`/api/history?email=${encodeURIComponent(email)}`);
        
        if (!response.ok) {
            // エラーの内容をサーバーから受け取る
            const errData = await response.json().catch(() => ({ error: '不明なサーバーエラー' }));
            throw new Error(errData.error || 'サーバーエラーが発生しました');
        }

        const allHistory = await response.json();

        // 4. データ処理（既存の処理）
        const uniqueSitesMap = new Map();
        allHistory.forEach(site => {
            let domain = "";
            try { domain = new URL(site.url).hostname; } catch(e) { domain = site.url; }
            if (!uniqueSitesMap.has(domain)) {
                uniqueSitesMap.set(domain, { ...site, domain: domain, status: site.status || 'completed', searchString: (domain + site.url).toLowerCase() });
            }
        });

        allSites = Array.from(uniqueSitesMap.values());

    // ★ここで件数を表示（権限に応じた allSites の中身がそのまま反映されます）
    const countElement = document.getElementById('project-count');
    if (countElement) {
        countElement.textContent = `現在 ${allSites.length} 件のサイトを管理中`;
        countElement.classList.remove('text-slate-500'); // 色を少し強調するなら変更
        countElement.classList.add('text-indigo-600', 'font-bold'); 
    }
        filterAndRenderSites();
        
    } catch (err) {
        console.error("履歴のロード失敗:", err);
        // エラー時は画面にユーザーフレンドリーなメッセージを表示
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-red-500 font-bold">履歴の読み込みに失敗しました：${err.message}</td></tr>`;
        }
    }
}

/**
 * フィルタリングと並び替えを適用してテーブルを描画
 */
window.filterAndRenderSites = function() {
    const tableBody = document.getElementById('siteListTable');
    const emptyState = document.getElementById('emptyState');
    const queryEl = document.getElementById('siteSearchInput');
    const sortEl = document.getElementById('sortOrder');

    if (!tableBody || !queryEl || !sortEl) return;

    const query = queryEl.value.toLowerCase();
    const sortType = sortEl.value;

    const savedMapping = JSON.parse(localStorage.getItem('gsc_mappings') || '{}');

    let filtered = allSites.filter(site => site.searchString.includes(query));

    filtered.sort((a, b) => {
        if (sortType === 'updated' || sortType === 'newest') return new Date(b.timestamp) - new Date(a.timestamp);
        if (sortType === 'score') return b.average_score - a.average_score;
        if (sortType === 'name') return a.domain.localeCompare(b.domain);
        return 0;
    });

    if (filtered.length === 0) {
        tableBody.innerHTML = "";
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    tableBody.innerHTML = filtered.map((site, index) => {
        const isProcessing = site.status === 'processing';
        const scoreClass = site.average_score >= 80 ? 'text-emerald-500' : 'text-orange-500';

        // 解析中の表示
        const scoreDisplay = isProcessing 
            ? `<div class="flex flex-col items-center gap-1">
                 <div class="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                 <span class="text-[9px] font-black text-indigo-500 uppercase tracking-tighter">Scanning</span>
               </div>`
            : `<span class="text-sm font-black ${scoreClass}">${site.average_score}</span>`;

        const isGscLinked = !!savedMapping[site.url]; 
        const gscStatusHtml = isGscLinked 
            ? `<div class="flex items-center justify-center gap-1.5 text-emerald-500 bg-emerald-50 py-1 px-2 rounded-full border border-emerald-100 mx-auto w-fit">
                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>
                <span class="text-[9px] font-black uppercase tracking-widest">Linked</span>
               </div>`
            : `<div class="flex items-center justify-center gap-1.5 text-slate-300 bg-slate-50 py-1 px-2 rounded-full border border-slate-100 mx-auto w-fit">
                <div class="w-1.5 h-1.5 bg-slate-200 rounded-full"></div>
                <span class="text-[9px] font-black uppercase tracking-widest">Not Set</span>
               </div>`;

return `
            <tr class="hover:bg-slate-50/80 transition-all group border-b border-slate-50 ${isProcessing ? 'opacity-70' : ''}">
                <td data-label="No." class="px-8 py-6 text-[11px] font-mono text-slate-300 font-bold">${index + 1}</td>
                <td data-label="Target Site / URL" class="px-8 py-6">
                    <div class="flex items-center gap-4 ${isProcessing ? 'cursor-not-allowed' : 'cursor-pointer'}" 
                         onclick="${isProcessing ? '' : `viewReportByUrl('${site.url}')`}">
                        <img src="https://www.google.com/s2/favicons?domain=${site.domain}&sz=64" class="w-6 h-6 rounded shadow-sm border border-slate-100">
                        <div>
                            <span class="block text-[13px] font-black text-slate-900 ${isProcessing ? '' : 'group-hover:text-blue-600'} transition-colors">${site.domain}</span>
                            <span class="block text-[10px] text-slate-400 font-mono mt-0.5 truncate max-w-[200px]">${site.url}</span>
                        </div>
                    </div>
                </td>
                <td data-label="GSC" class="px-8 py-6 text-center">${gscStatusHtml}</td>
                <td data-label="First Scan" class="px-8 py-6 text-center text-[11px] font-bold text-slate-400">${new Date(site.timestamp).toLocaleDateString()}</td>
                <td data-label="Last Update" class="px-8 py-6 text-center text-[11px] font-bold text-slate-600">${new Date(site.timestamp).toLocaleDateString()}</td>
                <td data-label="Score" class="px-8 py-6 text-center">${scoreDisplay}</td>
                <td data-label="Actions" class="px-8 py-6 text-right space-x-2">
                    <button onclick="openSiteSettings(event, '${site.url}')" 
                        title="GSC接続設定"
                        class="inline-flex items-center justify-center p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all border border-transparent hover:border-indigo-100">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                        </svg>
                    </button>
                    
                    <button onclick="deleteSite(event, '${site.url}')" 
                        class="inline-flex items-center justify-center p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all border border-transparent hover:border-red-100">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
};

/**
 * レポート表示 (URLベース)
 */
window.viewReportByUrl = function(url) {
    const site = allSites.find(s => s.url === url);
    if (!site || site.status === 'processing') return;

    const data = typeof site.raw_data === 'string' ? JSON.parse(site.raw_data) : site.raw_data;
    localStorage.setItem('lastCrawlResult', JSON.stringify(data));
    window.location.href = `result.html?url=${encodeURIComponent(site.url)}`;
};

/**
 * 削除処理
 */
async function deleteSite(event, url) {
    event.stopPropagation();
    const userEmail = localStorage.getItem('userEmail');
    if (!confirm(`このサイトの診断履歴をすべて削除しますか？\n対象: ${url}`)) return;

    try {
        const response = await fetch('/api/history', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userEmail, url: url })
        });
        if (!response.ok) throw new Error('削除に失敗しました');
        allSites = allSites.filter(s => s.url !== url);
        filterAndRenderSites();
    } catch (err) {
        alert(err.message);
    }
}

/**
 * モーダル操作
 */
window.openNewScanModal = function() {
    document.getElementById('newScanModal').classList.remove('hidden');
    document.getElementById('targetUrlInput').focus();
};

window.closeNewScanModal = function() {
    const modal = document.getElementById('newScanModal');
    if (modal) {
        // 解析中かどうかのチェックを外して強制的に閉じる
        modal.classList.add('hidden');
    }
};

/**
 * GSC設定
 */
let currentConfiguringUrl = "";

/**
 * GSC設定：モーダルを開く際、現在のステータスに応じて見た目を切り替える
 */
window.openSiteSettings = function(event, url) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    currentConfiguringUrl = url;
    
    let domain = "";
    try { domain = new URL(url).hostname; } catch(e) { domain = url; }
    document.getElementById('targetDomainLabel').textContent = domain;

    // UIを初期化（読み込み中は一旦デフォルトに戻す）
    const statusArea = document.getElementById('connectionStatusArea');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    
    // 読み込み中UI（必要であればグレーアウトなどしても良いです）
    statusText.textContent = "Loading status...";

    const email = localStorage.getItem('userEmail'); 
    fetch(`/api/gsc/get-mapping?email=${encodeURIComponent(email)}&target_url=${encodeURIComponent(url)}`)
        .then(res => res.json())
        .then(data => {
            document.getElementById('gscPropertyUrlInput').value = data.gsc_property_url || url;
            
            // ★ここが連携状況によるUI切り替えロジックです
            if (data.gsc_property_url) {
                // 連携済みの場合
                statusArea.className = "p-5 bg-emerald-50/50 rounded-2xl border border-emerald-100 flex items-center gap-4";
                statusDot.className = "w-2.5 h-2.5 bg-emerald-500 rounded-full"; // アニメーション解除
                statusText.className = "text-[10px] font-black text-emerald-700 uppercase tracking-widest";
                statusText.textContent = "Connection: Linked";
            } else {
                // 未設定の場合
                statusArea.className = "p-5 bg-indigo-50/50 rounded-2xl border border-indigo-100 flex items-center gap-4";
                statusDot.className = "w-2.5 h-2.5 bg-indigo-500 rounded-full animate-pulse";
                statusText.className = "text-[10px] font-black text-indigo-700 uppercase tracking-widest";
                statusText.textContent = "Connection: Ready to Sync";
            }
        })
        .catch(err => {
            console.error("GSC設定の読み込みに失敗:", err);
            document.getElementById('gscPropertyUrlInput').value = url;
        });
    
    document.getElementById('siteSettingsModal').classList.remove('hidden');
};

// 保存時の処理（変更なし）
async function saveGscMapping(url, gscUrl) {
    const email = localStorage.getItem('userEmail');
    await fetch('/api/gsc/save-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, target_url: url, gsc_property_url: gscUrl })
    });
}

// モーダルを閉じる処理（変更なし）
window.closeSiteSettings = function() {
    document.getElementById('siteSettingsModal').classList.add('hidden');
};

/**
 * GSC設定を保存し、トースト通知を表示する
 */
window.saveSiteSpecificSettings = async function() { // ★ async を忘れずに！
    let inputVal = document.getElementById('gscPropertyUrlInput').value.trim();
    if (!inputVal) return alert("URLを入力してください");

    let finalPropertyUrl = inputVal;
    // ドメインプロパティ形式の自動補完
    if (!inputVal.startsWith('sc-domain:') && !inputVal.startsWith('http')) {
        if (inputVal.includes('.') && !inputVal.includes('/')) {
            finalPropertyUrl = `sc-domain:${inputVal}`;
        }
    }

    // 1. DBに保存する（これが重要！）
    await saveGscMapping(currentConfiguringUrl, finalPropertyUrl);

    // 2. (任意) localStorageもバックアップとして残したいなら以下をそのままに。
    // 不要なら消してOKです。
    const savedMapping = JSON.parse(localStorage.getItem('gsc_mappings') || '{}');
    savedMapping[currentConfiguringUrl] = finalPropertyUrl;
    localStorage.setItem('gsc_mappings', JSON.stringify(savedMapping));
    
    // 3. UIの更新
    closeSiteSettings();
    filterAndRenderSites(); 
    
    showToast(`GSC接続設定を保存しました: ${finalPropertyUrl}`);
};

/**
 * 画面上部にトースト通知を表示する
 */
function showToast(message) {
    // 既存のトーストがあれば削除
    const oldToast = document.getElementById('toast-notification');
    if (oldToast) oldToast.remove();

    const toast = document.createElement('div');
    toast.id = 'toast-notification';
    // Tailwindでスタイルを設定（上部中央に表示）
    toast.className = `
        fixed top-10 left-1/2 -translate-x-1/2 z-[200]
        bg-slate-900 text-white text-[11px] font-black uppercase tracking-[0.2em]
        px-8 py-4 rounded-2xl shadow-2xl border border-slate-700
        flex items-center gap-3 animate-bounce-in
    `;
    toast.innerHTML = `
        <div class="w-2 h-2 bg-emerald-400 rounded-full shadow-[0_0_10px_#34d399]"></div>
        ${message}
    `;

    document.body.appendChild(toast);

    // 3秒後に消す
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.5s ease';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

/**
 * 初期化とポーリング
 */
// DOMが読み込まれたら実行
document.addEventListener('DOMContentLoaded', () => {
    loadSavedSites(); // 画面読み込み時に履歴を表示

    const scanForm = document.getElementById('scan-form');
    if (scanForm) {
        scanForm.onsubmit = async (e) => {
            e.preventDefault();

            const urlInput = document.getElementById('targetUrlInput');
            const submitBtn = document.getElementById('submit-btn');
            const submitBtnText = document.getElementById('submit-btn-text');
            
            const url = urlInput ? urlInput.value.trim() : "";
            const email = localStorage.getItem('userEmail'); 
            
            if (!email) return alert("ログイン情報が見つかりません。再ログインしてください。");
            if (!url) return alert('URLを入力してください');

            // 1. UIのロック（送信中にする）
            submitBtn.disabled = true;
            if (submitBtnText) submitBtnText.innerText = "送信中...";

            try {
                // 2. クロール開始のリクエスト（これだけでOK！）
                const response = await fetch('/api/crawl', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, email }) // emailを渡してサーバー側で検証
                });

                if (!response.ok) {
                    const errData = await response.json();
                    throw new Error(errData.error || 'サーバーエラー');
                }

                // 3. 成功時のUI更新
                closeNewScanModal();
                urlInput.value = ""; 
                alert(`${url} の解析を開始しました。\n完了まで一覧画面でお待ちください。`);

                // 4. 一覧を最新化
                await loadSavedSites(); 
                const scrollContainer = document.querySelector('.overflow-x-auto');
                if (scrollContainer) scrollContainer.scrollTop = 0;

            } catch (err) {
                console.error("解析依頼エラー:", err);
                alert(`エラーが発生しました: ${err.message}`);
            } finally {
                // 成功しても失敗してもボタンを戻す
                submitBtn.disabled = false;
                if (submitBtnText) submitBtnText.innerText = "解析を実行する →";
            }
        };
    }

    // 自動更新用（そのままでOK）
    setInterval(() => {
        if (typeof allSites !== 'undefined' && allSites.some(s => s.status === 'processing')) {
            loadSavedSites();
        }
    }, 30000);
}); 
