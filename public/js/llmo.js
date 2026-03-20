/**
 * llmo.js - LLM Optimization (LLMO) 解析ロジック
 * /api/scans/result/:id からスキャンデータを取得し、LLMO分析UIを表示
 */
(function () {
  "use strict";

  let llmoData = [];
  let allLlmoData = []; // フィルタ前の全データ

  const params = new URLSearchParams(window.location.search);
  const scanId = params.get("scan") || params.get("scanId");
  if (!scanId) {
    window.location.replace("/seo.html");
    return;
  }

  /* ==========================================
   * 1. データ準備 & スコアリング
   * ========================================== */
  function buildLlmoData(pages) {
    return pages.map((page, index) => {
      const baseScore = page.score || 0;
      const h1Count = page.h1_count ?? page.h1Count ?? 0;

      let displayPath = "/";
      try {
        const urlObj = new URL(page.url);
        displayPath = urlObj.pathname + urlObj.search;
      } catch (e) {
        displayPath = page.url;
      }

      const detectedSchema = [];
      if (h1Count > 0) detectedSchema.push("WebPage");
      if (page.url.includes("blog") || page.url.includes("news")) detectedSchema.push("Article");
      if (page.url.includes("contact") || page.url.includes("about")) detectedSchema.push("Organization");
      if (page.url.includes("profile") || (page.title && page.title.includes("著者"))) detectedSchema.push("Person");
      if (page.url.includes("service") || page.url.includes("price")) detectedSchema.push("Service");

      const allRequired = ["FAQPage", "BreadcrumbList", "Organization", "Person", "Service"];
      const missingSchema = allRequired.filter((s) => !detectedSchema.includes(s));

      const s_schema = Math.min(detectedSchema.length * 20, 100);
      const s_clarity = baseScore >= 85 ? 95 : baseScore >= 70 ? 75 : 40;
      const s_graph = Math.min(detectedSchema.length * 15 + ((page.title || "").length > 20 ? 40 : 10), 100);
      const s_citation = Math.floor(s_schema * 0.4 + s_clarity * 0.4 + s_graph * 0.2);

      let rank = "C";
      let rankColor = "text-red-500";
      if (s_citation >= 85) {
        rank = "A";
        rankColor = "text-emerald-500";
      } else if (s_citation >= 70) {
        rank = "B+";
        rankColor = "text-blue-500";
      }

      const auditFindings = [];
      if (missingSchema.includes("Organization")) auditFindings.push("運営者情報(Organization)が未定義です");
      if (missingSchema.includes("Person")) auditFindings.push("著者情報(Person)の紐付けがありません");
      if (s_schema < 60) auditFindings.push(`構造化データの網羅率不足 (${missingSchema.slice(0, 2).join(", ")})`);

      return {
        id: index,
        url: page.url,
        path: displayPath,
        title: page.title || "Untitled",
        contextRank: rank,
        contextColor: rankColor,
        contextStatus: s_citation >= 70 ? "良好" : "要改善",
        schema: detectedSchema.length > 0 ? detectedSchema : ["未検出"],
        missingSchema: missingSchema.slice(0, 3),
        citability: `${s_citation}%`,
        entity: (page.title || "").split(/[\s|｜\-_]/)[0] || "トピック",
        individualScores: { citation: s_citation, schema: s_schema, clarity: s_clarity, graph: s_graph },
        auditFindings: auditFindings,
      };
    });
  }

  /* ==========================================
   * 2. 初期化 & データ取得
   * ========================================== */
  window.addEventListener("DOMContentLoaded", () => {
    void loadScanData();
  });

  async function loadScanData() {
    try {
      const res = await fetch(`/api/scans/result/${encodeURIComponent(scanId)}`, {
        credentials: "include",
      });

      if (res.status === 401) {
        window.location.replace("/");
        return;
      }
      if (res.status === 404) {
        showError("スキャンが見つかりません。一覧から再度お試しください。");
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showError(errData.error || `エラーが発生しました (${res.status})`);
        return;
      }

      const data = await res.json();
      const pages = data.pages || [];
      const scan = data.scan || {};

      if (pages.length === 0) {
        showError("ページデータがありません。");
        return;
      }

      allLlmoData = buildLlmoData(pages);
      llmoData = [...allLlmoData];

      const rootUrl = scan.target_url || pages[0]?.url || "";
      try {
        const domain = new URL(rootUrl).hostname;
        const domainEl = document.getElementById("displayDomain");
        const urlEl = document.getElementById("displayUrl");
        if (domainEl) domainEl.textContent = domain;
        if (urlEl) urlEl.textContent = `Root: ${rootUrl}`;
      } catch (e) {}

      if (window.generateDirectoryOptions) window.generateDirectoryOptions();
      renderLLMOTable();
      window.selectUrlByIndex(0);
    } catch (e) {
      console.error(e);
      showError("データの取得に失敗しました。");
    }
  }

  function showError(message) {
    const main = document.querySelector("main");
    if (main) {
      main.innerHTML = `
        <div class="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <p class="text-slate-600 font-bold mb-6">${message}</p>
          <a href="/seo.html" class="inline-block px-8 py-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition">一覧に戻る</a>
        </div>
      `;
    } else {
      alert(message + "\n一覧に戻ります。");
      window.location.replace("/seo.html");
    }
  }

  /* ==========================================
   * 3. テーブル描画
   * ========================================== */
  function renderLLMOTable() {
    const body = document.getElementById("llmoTableBody");
    if (!body) return;

    body.innerHTML = llmoData
      .map(
        (page, idx) => `
        <tr id="row-${idx}" class="hover:bg-slate-50/80 transition-colors border-b border-slate-50 cursor-pointer" onclick="window.selectUrlByIndex(${idx})">
            <td class="p-4" data-label="URL"><p class="font-mono text-[11px] text-blue-600 break-all">${escapeHtml(page.path)}</p></td>
            <td class="p-4 text-center" data-label="明瞭性ランク">
                <span class="text-lg font-black ${page.contextColor}">${page.contextRank}</span>
                <span class="block text-[9px] font-bold text-slate-400 uppercase tracking-tighter">${page.contextStatus}</span>
            </td>
            <td class="p-4 text-center" data-label="実装タグ">
                <div class="flex flex-wrap justify-center gap-1">
                    ${page.schema.map((s) => `<span class="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[9px] font-bold border border-slate-200">${escapeHtml(s)}</span>`).join("")}
                </div>
            </td>
            <td class="p-4 text-center" data-label="AI引用率"><span class="font-black text-slate-900 text-base">${page.citability}</span></td>
            <td class="p-4 text-center" data-label="主要トピック"><span class="text-xs text-slate-500 font-bold">${escapeHtml(page.entity)}</span></td>
            <td class="p-4 text-center" data-label="詳細">
                <button onclick="event.stopPropagation(); window.openLLMOModal(${page.id})" class="p-2 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-full">
                    <svg class="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                </button>
            </td>
        </tr>
    `
      )
      .join("");
  }

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /* ==========================================
   * 4. 画面同期 & メトリクス更新
   * ========================================== */
  window.selectUrlByIndex = function (index) {
    const page = llmoData[index];
    if (!page) return;

    document.querySelectorAll("#llmoTableBody tr").forEach((tr) => tr.classList.remove("bg-blue-50/50"));
    const row = document.getElementById(`row-${index}`);
    if (row) row.classList.add("bg-blue-50/50");

    const scores = page.individualScores;

    updateElement("cite-score", scores.citation, getScoreColorClass(scores.citation));
    updateElement("schema-score", scores.schema, getScoreColorClass(scores.schema));

    const schemaBar = document.getElementById("schema-bar");
    if (schemaBar) {
      schemaBar.style.width = `${scores.schema}%`;
      schemaBar.className = `h-1.5 rounded-full transition-all duration-1000 ${scores.schema >= 80 ? "bg-emerald-500" : "bg-orange-500"}`;
    }

    updateElement("clarity-score", page.contextRank, page.contextColor);
    updateElement("graph-score", scores.graph, scores.graph >= 80 ? "text-slate-900" : "text-slate-400");

    if (window.updateAiLlmReview) window.updateAiLlmReview(page, scores.citation);
  };

  function updateElement(id, text, className) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = text;
      if (className) el.className = `text-3xl font-black ${className}`;
    }
  }

  /* ==========================================
   * 5. AI レビュー表示
   * ========================================== */
  window.updateAiLlmReview = function (page, score) {
    const el = document.getElementById("aiLlmReview");
    if (!el || !page) return;

    let adviceTitle =
      score >= 85
        ? "【最高評価】AI検索エンジンの信頼を獲得しています"
        : score >= 60
        ? "【標準評価】専門性の証明(E-E-A-T)を強化することで引用率が向上します"
        : "【警告】AIから「信頼性の低いソース」と見なされている可能性があります";

    let adviceBody =
      score >= 85
        ? "構造化データによる情報の裏付けが完璧です。AI回答のメインソースとして選定されやすい状態です。"
        : score >= 60
        ? "内容の理解は進んでいますが、「誰が発信しているか」という情報の紐付けが弱いため、引用順位が下がっています。"
        : "AIは匿名性の高い情報を嫌います。運営者や著者のメタデータを至急追加してください。";

    let hintList =
      page.auditFindings && page.auditFindings.length > 0
        ? page.auditFindings
            .map((finding) => {
              if (finding.includes("Organization")) return `<li><span class="text-indigo-600 font-bold">重要:</span> 組織の構造化データで信頼性を担保してください。</li>`;
              if (finding.includes("Person")) return `<li><span class="text-indigo-600 font-bold">重要:</span> 著者プロフィールにPersonタグを実装してください。</li>`;
              if (finding.includes("網羅率")) return `<li><span class="text-blue-600 font-bold">改善:</span> 推奨される構造化タグを補完してください。</li>`;
              return `<li>${escapeHtml(finding)}</li>`;
            })
            .join("")
        : `<li>現在の高い信頼性を維持するため、定期的な情報の更新を行ってください。</li>`;

    el.innerHTML = `
        <div class="space-y-4">
            <h4 class="text-[13px] font-black text-slate-900">${adviceTitle}</h4>
            <p class="text-[12px] text-slate-600">${adviceBody}</p>
            <div class="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100/50">
                <ul class="text-[12px] text-slate-700 list-disc pl-4 space-y-2">${hintList}</ul>
            </div>
        </div>
    `;
  };

  /* ==========================================
   * 6. モーダル表示
   * ========================================== */
  window.openLLMOModal = function (id) {
    const page = allLlmoData.find((p) => p.id === id) || llmoData.find((p) => p.id === id);
    if (!page) return;

    document.getElementById("modalSubTitle").textContent = `対象URL: ${page.url}`;
    const modalBody = document.getElementById("modalBody");
    modalBody.innerHTML = `
        <section class="mb-8">
            <h3 class="text-[11px] font-black uppercase text-slate-800 mb-4 flex items-center gap-2">
                <div class="w-1.5 h-4 bg-indigo-600 rounded-full"></div>項目別診断スコア
            </h3>
            <div class="grid grid-cols-2 gap-3">
                ${Object.entries({ "AI引用可能性": "citation", "構造化データ": "schema", "文脈明瞭性": "clarity", "ナレッジグラフ": "graph" })
                  .map(
                    ([label, key]) => `
                    <div class="p-4 bg-slate-50 rounded-xl border border-slate-100">
                        <div class="flex justify-between items-end mb-2">
                            <span class="text-[10px] font-bold text-slate-500">${label}</span>
                            <span class="text-lg font-black ${page.individualScores[key] >= 80 ? "text-emerald-600" : "text-orange-500"}">${page.individualScores[key]}<span class="text-[10px] text-slate-300 ml-0.5">/100</span></span>
                        </div>
                        <div class="w-full bg-slate-200 h-1 rounded-full">
                            <div class="h-1 rounded-full ${page.individualScores[key] >= 80 ? "bg-emerald-500" : "bg-orange-500"}" style="width: ${page.individualScores[key]}%"></div>
                        </div>
                    </div>
                `
                  )
                  .join("")}
            </div>
        </section>
        <section class="mb-8">
            <h3 class="text-[11px] font-black uppercase text-red-500 mb-3 flex items-center gap-2">主要な減点要因 (Audit Findings)</h3>
            <div class="space-y-2">
                ${page.auditFindings.length > 0 ? page.auditFindings.map((f) => `<div class="p-3 bg-red-50 border border-red-100 rounded-lg text-[12px] text-red-700 flex justify-between items-center"><span>${escapeHtml(f)}</span><span class="font-bold uppercase text-[9px]">減点</span></div>`).join("") : `<p class="text-[12px] text-emerald-600 font-bold bg-emerald-50 p-3 rounded-lg text-center">重大な欠陥は見当たりません</p>`}
            </div>
        </section>
        <section class="space-y-4">
            <h3 class="text-[11px] font-black uppercase tracking-widest text-slate-800 flex items-center gap-2"><div class="w-1.5 h-4 bg-slate-300 rounded-full"></div>実装済みタグと推奨タグ</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                ${page.schema.map((s) => `<div class="flex items-center justify-between p-4 border border-emerald-100 bg-emerald-50/30 rounded-xl"><span class="text-[12px] font-bold text-emerald-700">${escapeHtml(s)} (実装)</span></div>`).join("")}
                ${page.missingSchema.map((s) => `<div class="flex items-center justify-between p-4 border border-slate-100 bg-slate-50/50 rounded-xl"><span class="text-[12px] font-bold text-slate-500">${escapeHtml(s)} (推奨)</span></div>`).join("")}
            </div>
        </section>
    `;
    document.getElementById("modalOverlay").classList.remove("hidden");
  };

  window.closeLLMOModal = function () {
    document.getElementById("modalOverlay").classList.add("hidden");
  };

  document.getElementById("modalOverlay")?.addEventListener("click", (e) => {
    if (e.target.id === "modalOverlay") window.closeLLMOModal();
  });

  /* ==========================================
   * 7. フィルタ & ソート
   * ========================================== */
  window.filterLLMOTable = function () {
    const keyword = (document.getElementById("searchInput")?.value || "").toLowerCase();
    const directory = document.getElementById("directoryFilter")?.value || "";

    llmoData = allLlmoData.filter((p) => {
      const matchK = !keyword || p.url.toLowerCase().includes(keyword) || p.title.toLowerCase().includes(keyword) || p.path.toLowerCase().includes(keyword);
      const matchD = !directory || p.path.startsWith(directory) || p.path === directory.replace(/\/$/, "");
      return matchK && matchD;
    });
    renderLLMOTable();
    if (llmoData.length > 0) window.selectUrlByIndex(0);
  };

  window.sortData = function (type) {
    const key = type === "citation" ? "individualScores.citation" : type === "schema" ? "individualScores.schema" : type === "clarity" ? "individualScores.clarity" : "individualScores.graph";
    llmoData.sort((a, b) => {
      const va = key.split(".").reduce((o, k) => o[k], a);
      const vb = key.split(".").reduce((o, k) => o[k], b);
      return (vb || 0) - (va || 0);
    });
    renderLLMOTable();
    if (llmoData.length > 0) window.selectUrlByIndex(0);
  };

  /* ==========================================
   * 8. ディレクトリオプション & Excel出力
   * ========================================== */
  window.generateDirectoryOptions = function () {
    const filter = document.getElementById("directoryFilter");
    if (!filter) return;
    filter.innerHTML = '<option value="">すべてのディレクトリ</option>';
    const paths = new Set();
    allLlmoData.forEach((p) => {
      const parts = p.path.split("/").filter(Boolean);
      if (parts.length >= 1) paths.add("/" + parts[0] + "/");
    });
    paths.forEach((path) => {
      const opt = document.createElement("option");
      opt.value = path;
      opt.textContent = path;
      filter.appendChild(opt);
    });
  };

  window.downloadLLMOExcel = function () {
    if (!allLlmoData.length) return alert("データがありません");
    try {
      const wb = XLSX.utils.book_new();
      const header = ["URL", "文脈ランク", "AI引用率", "引用スコア", "構造化スコア", "明瞭性スコア", "グラフスコア", "実装済みタグ", "不足タグ", "具体的な改善ポイント"];
      const rows = allLlmoData.map((p) => [
        p.url,
        p.contextRank,
        p.citability,
        p.individualScores.citation,
        p.individualScores.schema,
        p.individualScores.clarity,
        p.individualScores.graph,
        p.schema.join(", "),
        p.missingSchema.join(", "),
        p.auditFindings.join(" / "),
      ]);
      const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
      ws["!cols"] = [{ wch: 45 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 25 }, { wch: 25 }, { wch: 60 }];
      XLSX.utils.book_append_sheet(wb, ws, "LLMO診断詳細");
      XLSX.writeFile(wb, `LLMO_Audit_Report_${new Date().getTime()}.xlsx`);
    } catch (e) {
      console.error("Excel Error:", e);
      alert("Excel出力中にエラーが発生しました。");
    }
  };

  function getScoreColorClass(score) {
    if (score >= 80) return "text-emerald-600";
    if (score >= 50) return "text-orange-500";
    return "text-red-600";
  }
})();
