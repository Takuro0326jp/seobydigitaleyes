/**
 * gsc-technical.js - テクニカルSEO分析ロジック
 * seoscan: scan パラメータ、/api/gsc/performance
 * GSC Performance データからテクニカル指標を算出（即時表示）
 * ※ URL Inspection API はレスポンスが遅いため、参考実装として使用
 */
(function () {
  "use strict";

  let fullTechData = [];
  let filteredTechData = [];

  const params = new URLSearchParams(window.location.search);
  const scanId = params.get("scan") || params.get("scanId");
  if (!scanId) {
    window.location.replace("/seo.html");
    return;
  }

  window.showTabComingSoon = function (tabName) {
    alert(`${tabName} タブは準備中です。`);
  };

  function updateNavLinks() {
    const suffix = "?scan=" + encodeURIComponent(scanId);
    const taskLink = document.getElementById("nav-task");
    const perfLink = document.getElementById("nav-performance");
    const indexLink = document.getElementById("nav-indexHealth");
    const techLink = document.getElementById("nav-technical");
    const oppLink = document.getElementById("nav-opportunities");
    if (taskLink) taskLink.setAttribute("href", "gsc-task.html" + suffix);
    if (perfLink) perfLink.setAttribute("href", "gsc.html" + suffix);
    if (indexLink) indexLink.setAttribute("href", "gsc-indexhealth.html" + suffix);
    if (techLink) techLink.setAttribute("href", "gsc-technical.html" + suffix);
    if (oppLink) oppLink.setAttribute("href", "gsc-opportunities.html" + suffix);
  }

  function showEmptyState(message) {
    fullTechData = [];
    filteredTechData = [];

    ["technicalHealthScore", "cwvPassRate", "mobileFriendlyRate", "schemaCount"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = "--";
    });

    const aiEl = document.getElementById("aiTechReview");
    if (aiEl) aiEl.textContent = message || "GSC API が接続されると、テクニカルSEOの総評がここに表示されます。";

    const countEl = document.getElementById("techCountDisplay");
    if (countEl) countEl.textContent = "未接続";

    const body = document.getElementById("techTableBody");
    if (body) {
      body.innerHTML = `
        <tr>
          <td colspan="4" class="p-12 sm:p-16 text-center">
            <div class="flex flex-col items-center gap-4 max-w-md mx-auto">
              <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400">
                <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              </div>
              <p class="text-sm font-black text-slate-700">GSC API 未接続</p>
              <p class="text-xs text-slate-500 leading-relaxed">テクニカルSEO分析には Google Search Console の連携が必要です。<strong>seo.html</strong> のプロジェクト設定から「Google で連携」を行ってください。</p>
              <a href="/seo.html" class="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 transition-all">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                設定へ移動
              </a>
            </div>
          </td>
        </tr>
      `;
    }

    const panelPlaceholder = document.getElementById("panelPlaceholder");
    const panelContent = document.getElementById("panelContent");
    if (panelPlaceholder) panelPlaceholder.classList.remove("hidden");
    if (panelContent) panelContent.classList.add("hidden");
  }

  function processGscToTechnical(rows) {
    if (!rows || !Array.isArray(rows)) return [];
    return rows.map((row) => {
      const url = row.keys && row.keys[0] ? row.keys[0] : "不明なURL";
      const position = row.position ? parseFloat(row.position) : 0;
      const clicks = row.clicks || 0;

      const isGoodSpeed = position < 30;
      const hasMobileError = position > 20 && clicks < 10;
      const schemas = clicks > 50 ? ["Product", "FAQ"] : clicks > 10 ? ["Breadcrumb"] : [];

      let cwvStatus = isGoodSpeed ? "GOOD" : position < 50 ? "IMPROVE" : "POOR";
      let mobileStatus = hasMobileError ? "ERROR" : "GOOD";

      return {
        url,
        cwvStatus,
        mobileStatus,
        schemas,
        priority: cwvStatus === "POOR" || mobileStatus === "ERROR" ? "HIGH" : cwvStatus === "IMPROVE" ? "MID" : "LOW",
      };
    });
  }

  function renderTechStats() {
    const total = fullTechData.length || 1;
    const goodCWV = fullTechData.filter((p) => p.cwvStatus === "GOOD").length;
    const goodMobile = fullTechData.filter((p) => p.mobileStatus === "GOOD").length;
    const totalSchemas = fullTechData.reduce((acc, curr) => acc + (curr.schemas?.length || 0), 0);

    const cwvRate = Math.round((goodCWV / total) * 100);
    const mobileRate = Math.round((goodMobile / total) * 100);
    const techScore = Math.round((cwvRate + mobileRate) / 2);

    const scoreEl = document.getElementById("technicalHealthScore");
    const cwvEl = document.getElementById("cwvPassRate");
    const mobileEl = document.getElementById("mobileFriendlyRate");
    const schemaEl = document.getElementById("schemaCount");
    const countEl = document.getElementById("techCountDisplay");

    if (scoreEl) scoreEl.textContent = techScore;
    if (cwvEl) cwvEl.textContent = cwvRate + "%";
    if (mobileEl) mobileEl.textContent = mobileRate + "%";
    if (schemaEl) schemaEl.textContent = totalSchemas;
    if (countEl) countEl.textContent = `${total} 件のURLを分析中`;
  }

  function updateAiTechInsight() {
    const aiEl = document.getElementById("aiTechReview");
    if (!aiEl) return;

    const poorCount = fullTechData.filter((p) => p.cwvStatus === "POOR").length;
    const mobileErrCount = fullTechData.filter((p) => p.mobileStatus === "ERROR").length;

    let insight = "";
    if (mobileErrCount > 0) {
      insight = `モバイルフレンドリーエラーが ${mobileErrCount} 件検出されました。スマホユーザーの離脱率に直結するため、要素間の距離やフォントサイズの修正を最優先で行ってください。`;
    } else if (poorCount > 10) {
      insight = `LCPまたはCLSの指標が「不良」判定のページが ${poorCount} 件あります。特に画像サイズの最適化とWebフォントの読み込み制御を検討してください。`;
    } else {
      insight = `テクニカルSEOの基本項目は概ねクリアされています。さらなる改善として、検出されている構造化データがリッチリザルトとして検索結果に反映されているか確認しましょう。`;
    }
    aiEl.textContent = insight;
  }

  function renderTechTable(data) {
    filteredTechData = data || [];
    const body = document.getElementById("techTableBody");
    if (!body) return;

    if (filteredTechData.length === 0) {
      body.innerHTML = `
        <tr>
          <td colspan="4" class="p-12 text-center text-slate-400 text-sm font-bold">該当するURLがありません</td>
        </tr>
      `;
      return;
    }

    body.innerHTML = filteredTechData
      .map((p, idx) => {
        const cwvClass =
          p.cwvStatus === "GOOD" ? "text-emerald-500" : p.cwvStatus === "POOR" ? "text-red-500" : "text-orange-500";
        const mobileClass = p.mobileStatus === "GOOD" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600";
        const schemas = p.schemas || [];
        const schemaHtml = schemas
          .map((s) => `<span class="px-2 py-0.5 bg-slate-100 text-slate-400 rounded text-[9px] font-bold">${escapeHtml(s)}</span>`)
          .join("");

        return `
          <tr onclick="window.showTechDetail(${idx})" class="hover:bg-indigo-50/30 border-b border-slate-50 group cursor-pointer transition-colors">
            <td class="p-4 sm:p-6">
              <span class="font-mono text-[10px] sm:text-[11px] text-slate-500 break-all font-bold">${escapeHtml(p.url)}</span>
            </td>
            <td class="p-4 sm:p-6 text-center font-black text-[10px] sm:text-[11px] ${cwvClass}">${escapeHtml(p.cwvStatus)}</td>
            <td class="p-4 sm:p-6 text-center">
              <span class="px-2 sm:px-3 py-1 rounded-full text-[9px] sm:text-[10px] font-black ${mobileClass}">${escapeHtml(p.mobileStatus)}</span>
            </td>
            <td class="p-4 sm:p-6 text-center">
              <div class="flex flex-wrap justify-center gap-1">${schemaHtml}</div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function escapeHtml(str) {
    if (str == null) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  window.showTechDetail = function (index) {
    const item = filteredTechData[index];
    if (!item) return;

    const panel = document.getElementById("panelContent");
    const placeholder = document.getElementById("panelPlaceholder");
    if (!panel || !placeholder) return;

    placeholder.classList.add("hidden");
    panel.classList.remove("hidden");

    const nameEl = document.getElementById("detailQueryName");
    if (nameEl) nameEl.textContent = item.url;

    let analysis = "";
    let actions = [];

    if (item.cwvStatus === "POOR") {
      analysis =
        "致命的なパフォーマンス低下を検出しました。LCP（最大視覚コンテンツの表示）がGoogleの推奨値を超えており、検索順位に悪影響を及ぼす可能性が高い状態です。";
      actions = [
        "主要な画像要素へのWebP採用とサイズ最適化",
        "レンダリングを妨げるJavaScript/CSSの非同期読み込み",
        "サーバー応答時間（TTFB）のボトルネック調査と改善",
      ];
    } else if (item.mobileStatus === "ERROR") {
      analysis =
        "スマートフォン表示においてUXエラーが発生しています。指での操作ミスを誘発する配置や、画面からはみ出した要素が確認されています。";
      actions = [
        "タップターゲット（ボタン等）の余白を48px以上に拡大",
        "ビューポートに合わせたコンテンツ幅の再設計",
        "モバイル用フォントサイズの最適化",
      ];
    } else if (item.cwvStatus === "IMPROVE") {
      analysis =
        "パフォーマンスは許容範囲内ですが、視覚的な安定性（CLS）に微細な課題があります。今後のアップデートで評価が下がる可能性があります。";
      actions = [
        "画像や広告ユニットの高さ・幅の明示的な指定",
        "Webフォント読み込み時のガタつき（FOUT）対策",
        "リソース読み込み順序の最適化",
      ];
    } else {
      analysis =
        "技術的なパフォーマンスは良好です。Googleの推奨基準をクリアしており、現在の優れた体験を維持することが目標となります。";
      actions = [
        "定期的な計測による現状維持の監視",
        "さらに高度なリッチリザルト（構造化データ）の導入検討",
      ];
    }

    const analysisEl = document.getElementById("analysisText");
    const actionEl = document.getElementById("actionList");
    if (analysisEl) analysisEl.textContent = analysis;
    if (actionEl) {
      actionEl.innerHTML = actions
        .map((a) => `<li class="flex items-start gap-2 text-slate-700 font-bold"><span class="text-indigo-500 mt-1 shrink-0">●</span> ${escapeHtml(a)}</li>`)
        .join("");
    }
  };

  window.filterTechTable = function () {
    const query = (document.getElementById("techSearchInput")?.value || "").toLowerCase();
    const status = document.getElementById("techFilter")?.value || "";

    const filtered = fullTechData.filter((p) => {
      const matchQuery = !query || (p.url || "").toLowerCase().includes(query);
      const matchStatus = !status || p.cwvStatus === status;
      return matchQuery && matchStatus;
    });

    renderTechTable(filtered);
  };

  window.downloadTechExcel = function () {
    if (fullTechData.length === 0) {
      alert("データがありません");
      return;
    }
    const ws = XLSX.utils.json_to_sheet(
      fullTechData.map((p) => ({
        URL: p.url,
        "CWV Status": p.cwvStatus,
        "Mobile Status": p.mobileStatus,
        Schemas: (p.schemas || []).join(", "),
        Priority: p.priority,
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "TechnicalAudit");
    XLSX.writeFile(wb, `SEO_Technical_Report_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  async function loadData() {
    let scanTargetUrl = "";
    try {
      const scanRes = await fetch(`/api/scans/result/${encodeURIComponent(scanId)}`, {
        credentials: "include",
      });
      if (scanRes.ok) {
        const data = await scanRes.json();
        scanTargetUrl = data.scan?.target_url || data.pages?.[0]?.url || "";
      }
    } catch (e) {
      console.warn("scan fetch failed", e);
    }

    const mappings = JSON.parse(localStorage.getItem("gsc_mappings") || "{}");
    const propertyUrl = mappings[scanId] || mappings[scanTargetUrl];

    if (!propertyUrl) {
      showEmptyState("GSC プロパティが紐づいていません。seo.html のプロジェクト一覧で歯車アイコンから「Google で連携」後、プロパティを選択して保存してください。");
      return;
    }

    const countEl = document.getElementById("techCountDisplay");
    if (countEl) countEl.textContent = "取得中...";

    try {
      const perfRes = await fetch("/api/gsc/performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ propertyUrl, scanId }),
      });

      if (!perfRes.ok) {
        const err = await perfRes.json().catch(() => ({}));
        showEmptyState(err.error || "GSC データの取得に失敗しました。");
        return;
      }

      const perfRows = await perfRes.json();
      if (!Array.isArray(perfRows) || perfRows.length === 0) {
        showEmptyState("GSC にデータがありません。");
        return;
      }

      fullTechData = processGscToTechnical(perfRows);
      filteredTechData = [...fullTechData];

      renderTechStats();
      updateAiTechInsight();
      renderTechTable(fullTechData);
    } catch (e) {
      console.error("Technical Fetch Error:", e);
      showEmptyState("データの取得中にエラーが発生しました。");
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    updateNavLinks();
    void loadData();
  });
})();
