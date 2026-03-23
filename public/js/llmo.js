/**
 * llmo.js - LLM Optimization (LLMO) 解析ロジック
 * 改善アクション機能（仕様書準拠）
 */
(function () {
  "use strict";

  let llmoData = [];
  let allLlmoData = [];
  let statuses = []; // statuses[pageIdx][actionIdx] = 'todo'|'done'|'hold'|'skip'
  let currentFilter = "all";
  let openPageIndex = -1;

  const params = new URLSearchParams(window.location.search);
  const scanId = params.get("scan") || params.get("scanId");
  if (!scanId) {
    window.location.replace("/seo.html");
    return;
  }

  const STORAGE_KEY = "llmo_status_" + scanId;

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /* ==========================================
   * 1. 改善アクション生成
   * ========================================== */
  function buildActionsFromPage(page) {
    const actions = [];
    const path = (page.path || "/").replace(/\?.*$/, "");
    const missing = page.missingSchema || [];
    const findings = page.auditFindings || [];

    const add = (pri, diff, title, desc, alt) => actions.push({ pri, priL: pri === "ph2" ? "高優先" : pri === "pm2" ? "中優先" : "低優先", diff, diffL: diff === "dh" ? "実装: 高" : diff === "dm" ? "実装: 中" : "実装: 低", title, desc, alt: alt || "" });

    if (missing.includes("BreadcrumbList")) add("ph2", path === "/" ? "dh" : "dm", "BreadcrumbList スキーマを追加", "BreadcrumbListが未実装。サイト構造をAIに明示するために最優先で対応してください。", path === "/" ? "CMSテンプレート改修が難しい場合はhead内にJSON-LDを手動で1件追加するだけでも効果があります。" : "");

    if (missing.includes("Organization")) {
      if (path.includes("about") || path === "/") add("ph2", "dm", "Organization スキーマに SNS・住所・電話番号を追加", "OrganizationタグがAIに不完全と判断されています。公式SNSリンク・住所・電話番号を追記してください。", "フッターに会社名・住所・電話番号をテキストで明記するだけでも改善されます。");
      if (path.includes("about")) add("ph2", "dm", "Organization スキーマに代表者 Person タグを追加", "会社概要ページで代表者情報が構造化されていません。Personスキーマをネストして追加してください。", "個人名の公開が難しい場合は「代表取締役」という肩書きのみでも有効です。");
    }

    if (missing.includes("Person") && (path.includes("news") || path.includes("blog") || path.includes("article"))) add("ph2", "dh", "Article スキーマに author (Person) を追加", "ニュース記事に著者情報が構造化されていません。Personスキーマをauthorフィールドに追加してください。", "個人名の公開が難しい場合は「○○株式会社 編集部」という組織名をauthorに設定しOrganizationと紐付けてください。");

    if (missing.includes("Service") && (path.includes("solution") || path.includes("service") || path.includes("事業"))) add("ph2", "dh", "Service スキーマを実装", "事業内容ページにServiceスキーマが未実装。サービス名・概要・対象をJSON-LDで記述してください。", "実装が難しい場合は各サービスの説明文の先頭に「サービス名: ○○」と明示的に記述するだけで改善されます。");

    if (findings.some((f) => f.includes("主語") || f.includes("代名詞")) || page.individualScores?.clarity < 70) add("pm2", "de", "ページ冒頭に主語を明確に記述", "代名詞を避け、主語を明確に記述することでAIの要約と回答精度が安定します。", "");

    if (missing.includes("Organization") && path.includes("about")) add("pm2", "dm", "sameAs に会社の外部プロフィールURLを指定", "WikidataやCrunchbaseなど信頼性の高いURLをsameAsに追加しナレッジグラフとの接続を強化します。", "会社のLinkedInページURLを1件追加するだけでも効果があります。");

    if (actions.length === 0) add("pl2", "de", "構造化データの確認", "現状の構造化データを維持しつつ、定期的な更新を行ってください。", "");

    return actions;
  }

  /* ==========================================
   * 2. データ準備 & スコアリング
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
        displayPath = page.url || "/";
      }

      const detectedSchema = [];
      if (h1Count > 0) detectedSchema.push("WebPage");
      if (page.url && (page.url.includes("blog") || page.url.includes("news"))) detectedSchema.push("Article");
      if (page.url && (page.url.includes("contact") || page.url.includes("about"))) detectedSchema.push("Organization");
      if (page.url && (page.url.includes("profile") || (page.title && page.title.includes("著者")))) detectedSchema.push("Person");
      if (page.url && (page.url.includes("service") || page.url.includes("price"))) detectedSchema.push("Service");

      const allRequired = ["FAQPage", "BreadcrumbList", "Organization", "Person", "Service"];
      const missingSchema = allRequired.filter((s) => !detectedSchema.includes(s));

      const s_schema = Math.min(detectedSchema.length * 20, 100);
      const s_clarity = baseScore >= 85 ? 95 : baseScore >= 70 ? 75 : 40;
      const s_graph = Math.min(detectedSchema.length * 15 + ((page.title || "").length > 20 ? 40 : 10), 100);
      const s_citation = Math.floor(s_schema * 0.4 + s_clarity * 0.4 + s_graph * 0.2);

      let rank = "C";
      let rankClass = "llmo-rank-c";
      if (s_citation >= 85) {
        rank = "A";
        rankClass = "llmo-rank-a";
      } else if (s_citation >= 70) {
        rank = "B+";
        rankClass = "llmo-rank-b";
      }

      const auditFindings = [];
      if (missingSchema.includes("Organization")) auditFindings.push("運営者情報(Organization)が未定義です");
      if (missingSchema.includes("Person")) auditFindings.push("著者情報(Person)の紐付けがありません");
      if (s_schema < 60) auditFindings.push(`構造化データの網羅率不足 (${missingSchema.slice(0, 2).join(", ")})`);

      const base = {
        id: index,
        url: page.url,
        path: displayPath,
        title: page.title || "Untitled",
        contextRank: rank,
        contextColor: rankClass,
        schema: detectedSchema.length > 0 ? detectedSchema : ["未検出"],
        missingSchema: missingSchema.slice(0, 5),
        citability: s_citation,
        entity: (page.title || "").split(/[\s|｜\-_]/)[0] || "トピック",
        individualScores: { citation: s_citation, schema: s_schema, clarity: s_clarity, graph: s_graph },
        auditFindings,
      };
      base.actions = buildActionsFromPage({ ...base, missingSchema, auditFindings });
      return base;
    });
  }

  function loadStatuses() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return null;
  }

  function saveStatuses() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(statuses));
    } catch (e) {}
  }

  /* ==========================================
   * 3. 初期化 & データ取得
   * ========================================== */
  window.addEventListener("DOMContentLoaded", () => {
    void loadScanData();
  });

  async function loadScanData() {
    try {
      const res = await fetch(`/api/scans/result/${encodeURIComponent(scanId)}`, { credentials: "include" });
      if (res.status === 401) { window.location.replace("/"); return; }
      if (res.status === 404) { showError("スキャンが見つかりません。"); return; }
      if (!res.ok) { showError(`エラー (${res.status})`); return; }

      const data = await res.json();
      const pages = data.pages || [];
      const scan = data.scan || {};

      if (pages.length === 0) { showError("ページデータがありません。"); return; }

      allLlmoData = buildLlmoData(pages);

      const saved = loadStatuses();
      statuses = saved && saved.length === allLlmoData.length && saved.every((arr, i) => Array.isArray(arr) && arr.length === (allLlmoData[i]?.actions?.length || 0))
        ? saved
        : allLlmoData.map((p) => (p.actions || []).map(() => "todo"));

      llmoData = [...allLlmoData];

      const rootUrl = scan.target_url || pages[0]?.url || "";
      try {
        const domain = new URL(rootUrl).hostname;
        const domainEl = document.getElementById("displayDomain");
        const urlEl = document.getElementById("displayUrl");
        if (domainEl) domainEl.textContent = domain;
        if (urlEl) urlEl.textContent = `Root: ${rootUrl}`;
      } catch (e) {}

      bindFilterButtons();
      renderLLMOPageList();
      if (llmoData.length > 0) window.selectUrlByIndex(0);
    } catch (e) {
      console.error(e);
      showError("データの取得に失敗しました。");
    }
  }

  function showError(message) {
    const main = document.querySelector("main");
    if (main) main.innerHTML = `<div class="bg-white rounded-2xl border border-slate-200 p-12 text-center"><p class="text-slate-600 font-bold mb-6">${escapeHtml(message)}</p><a href="/seo.html" class="inline-block px-8 py-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition">一覧に戻る</a></div>`;
    else { alert(message); window.location.replace("/seo.html"); }
  }

  function bindFilterButtons() {
    document.querySelectorAll(".llmo-fb").forEach((btn) => {
      btn.addEventListener("click", () => {
        const f = btn.dataset.filter || "all";
        currentFilter = f;
        document.querySelectorAll(".llmo-fb").forEach((b) => b.classList.remove("on"));
        btn.classList.add("on");
        renderLLMOPageList();
      });
    });
  }

  /* ==========================================
   * 4. ページ一覧描画（アコーディオン）
   * ========================================== */
  function totalDone() {
    let d = 0, t = 0;
    allLlmoData.forEach((p, i) => {
      (p.actions || []).forEach((_, j) => {
        t++;
        if (statuses[i] && statuses[i][j] === "done") d++;
      });
    });
    return { d, t };
  }

  function renderLLMOPageList() {
    const list = document.getElementById("page-list");
    if (!list) return;

    const { d, t } = totalDone();
    const metaEl = document.getElementById("global-meta");
    if (metaEl) metaEl.textContent = `改善アクション: ${d}件完了 / ${t}件`;

    list.innerHTML = "";

    allLlmoData.forEach((page, pi) => {
      const sts = statuses[pi] || [];
      const done = sts.filter((s) => s === "done").length;
      const total = (page.actions || []).length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      const isOpen = openPageIndex === pi;

      if (currentFilter !== "all") {
        const hasMatch = currentFilter === "todo" ? sts.some((s) => s === "todo") : sts.some((s) => s === currentFilter);
        if (!hasMatch) return;
      }

      const actionsHtml = (page.actions || [])
        .map((a, ai) => {
          const s = sts[ai] || "todo";
          if (currentFilter === "done" && s !== "done") return "";
          if (currentFilter === "hold" && s !== "hold") return "";
          if (currentFilter === "skip" && s !== "skip") return "";
          if (currentFilter === "todo" && s !== "todo") return "";
          return `
<div class="llmo-ac ${s === "done" ? "done" : ""} ${s === "skip" ? "skip" : ""}" id="ac-${pi}-${ai}">
  <div class="llmo-ac-top">
    <div class="llmo-bgs">
      <span class="llmo-pb2 llmo-${a.pri}">${escapeHtml(a.priL)}</span>
      <span class="llmo-db2 llmo-${a.diff}">${escapeHtml(a.diffL)}</span>
    </div>
    <div class="llmo-ac-body">
      <div class="llmo-ac-title">${escapeHtml(a.title)}</div>
      <div class="llmo-ac-desc">${escapeHtml(a.desc)}</div>
      ${a.alt ? `<div class="llmo-alt"><div class="llmo-alt-lbl">代替案（対応が難しい場合）</div><div class="llmo-alt-txt">${escapeHtml(a.alt)}</div></div>` : ""}
      <div class="llmo-ac-footer">
        <button type="button" class="llmo-sb bdone ${s === "done" ? "on" : ""}" data-pi="${pi}" data-ai="${ai}" data-s="done">✓ 完了</button>
        <button type="button" class="llmo-sb bhold ${s === "hold" ? "on" : ""}" data-pi="${pi}" data-ai="${ai}" data-s="hold">⏸ 保留</button>
        <button type="button" class="llmo-sb bskip ${s === "skip" ? "on" : ""}" data-pi="${pi}" data-ai="${ai}" data-s="skip">✕ 対応困難</button>
      </div>
    </div>
  </div>
</div>`;
        })
        .join("");

      const row = document.createElement("div");
      row.className = "llmo-page-row" + (isOpen ? " is-open" : "");
      row.innerHTML = `
<div class="llmo-ph" data-pi="${pi}">
  <div class="llmo-ph-url">${escapeHtml(page.path)}</div>
  <span class="llmo-ph-rank ${page.contextColor}">${escapeHtml(page.contextRank)}</span>
  <div class="llmo-ph-ai">${page.citability}%</div>
  <div class="llmo-ph-tasks">${done}/${total} 完了</div>
  <div class="llmo-ph-mini-bar"><div class="llmo-ph-mini-fill" style="width:${pct}%"></div></div>
  <div class="llmo-chev ${isOpen ? "open" : ""}">▼</div>
</div>
<div class="llmo-pb-body ${isOpen ? "open" : ""}">
  ${actionsHtml || '<div class="llmo-empty">このフィルターに該当するアクションはありません</div>'}
  <div class="llmo-pg-progress">
    <div class="llmo-pg-bar"><div class="llmo-pg-fill" style="width:${pct}%"></div></div>
    <div class="llmo-pg-lbl">${done} / ${total} 完了</div>
  </div>
</div>`;

      row.querySelector(".llmo-ph").addEventListener("click", () => togglePage(pi));
      row.querySelectorAll(".llmo-sb").forEach((sb) => {
        sb.addEventListener("click", (e) => {
          e.stopPropagation();
          setActionStatus(parseInt(sb.dataset.pi, 10), parseInt(sb.dataset.ai, 10), sb.dataset.s);
        });
      });

      list.appendChild(row);
    });
  }

  window.togglePage = function (pi) {
    openPageIndex = openPageIndex === pi ? -1 : pi;
    renderLLMOPageList();
    if (allLlmoData[pi]) window.selectUrlByIndex(pi);
  };

  function setActionStatus(pi, ai, s) {
    if (!statuses[pi]) statuses[pi] = [];
    const cur = statuses[pi][ai];
    statuses[pi][ai] = cur === s ? "todo" : s;
    saveStatuses();
    renderLLMOPageList();
  }

  /* ==========================================
   * 5. メトリクス更新 & 選択
   * ========================================== */
  window.selectUrlByIndex = function (index) {
    const page = llmoData[index];
    if (!page) return;

    const scores = page.individualScores || {};
    const schemaBar = document.getElementById("schema-bar");
    const citeEl = document.getElementById("cite-score");
    const schemaEl = document.getElementById("schema-score");
    const clarityEl = document.getElementById("clarity-score");
    const graphEl = document.getElementById("graph-score");

    if (citeEl) citeEl.textContent = scores.citation ?? "--";
    if (schemaEl) schemaEl.textContent = scores.schema ?? "--";
    if (clarityEl) clarityEl.textContent = page.contextRank ?? "--";
    if (graphEl) graphEl.textContent = scores.graph ?? "--";

    if (schemaBar) {
      schemaBar.style.width = `${scores.schema || 0}%`;
      schemaBar.className = `h-1.5 rounded-full transition-all duration-1000 ${(scores.schema || 0) >= 80 ? "bg-emerald-500" : "bg-orange-500"}`;
    }

    if (window.updateAiLlmReview) window.updateAiLlmReview(page, scores.citation);
  };

  window.updateAiLlmReview = function (page, score) {
    const el = document.getElementById("aiLlmReview");
    if (!el || !page) return;

    let adviceTitle = score >= 85 ? "【最高評価】AI検索エンジンの信頼を獲得しています" : score >= 60 ? "【標準評価】専門性の証明(E-E-A-T)を強化することで引用率が向上します" : "【警告】AIから「信頼性の低いソース」と見なされている可能性があります";
    let adviceBody = score >= 85 ? "構造化データによる情報の裏付けが完璧です。" : score >= 60 ? "内容の理解は進んでいますが、「誰が発信しているか」の紐付けが弱いです。" : "AIは匿名性の高い情報を嫌います。運営者や著者のメタデータを至急追加してください。";

    const hintList = (page.auditFindings || []).length > 0
      ? (page.auditFindings || []).map((f) => {
          if (f.includes("Organization")) return `<div class="llmo-insight-item"><span class="llmo-kw-red">重要:</span> 組織の構造化データで信頼性を担保してください。</div>`;
          if (f.includes("Person")) return `<div class="llmo-insight-item"><span class="llmo-kw-red">重要:</span> 著者プロフィールにPersonタグを実装してください。</div>`;
          return `<div class="llmo-insight-item">${escapeHtml(f)}</div>`;
        }).join("") + `<div class="llmo-insight-item"><span class="llmo-kw-blue">改善:</span> 推奨される構造化タグを補完してください。</div>`
      : `<div class="llmo-insight-item">現在の高い信頼性を維持するため、定期的な更新を行ってください。</div>`;

    el.innerHTML = `
      <div class="llmo-insight-sub">AI検索エンジンからの視認性評価</div>
      <div class="llmo-insight-title">${adviceTitle}</div>
      <div class="llmo-insight-body">${adviceBody}</div>
      <div class="llmo-insight-items">${hintList}</div>`;
  };

  /* ==========================================
   * 6. モーダル & Excel
   * ========================================== */
  window.openLLMOModal = function (id) {
    const page = allLlmoData.find((p) => p.id === id) || llmoData.find((p) => p.id === id);
    if (!page) return;
    document.getElementById("modalSubTitle").textContent = `対象URL: ${page.url}`;
    const modalBody = document.getElementById("modalBody");
    const scores = page.individualScores || {};
    modalBody.innerHTML = `
      <section class="mb-8">
        <h3 class="text-[11px] font-black uppercase text-slate-800 mb-4">項目別診断スコア</h3>
        <div class="grid grid-cols-2 gap-3">
          ${["AI引用可能性", "構造化データ", "文脈明瞭性", "ナレッジグラフ"].map((label, i) => {
            const key = ["citation", "schema", "clarity", "graph"][i];
            const v = scores[key] ?? 0;
            return `<div class="p-4 bg-slate-50 rounded-xl border border-slate-100"><span class="text-[10px] font-bold text-slate-500">${label}</span><span class="text-lg font-black ${v >= 80 ? "text-emerald-600" : "text-orange-500"}">${v}/100</span></div>`;
          }).join("")}
        </div>
      </section>
      <section class="mb-8">
        <h3 class="text-[11px] font-black uppercase text-red-500 mb-3">主要な減点要因</h3>
        ${(page.auditFindings || []).length > 0 ? page.auditFindings.map((f) => `<div class="p-3 bg-red-50 border border-red-100 rounded-lg text-[12px] text-red-700">${escapeHtml(f)}</div>`).join("") : "<p class='text-[12px] text-emerald-600 font-bold'>重大な欠陥は見当たりません</p>"}
      </section>`;
    document.getElementById("modalOverlay").classList.remove("hidden");
  };

  window.closeLLMOModal = function () {
    document.getElementById("modalOverlay").classList.add("hidden");
  };

  document.getElementById("modalOverlay")?.addEventListener("click", (e) => {
    if (e.target.id === "modalOverlay") window.closeLLMOModal();
  });

  window.sortData = function (type) {
    const key = type === "citation" ? "citation" : type === "schema" ? "schema" : type === "clarity" ? "clarity" : "graph";
    llmoData.sort((a, b) => (b.individualScores?.[key] || 0) - (a.individualScores?.[key] || 0));
    renderLLMOPageList();
    if (llmoData.length > 0) window.selectUrlByIndex(0);
  };

  window.filterLLMOTable = function () { renderLLMOPageList(); };

  window.generateDirectoryOptions = function () {};

  window.downloadLLMOExcel = function () {
    if (!allLlmoData.length) return alert("データがありません");
    try {
      const wb = XLSX.utils.book_new();
      const header = ["URL", "文脈ランク", "AI引用率", "引用スコア", "構造化スコア", "明瞭性スコア", "グラフスコア", "実装済みタグ", "不足タグ", "改善アクション"];
      const rows = allLlmoData.map((p) => [
        p.url,
        p.contextRank,
        p.citability + "%",
        p.individualScores?.citation ?? "",
        p.individualScores?.schema ?? "",
        p.individualScores?.clarity ?? "",
        p.individualScores?.graph ?? "",
        (p.schema || []).join(", "),
        (p.missingSchema || []).join(", "),
        (p.actions || []).map((a) => a.title).join("; "),
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
})();
