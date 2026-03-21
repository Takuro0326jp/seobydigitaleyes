

// テーブル描画 + フィルター + モーダル専用

function escapeHtml(s) {
  if (s == null || s === undefined) return "";
  const str = String(s);
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// -----------------------------
// 🔎 検索フィルター
// -----------------------------
window.filterAndRenderTable = function () {

const keyword =
document.getElementById("searchInput")?.value.toLowerCase() || "";

const dirFilter =
document.getElementById("directoryFilter")?.value || "all";

const data = SEOState?.allCrawlData || [];

const filtered = data.filter(page => {

const url = (page.url || "").toLowerCase();
const title = (page.title || "").toLowerCase();

const keywordMatch =
!keyword ||
url.includes(keyword) ||
title.includes(keyword);

let dirMatch = true;

if (dirFilter !== "all") {

try {

const path = new URL(page.url).pathname;

if (dirFilter === "/") {

dirMatch = path === "/" || path === "/index.html";

} else {

dirMatch = path.startsWith(dirFilter);

}

} catch {

dirMatch = false;

}

}

return keywordMatch && dirMatch;

});

renderTable(filtered);

};

window.toggleDirMenu = function () {

const menu = document.getElementById("dirDropdownMenu");

if (!menu) return;

menu.classList.toggle("hidden");

};

// -----------------------------
// 📊 テーブル描画
// -----------------------------

let urlIndexMap = new Map();

function buildUrlIndexMap(){

urlIndexMap = new Map();

(SEOState?.allCrawlData || []).forEach((p,i)=>{
  urlIndexMap.set(p.url,i);
});

}

window.renderTable = function (data) {

    const allData = SEOState?.allCrawlData || [];
    if (urlIndexMap.size !== allData.length) {
      buildUrlIndexMap();
    }

    // APIの {scan, pages} 対応
    const pages = data?.pages || data || [];
    
    // カード更新
    updateSummaryCards(pages);
    updateStatsCards(pages);

    const tbody = document.getElementById('tableBody');
    if (!tbody) return;

    if (!pages.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="13" class="py-12 text-center text-slate-400">
                    データが存在しません
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = pages.map((p, index) => {

        const safeIndex = urlIndexMap.get(p.url) ?? index;

        const statusColor =
            p.status >= 400 ? 'text-red-500' :
            p.status >= 300 ? 'text-orange-500' :
            'text-emerald-500';

        const scoreColor =
            p.score >= 80 ? 'text-emerald-500' :
            p.score >= 50 ? 'text-orange-500' :
            'text-red-500';

        return `
            <tr class="hover:bg-slate-50 transition">

                <td class="py-3 px-2 text-center font-mono text-xs">
                    ${index + 1}
                </td>

                <td class="py-3 px-4 truncate">
                    <a href="${(typeof p.url === 'string' && (p.url.startsWith('http://') || p.url.startsWith('https://'))) ? p.url : '#'}" target="_blank" 
                       class="text-blue-600 hover:underline">
                        ${escapeHtml(p.url || "-")}
                    </a>
                </td>

                <td class="py-3 px-2 text-center">
                    ${p.depth || 0}
                </td>

                <td class="py-3 px-2 text-center ${statusColor}">
                    ${p.status || '-'}
                </td>

                <td class="py-3 px-2 text-center">
                    ${p.index_status || '-'}
                </td>

                <td class="py-3 px-4 truncate">
                    ${escapeHtml(p.title || "-")}
                </td>

                <td class="py-3 px-2 text-center">
                    ${p.title_char_count ?? (p.title || "").length}
                </td>

                <td class="py-3 px-2 text-center">
                    ${(p.word_count || 0)}
                </td>

                <td class="py-3 px-2 text-center">
                    ${(p.h1_count || 0)}
                </td>

                <td class="py-3 px-2 text-center">
                    ${(p.internal_links || 0)}
                </td>

                <td class="py-3 px-2 text-center font-bold ${scoreColor}">
                    ${p.score || 0}
                </td>

                <td class="py-3 px-4 text-center">
                    ${isCritical(p) ? 
                        '<span class="text-red-500 font-bold">High</span>' :
                        '<span class="text-slate-400">-</span>'
                    }
                </td>

                <td class="py-3 px-2 text-center">
                    <button class="detail-btn group inline-flex items-center justify-center w-8 h-8 
                    rounded-lg border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 
                    transition-all"
                    data-index="${safeIndex}">

                        <svg class="w-4 h-4 text-slate-400 
                                    group-hover:text-indigo-600 transition-colors"
                             fill="none"
                             stroke="currentColor"
                             viewBox="0 0 24 24">

                            <path stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M15 12a3 3 0 11-6 0 
                                     3 3 0 016 0z" />

                            <path stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M2.458 12C3.732 7.943 
                                     7.523 5 12 5
                                     c4.478 0 8.268 2.943 9.542 7
                                     -1.274 4.057-5.064 7
                                     -9.542 7
                                     -4.477 0-8.268-2.943-9.542-7z" />

                        </svg>

                    </button>
                </td>

            </tr>
        `;

    }).join('');
};

// -----------------------------
// 🧠 優先度判定
// -----------------------------
function generateAdvice(page) {

    const score = page.score || 0;

    if (score < 60) {
        return {
            text: "HIGH",
            color: "text-red-500 bg-red-50 border-red-200"
        };
    } else if (score < 85) {
        return {
            text: "MID",
            color: "text-orange-500 bg-orange-50 border-orange-200"
        };
    }

    return {
        text: "LOW",
        color: "text-emerald-500 bg-emerald-50 border-emerald-200"
    };
}

// -----------------------------
// 🧠 モーダル表示
// -----------------------------

window.openModal = function (index) {

    const data = SEOState?.allCrawlData?.[index];
    if (!data) return;

    const advice = typeof generateAdvice === "function"
        ? generateAdvice(data)
        : { text: "評価計算中", color: "text-slate-500" };

    document.getElementById('modalBody').innerHTML = `
        <div class="space-y-6 text-left">

            <div>
                <h2 class="text-base font-black text-slate-900 break-all leading-snug">
                    ${escapeHtml(data.url || "-")}
                </h2>
                <p class="text-[11px] text-slate-400 mt-1">
                    ページ詳細分析
                </p>
            </div>

            <div class="bg-slate-50 rounded-xl p-6 border border-slate-100">
                <div class="flex justify-between items-center">

                    <div>
                        <p class="text-4xl font-black text-slate-900">
                            ${Number(data.score) ?? 0}
                            <span class="text-sm text-slate-300 ml-1">/100</span>
                        </p>
                        <p class="text-[11px] font-bold mt-1 ${advice.color || "text-slate-500"}">
                            ${escapeHtml(advice.text || "")}
                        </p>
                    </div>

                    <div class="text-right text-[11px] text-slate-500 space-y-1">
                        <div>Status: <span class="font-bold">${escapeHtml(String(data.status ?? "-"))}</span></div>
                        <div>Index: <span class="font-bold">${escapeHtml(String(data.index_status ?? "-"))}</span></div>
                        <div>階層: <span class="font-bold">${escapeHtml(String(data.depth ?? "-"))}</span></div>
                    </div>

                </div>
            </div>

            <div class="grid grid-cols-3 gap-3 text-center">

                <div class="bg-slate-50 p-3 rounded-lg">
                    <p class="text-[10px] text-slate-400 font-bold uppercase">文字数</p>
                    <p class="text-base font-black">${data.word_count ?? 0}</p>
                </div>

                <div class="bg-slate-50 p-3 rounded-lg">
                    <p class="text-[10px] text-slate-400 font-bold uppercase">H1</p>
                    <p class="text-base font-black">${data.h1_count ?? 0}</p>
                </div>

                <div class="bg-slate-50 p-3 rounded-lg">
                    <p class="text-[10px] text-slate-400 font-bold uppercase">内部リンク</p>
                    <p class="text-base font-black">${data.internal_links ?? 0}</p>
                </div>

            </div>

            <div class="bg-white border border-slate-100 rounded-xl p-4 shadow-sm">
                <h3 class="text-xs font-black text-slate-800 mb-1">
                    SEOチェック
                </h3>
                <p class="text-[10px] text-slate-500 mb-3">スコアは 100 − 合計減点 で算出</p>
                <ul class="space-y-1.5 text-xs">
                    ${generateDetailChecks(data)}
                </ul>
            </div>

            <button class="close-modal-btn
            w-full bg-indigo-600 hover:bg-indigo-700
            text-white font-bold py-3 rounded-lg
            transition-colors text-sm">
            閉じる
            </button>

        </div>
    `;

    const overlay = document.getElementById('modalOverlay');
    const panel = document.getElementById('modalPanel');

    overlay.classList.remove('hidden');

    requestAnimationFrame(() => {
        overlay.classList.remove('opacity-0');
        overlay.classList.add('opacity-100');

        panel.classList.remove('scale-95', 'translate-y-4', 'opacity-0');
        panel.classList.add('scale-100', 'translate-y-0', 'opacity-100');
    });
};


window.closeModal = function () {

    const overlay = document.getElementById('modalOverlay');
    const panel = document.getElementById('modalPanel');

    panel.classList.remove('scale-100', 'translate-y-0', 'opacity-100');
    panel.classList.add('scale-95', 'translate-y-4', 'opacity-0');

    overlay.classList.remove('opacity-100');
    overlay.classList.add('opacity-0');

    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 300);
};


// 背景クリックで閉じる
const overlay = document.getElementById("modalOverlay");

if(overlay){
  overlay.addEventListener("click", function (e) {
    if (e.target === this) {
      closeModal();
    }
  });
}


// 旧互換
window.openDetailModal = function (index) {
    window.openModal(index);
};

// 各 issue コードに対応する表示用減点（スコア算出の参考値）
const ISSUE_POINT_MAP = {
  no_title: 10,
  no_h1: 10,
  short_title: 5,
  dup_title: 5,
  fetch_error: 15,
  http: 10,
  orphan: 5,
  noindex: 5,
  deep: 5,
};
const LABEL_POINT_MAP = {
  "タイトル未設定": 10,
  "H1未設定": 10,
  "H1複数": 5,
  "タイトルが短い": 5,
  "タイトルが長い": 3,
  "タイトル重複": 5,
  "meta description未設定": 5,
  "meta descriptionが短い": 3,
  "ページ取得エラー": 15,
  "HTTPエラー": 10,
  "孤立ページ": 5,
  "noindex": 30,
  "階層が深い": 5,
  "階層やや深い": 2,
  "タイトル文字数不足": 15,
  "キーワード不一致": 8,
  "キーワード部分一致": 3,
  "内部リンクなし": 10,
  "内部リンク少ない": 5,
  "内部リンクやや少ない": 2,
  "PageRank低": 10,
  "PageRank中": 5,
  "GSC順位圏外": 10,
  "GSC順位低い": 5,
  "CTRゼロ": 10,
  "CTR低い": 5,
  "構造スコア不足": 10,
  "パフォーマンススコア不足": 10,
  "OnPage未達": 10,
};

function generateDetailChecks(p) {
  const b = p.score_breakdown || {};
  const onPage = Number(b.on_page);
  const structure = Number(b.structure);
  const performance = Number(b.performance);
  const penalty = Number(b.penalty);
  const hasOldBreakdown =
    Number.isFinite(onPage) &&
    Number.isFinite(structure) &&
    Number.isFinite(performance);
  const hasDeductions = Array.isArray(p.deductions) && p.deductions.length > 0;
  const hasBreakdown = hasOldBreakdown || hasDeductions;

  const deductions = Array.isArray(p.deductions) ? p.deductions : [];
  const score = Number(p.score);
  const scoreNum = Number.isNaN(score) ? 0 : Math.max(0, Math.min(100, score));
  const getDeductionPt = (d) => {
    const val = Number(d.value ?? d.point ?? 0);
    if (val !== 0) return Math.abs(Math.round(val));
    return ISSUE_POINT_MAP[d.code] ?? LABEL_POINT_MAP[d.label] ?? 0;
  };
  const deductionTotal = deductions.reduce((sum, d) => sum + getDeductionPt(d), 0);

  let html = "";

  if (hasBreakdown) {
    const total = hasOldBreakdown
      ? Math.min(100, Math.round(
          Math.max(0, Math.min(40, onPage)) +
          Math.max(0, Math.min(30, structure)) +
          Math.max(0, Math.min(30, performance)) -
          Math.max(0, penalty)
        ))
      : scoreNum;

    if (hasOldBreakdown) {
      const onPageSafe = Math.max(0, Math.min(40, onPage));
      const structSafe = Math.max(0, Math.min(30, structure));
      const perfSafe = Math.max(0, Math.min(30, performance));
      const penaltySafe = Math.max(0, penalty);
      html += `
            <li class="flex justify-between items-center">
                <span class="text-slate-700 font-bold">OnPage</span>
                <span>${onPageSafe.toFixed(1)}pt/40pt</span>
            </li>
            <li class="flex justify-between items-center">
                <span class="text-slate-700 font-bold">Structure</span>
                <span>${structSafe.toFixed(1)}pt/30pt</span>
            </li>
            <li class="flex justify-between items-center">
                <span class="text-slate-700 font-bold">Performance</span>
                <span>${perfSafe.toFixed(1)}pt/30pt</span>
            </li>
            ${penaltySafe > 0 ? `
            <li class="flex justify-between items-center">
                <span class="text-slate-700 font-bold">ペナルティ</span>
                <span class="text-red-600 font-black">${penaltySafe}pt減点</span>
            </li>
            ` : ""}
        `;
    }
    html += `<li class="border-t pt-2 mt-2 flex justify-between items-center font-black">
                <span>合計</span>
                <span class="text-slate-900">${total}pt/100pt</span>
            </li>`;

    const validDeductions = deductions.filter((d) => getDeductionPt(d) > 0);
    if (validDeductions.length > 0) {
      html += `<li class="border-t pt-2 mt-2 text-slate-600 font-bold">減点一覧</li>`;
      validDeductions.forEach((d) => {
        const label = d.label || "不明";
        const pt = getDeductionPt(d);
        const reason = d.reason ? ` <span class="text-slate-400 font-normal">(${escapeHtml(d.reason)})</span>` : "";
        html += `<li class="flex justify-between items-center"><span class="text-slate-700 font-bold">${escapeHtml(label)}${reason}</span><span class="text-red-600 font-bold">${pt}pt減点</span></li>`;
      });
      html += `<li class="flex justify-between items-center font-black border-t pt-1 mt-1"><span>合計減点</span><span class="text-red-600">${deductionTotal}pt減点</span></li>`;
    } else {
      html += `<li class="flex justify-between items-center">
                <span class="text-slate-600 font-bold">未獲得（合計マイナス）</span>
                <span class="text-red-600 font-bold">${100 - total}pt</span>
            </li>`;
    }
  } else {
    const unearned = 100 - scoreNum;
    html += `
            <li class="flex justify-between items-center font-black">
                <span>合計</span>
                <span class="text-slate-900">${scoreNum}pt/100pt</span>
            </li>
        `;

    const validDeductionsElse = deductions.filter((d) => getDeductionPt(d) > 0);
    if (validDeductionsElse.length > 0) {
      html += `<li class="border-t pt-2 mt-2 text-slate-600 font-bold">減点一覧</li>`;
      validDeductionsElse.forEach((d) => {
        const label = d.label || "不明";
        const pt = getDeductionPt(d);
        const reason = d.reason ? ` <span class="text-slate-400 font-normal">(${escapeHtml(d.reason)})</span>` : "";
        html += `<li class="flex justify-between items-center"><span class="text-slate-700 font-bold">${escapeHtml(label)}${reason}</span><span class="text-red-600 font-bold">${pt}pt減点</span></li>`;
      });
      html += `<li class="flex justify-between items-center font-black border-t pt-1 mt-1"><span>合計減点</span><span class="text-red-600">${deductionTotal}pt減点</span></li>`;
    } else {
      html += `<li class="flex justify-between items-center">
                <span class="text-slate-600 font-bold">未獲得（合計マイナス）</span>
                <span class="text-red-600 font-bold">${unearned}pt</span>
            </li>
            <li class="text-slate-500 text-[10px] mt-1">内訳は再スキャンで表示されます</li>`;
    }
  }

  return html;
}

// ----------------------------------------
// 📊 ディレクトリセグメント
// ----------------------------------------


function buildDirectoryFilter(){

const container = document.getElementById("dirOptionsList");
if(!container) return;

container.innerHTML = "";

const all = document.createElement("div");

all.className =
"dir-option px-3 py-2 text-xs hover:bg-slate-100 cursor-pointer font-bold";

all.textContent = "すべてのディレクトリ";

all.addEventListener("click", () => {
  selectDirectory("all","すべてのディレクトリ");
});

container.appendChild(all);

const dirs = new Set();

(SEOState?.allCrawlData || []).forEach(page => {

try{

const url = new URL(page.url);
const path = url.pathname || "";

const firstDir = "/" + path.split("/")[1];

if(firstDir && firstDir !== "/"){
dirs.add(firstDir);
}

}catch(e){
console.warn("URL parse error:",page.url);
}

});

const sorted = Array.from(dirs).sort();

sorted.forEach(dir => {

const el = document.createElement("div");

el.className =
"dir-option px-3 py-2 text-xs hover:bg-slate-100 cursor-pointer";

el.textContent = dir;

el.addEventListener("click", () => {
  selectDirectory(dir,dir);
});

container.appendChild(el);

});

}


// ----------------------------------------
// 📊 カード用関数
// ----------------------------------------

function updateStatsCards(pages){

  if(!pages || pages.length === 0) return;

  // 総ページ数
  document.getElementById("stat-pages").innerText = pages.length;

  // Indexable
  const indexable =
    pages.filter(p => p.index_status === "index").length;

  document.getElementById("stat-indexable").innerText = indexable;

  // Noindex
  const noindex =
    pages.filter(p => p.index_status === "noindex").length;

  document.getElementById("stat-noindex").innerText = noindex;

  // Duplicate title
  const duplicateTitle =
    pages.filter(p =>
      (p.deductions || []).some(d => d.label === "タイトル重複")
    ).length;

  document.getElementById("stat-duplicate-title").innerText = duplicateTitle;

  // Orphan
  const orphan =
    pages.filter(p =>
      (p.deductions || []).some(d => d.label.includes("孤立"))
    ).length;

  document.getElementById("stat-orphan").innerText = orphan;

}

window.filterDirList = function () {

const keyword =
document.getElementById("dirSearchInput")?.value.toLowerCase() || "";

const options =
document.querySelectorAll("#dirOptionsList .dir-option");

options.forEach(option => {

const text = option.textContent.toLowerCase();

if(text.includes(keyword)){
option.style.display = "block";
}else{
option.style.display = "none";
}

});

};

window.selectDirectory = function(value,label){

// hidden input更新
const input = document.getElementById("directoryFilter");
if(input) input.value = value;

// 表示テキスト更新
const display = document.querySelector("#toggleDirMenuBtn .truncate");
if (display) display.textContent = label;

// メニュー閉じる
const menu = document.getElementById("dirDropdownMenu");
if(menu) menu.classList.add("hidden");

// テーブル再描画
filterAndRenderTable();

};

window.filterDirectoryHealth = function(){

const keyword =
document.getElementById("dirHealthSearch")?.value.toLowerCase() || "";

const rows =
document.querySelectorAll("#directory-health-body tr");

rows.forEach(row=>{

const dir = row.children[0].innerText.toLowerCase();

if(dir.includes(keyword)){
row.style.display = "";
}else{
row.style.display = "none";
}

});

};

// -----------------------------
// ディレクトリエクセル出力
// -----------------------------

window.exportDirectoryExcel = function () {

const pages = SEOState?.allCrawlData || [];
if (!pages.length) {
    alert("出力データがありません");
    return;
}

// ----------------------
// ディレクトリ取得
// ----------------------

function getDirParts(url){

    try{

        const u = new URL(url);
        const parts = u.pathname
            .replace(/^\/+/,"")
            .replace(/\/$/,"")
            .split("/")
            .filter(Boolean);

        return parts;

    }catch{
        return [];
    }

}

// ----------------------
// ディレクトリ集計
// ----------------------

const map = {};

pages.forEach(p => {

    const parts = getDirParts(p.url);

    for(let i=0;i<parts.length;i++){

        const dir = parts.slice(0,i+1).join("/");

        if(!map[dir]){

            map[dir] = {
                parts: parts.slice(0,i+1),
                pages:0,
                score:0,
                indexed:0,
                issues:0
            };

        }

        map[dir].pages++;
        map[dir].score += (p.score || 0);

        if(p.index_status === "index") map[dir].indexed++;

        if((p.deduction_total || 0) > 0) map[dir].issues++;

    }

});

// ----------------------
// データ整形
// ----------------------

const header = [
"第一階層",
"第二階層",
"第三階層",
"第四階層",
"第五階層",
"ページ数",
"平均SEOスコア",
"問題ページ数",
"インデックス率"
];

const rows = [header];

Object.values(map).forEach(d => {

    const depth = d.parts.length;

    const row = [];

    for(let i=0;i<5;i++){
        row.push(d.parts[i] || "");
    }

    row.push(
        d.pages,
        Math.round(d.score / d.pages),
        d.issues,
        Math.round((d.indexed / d.pages)*100) + "%"
    );

    rows.push(row);

});

// ----------------------
// Sheet生成
// ----------------------

const ws = XLSX.utils.aoa_to_sheet(rows);

// ----------------------
// 列幅
// ----------------------

ws['!cols'] = [
{wch:22},
{wch:22},
{wch:22},
{wch:22},
{wch:22},
{wch:10},
{wch:14},
{wch:12},
{wch:12}
];

// ----------------------
// 色分け
// ----------------------

function getColor(depth){

if(depth === 1) return "E3F2FD";
if(depth === 2) return "E8F5E9";
if(depth === 3) return "FFF3E0";
if(depth === 4) return "F3E5F5";

return "F5F5F5";

}

Object.values(map).forEach((d,i)=>{

const depth = d.parts.length;
const color = getColor(depth);

const rowIndex = i+1;

for(let c=0;c<header.length;c++){

    const ref = XLSX.utils.encode_cell({r:rowIndex,c});

    if(!ws[ref]) continue;

    ws[ref].s = {
        fill:{fgColor:{rgb:color}}
    };

}

});

// ----------------------
// Workbook
// ----------------------

const wb = XLSX.utils.book_new();

XLSX.utils.book_append_sheet(wb,ws,"Directory Analysis");

XLSX.writeFile(wb,"seo_directory_analysis.xlsx");

};

// -----------------------------
// ページエクセル出力
// -----------------------------
window.exportToExcel = function () {

const data = SEOState?.allCrawlData || [];

if (!data.length) {
alert("出力データがありません");
return;
}

// -----------------------------
// URL → 階層分解
// -----------------------------
function splitPath(url) {

try {

const u = new URL(url);

let path = u.pathname;

path = path.replace(/^\/+/,"");
path = path.replace(/\/$/,"");

if(!path) return [];

return path.split("/");

} catch {

return [];

}

}

// -----------------------------
// 最大階層取得
// -----------------------------
let maxDepth = 0;

data.forEach(p => {

const parts = splitPath(p.url);

if(parts.length > maxDepth){
maxDepth = parts.length;
}

});

// -----------------------------
// ヘッダー
// -----------------------------
const header = ["No","URL"];

for(let i = 1; i <= maxDepth; i++){
header.push(`第${i}階層`);
}

header.push(
"Status",
"Index",
"Title",
"WordCount",
"H1",
"InternalLinks",
"Score",
"Priority"
);

// -----------------------------
// 行生成
// -----------------------------
const rows = [header];

data.forEach((p,index)=>{

const parts = splitPath(p.url);

const row = [
index+1,
p.url
];

// 階層
for(let d=0; d<maxDepth; d++){
row.push(parts[d] || "");
}

// SEO情報
row.push(
p.status || "",
p.index_status || "",
p.title || "",
p.word_count || 0,
p.h1_count || 0,
p.internal_links || 0,
p.score || 0,
isCritical(p) ? "HIGH" : ""
);

rows.push(row);

});

// -----------------------------
// Sheet
// -----------------------------
const ws = XLSX.utils.aoa_to_sheet(rows);

// -----------------------------
// 列幅
// -----------------------------
const cols = [];

cols.push({wch:5});   // No
cols.push({wch:70});  // URL

for(let i=0;i<maxDepth;i++){
cols.push({wch:20});
}

cols.push(
{wch:8},   // Status
{wch:10},  // Index
{wch:60},  // Title
{wch:10},  // WordCount
{wch:6},   // H1
{wch:12},  // InternalLinks
{wch:8},   // Score
{wch:10}   // Priority
);

ws['!cols'] = cols;

// -----------------------------
// 行色
// -----------------------------
function getRowColor(depth){

if(depth === 1) return "E3F2FD";
if(depth === 2) return "E8F5E9";
if(depth === 3) return "FFF3E0";

return "F5F5F5";

}

data.forEach((p,i)=>{

const depth = splitPath(p.url).length;
const color = getRowColor(depth);

const rowIndex = i+1;

for(let c=0;c<header.length;c++){

const ref = XLSX.utils.encode_cell({r:rowIndex,c});

if(!ws[ref]) continue;

ws[ref].s = {
fill:{fgColor:{rgb:color}}
};

}

});

// -----------------------------
// Workbook
// -----------------------------
const wb = XLSX.utils.book_new();

XLSX.utils.book_append_sheet(wb,ws,"SEO Pages");

XLSX.writeFile(wb,"seo_scan.xlsx");

};


// -----------------------------
// sitemap.xml
// -----------------------------


window.exportSitemap = function(){

const ok = confirm(
"sitemap.xml を生成します。\nダウンロードしますか？"
);

if(!ok) return;

const pages = SEOState?.allCrawlData || [];

if(!pages.length){
alert("ページデータがありません");
return;
}

// index可能ページのみ
const urls = pages.filter(p =>
p.status === 200 &&
p.index_status === "index"
);

// XML生成
let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

urls.forEach(p => {

xml += `
<url>
<loc>${p.url}</loc>
<lastmod>${new Date().toISOString().split("T")[0]}</lastmod>
</url>
`;

});

xml += `</urlset>`;

// ダウンロード
const blob = new Blob([xml], {type:"application/xml"});
const url = URL.createObjectURL(blob);

const a = document.createElement("a");
a.href = url;
a.download = "sitemap.xml";
a.click();

URL.revokeObjectURL(url);

};

// -----------------------------
// sitemap送信
// -----------------------------

window.submitSitemap = async function(){

const ok = confirm(
"sitemap.xml を生成し Google / Bing に送信します。\n実行しますか？"
);

if(!ok) return;

try{

const pages = SEOState?.allCrawlData || [];

if(!pages.length){
alert("ページデータがありません");
return;
}

const firstUrl = pages[0].url;

if(!firstUrl){
alert("URL取得失敗");
return;
}

const origin = new URL(firstUrl).origin;

const res = await fetch("/api/submit_sitemap",{
method:"POST",
credentials:"include",
headers:{
"Content-Type":"application/json"
},
body:JSON.stringify({
site_url: origin
})
});

if(!res.ok){
throw new Error("API error");
}

await loadLastSitemap();

alert("Sitemap送信完了");

}catch(e){

console.error(e);
alert("送信失敗");

}

};


// -----------------------------
// 送信履歴
// -----------------------------


window.loadLastSitemap = async function (siteUrl) {
  try {
    const url = siteUrl
      ? `/api/sitemap_last?site_url=${encodeURIComponent(siteUrl)}`
      : "/api/sitemap_last";
    const res = await fetch(url, { credentials: "include" });

    if (!res.ok) return;

    const data = await res.json();

    if (!data.date) return;

    const d = new Date(data.date);
    const formatted =
      d.getFullYear() + "/" +
      String(d.getMonth() + 1).padStart(2, "0") + "/" +
      String(d.getDate()).padStart(2, "0") + " " +
      String(d.getHours()).padStart(2, "0") + ":" +
      String(d.getMinutes()).padStart(2, "0");

    const el = document.getElementById("last-sitemap-date");
    if (el) el.textContent = formatted;
  } catch (e) {
    console.error("last sitemap load error", e);
  }
};



document.addEventListener("DOMContentLoaded", () => {

  loadLastSitemap();

  const btn = document.getElementById("submitSitemapBtn");

  if(btn){
    btn.addEventListener("click", submitSitemap);
  }

  const dirExcelBtn = document.getElementById("exportDirectoryExcelBtn");

  if(dirExcelBtn){
    dirExcelBtn.addEventListener("click", exportDirectoryExcel);
  }

});

document.addEventListener("click", function(e){

// 詳細ボタン
const detailBtn = e.target.closest(".detail-btn");

if(detailBtn){
  const index = detailBtn.dataset.index;
  openDetailModal(index);
  return;
}

// モーダル閉じる
const closeBtn = e.target.closest(".close-modal-btn");

if(closeBtn){
  closeModal();
  return;
}

});