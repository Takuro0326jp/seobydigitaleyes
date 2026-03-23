/**
 * gsc-indexhealth.js - Index Health（GSC + スキャンデータ統合）
 * seoscan: scan パラメータ、/api/scans/result/:id、/api/gsc/performance
 */
(function () {
  "use strict";

  let fullIndexData = [];
  let currentViewTab = "error_warning";

  const INDEX_ERROR_MASTER = {
    "404": {
      label: "404 Error",
      title: "見つかりませんでした (404)",
      desc: "ページが存在しないのにリンクが残っています。クローラーが行き止まりに遭遇し評価を下げています。",
      action: "リンク元を修正するか、適切なページへ301リダイレクトを設定してください。",
    },
    noindex: {
      label: "noindex",
      title: "noindex タグにより除外",
      desc: "HTML指示で検索除外されています。意図的でない場合、重要なページが隠れています。",
      action: "meta robotsタグの設定を確認・削除してください。",
    },
    redirect: {
      label: "Redirect",
      title: "ページにリダイレクトがあります",
      desc: "URLが転送されています。Googleは最終的なURLのみを評価します。",
      action: "内部リンクを転送後の最新URLに直接書き換えてください。",
    },
    canonical: {
      label: "Duplicate",
      title: "代替ページ（正規 URL あり）",
      desc: "別のURLが正規であるとGoogleが判断しています。評価は集約されています。",
      action: "意図的な重複でない場合は、canonicalタグを見直してください。",
    },
    unindexed: {
      label: "Quality Issue",
      title: "品質・優先度による未登録",
      desc: "Googleはコンテンツの内容を確認しましたが、『検索結果に表示する価値が低い』と判断して登録を見送っています。",
      action: "コンテンツの独自性を高め、主要ページから内部リンクを設置してください。",
    },
  };

  function analyzeUrlContext(url, baseInfo) {
    let dynamicDesc = baseInfo.desc || "解析中...";
    let dynamicAction = baseInfo.action || "対策を検討中...";
    let isDuplicateSuspicion = false;

    if (url.includes("?") || url.includes("&")) {
      isDuplicateSuspicion = true;
      dynamicDesc =
        "【重複の疑い】URLパラメータにより同一内容のページが複数生成されています。Googleはこれを重複と見なしています。";
      dynamicAction =
        "Canonicalタグで正規URLを一本化するか、不要なパラメータをSearch Consoleで整理してください。";
    } else if (url.match(/[A-Z]/) || (url.length > 1 && !url.endsWith("/"))) {
      isDuplicateSuspicion = true;
      dynamicDesc =
        "【正規化不備】URLの末尾スラッシュや大文字小文字の違いにより、重複URLとして認識されています。";
      dynamicAction = "サーバー設定で301リダイレクトを行い、正規のURL形式へ統一してください。";
    }

    return { desc: dynamicDesc, action: dynamicAction, isDuplicate: isDuplicateSuspicion };
  }

  const params = new URLSearchParams(window.location.search);
  const scanId = params.get("scan") || params.get("scanId");
  if (!scanId) {
    window.location.replace("/seo.html");
    return;
  }

  window.showTabComingSoon = function (tabName) {
    alert(`${tabName} タブは準備中です。`);
  };

  function normalize(u) {
    return (u || "").replace(/\/$/, "").toLowerCase();
  }

  async function loadData() {
    const mappings = JSON.parse(localStorage.getItem("gsc_mappings") || "{}");
    const propertyUrl = mappings[scanId];
    if (!propertyUrl) {
      showEmptyState();
      return;
    }

    let scanData = { pages: [] };
    try {
      const scanRes = await fetch(`/api/scans/result/${encodeURIComponent(scanId)}`, {
        credentials: "include",
      });
      if (scanRes.ok) {
        scanData = await scanRes.json();
      }
    } catch (e) {
      console.warn("scan fetch failed", e);
    }

    const localData = scanData.pages || [];

    try {
      const gscRes = await fetch("/api/gsc/performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ propertyUrl, scanId }),
      });

      if (!gscRes.ok) {
        const err = await gscRes.json().catch(() => ({}));
        showEmptyState(err.error || "GSC データの取得に失敗しました。");
        return;
      }

      const gscRows = await gscRes.json();
      if (!Array.isArray(gscRows) || gscRows.length === 0) {
        showEmptyState("GSC にデータがありません。");
        return;
      }

      fullIndexData = gscRows.map((row) => {
        const url = row.keys && row.keys[0] ? row.keys[0] : "";
        const normUrl = normalize(url);
        const localMatch = localData.find((ld) => normalize(ld.url) === normUrl);

        const status = localMatch ? (localMatch.status || 200) : 200;
        const isDuplicate = localMatch
          ? (localMatch.issues || []).some((i) => i.code === "dup_title")
          : false;
        const isNoindex = localMatch ? localMatch.index_status === "noindex" : false;

        let reasonKey = "ok";
        if (status === 404) reasonKey = "404";
        else if (status === 301 || status === 302) reasonKey = "redirect";
        else if (isDuplicate) reasonKey = "canonical";
        else if (isNoindex) reasonKey = "noindex";
        else if (status >= 400 && status < 500) reasonKey = "noindex";
        else if (!localMatch) reasonKey = "unindexed";

        return {
          url,
          status,
          isDuplicate,
          isScanned: !!localMatch,
          reasonKey,
        };
      });

      renderStats();
      switchTableTab("error_warning");
      filterIndexTable();
      updateAiReview();
    } catch (e) {
      console.error(e);
      showEmptyState("データの取得に失敗しました。");
    }
  }

  function showEmptyState(msg) {
    fullIndexData = [];
    const body = document.getElementById("indexHealthTableBody");
    if (body) {
      body.innerHTML = `<tr><td colspan="3" class="p-16 text-center text-slate-400 font-bold">${msg || "GSC が連携されていません。seo.html の設定からプロパティを選択してください。"}</td></tr>`;
    }
    ["indexHealthScore", "warningCount", "unindexedCount", "errorCount"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = "--";
    });
    const gscCount = document.getElementById("gscCountDisplay");
    if (gscCount) gscCount.textContent = "0 URLs";
    ["card-count-404", "card-count-noindex", "card-count-redirect", "card-count-unindexed"].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = "対象: 0 ページ";
      }
    );
    const review = document.getElementById("aiTrafficReview");
    if (review) review.textContent = msg || "GSC 連携後、データを取得してください。";
  }

  function updateAiReview() {
    const stats = {
      dup: fullIndexData.filter((p) => p.reasonKey === "canonical").length,
      err: fullIndexData.filter((p) => p.reasonKey === "404").length,
      uni: fullIndexData.filter((p) => p.reasonKey === "unindexed").length,
      red: fullIndexData.filter((p) => p.reasonKey === "redirect").length,
      noi: fullIndexData.filter((p) => p.reasonKey === "noindex").length,
    };
    const total = stats.dup + stats.err + stats.uni + stats.red + stats.noi;
    const review = document.getElementById("aiTrafficReview");
    if (review) {
      if (total === 0) {
        review.textContent = "インデックス上の重大な問題は検出されていません。";
      } else {
        const parts = [];
        if (stats.err > 0) parts.push(`${stats.err}件の404エラー`);
        if (stats.dup > 0) parts.push(`${stats.dup}件の重複`);
        if (stats.noi > 0) parts.push(`${stats.noi}件のnoindex`);
        if (stats.red > 0) parts.push(`${stats.red}件のリダイレクト`);
        if (stats.uni > 0) parts.push(`${stats.uni}件の未登録`);
        review.textContent = `合計${total}件の課題を検出しました。${parts.join("、")}を優先的に対応してください。`;
      }
    }
  }

  const FILTER_TABS = ["error_warning", "all", "404", "canonical", "noindex"];

  window.switchTableTab = function (tab) {
    currentViewTab = tab;
    FILTER_TABS.forEach((t) => {
      const btn = document.getElementById("tab-" + t);
      if (btn) {
        btn.className = t === tab
          ? "px-3 py-1.5 rounded-lg text-[9px] font-black transition-all bg-white text-indigo-600 shadow-sm"
          : "px-3 py-1.5 rounded-lg text-[9px] font-black transition-all text-slate-400 hover:text-slate-600";
      }
    });
    filterIndexTable();
  };

  window.filterIndexTable = function () {
    const query = (document.getElementById("gscSearchInput")?.value || "").toLowerCase();
    const filtered = fullIndexData.filter((p) => {
      const matchQuery = p.url.toLowerCase().includes(query);
      let matchTab = true;
      if (currentViewTab === "error_warning") {
        matchTab = ["404", "noindex", "canonical", "redirect"].includes(p.reasonKey);
      } else if (currentViewTab === "all") {
        matchTab = true;
      } else if (currentViewTab === "404") {
        matchTab = p.reasonKey === "404";
      } else if (currentViewTab === "canonical") {
        const analysis = analyzeUrlContext(p.url, {});
        matchTab = p.reasonKey === "canonical" || analysis.isDuplicate === true;
      } else if (currentViewTab === "noindex") {
        matchTab = p.reasonKey === "noindex";
      }
      return matchQuery && matchTab;
    });
    renderIndexHealthTable(filtered);
  };

  function renderIndexHealthTable(data) {
    const body = document.getElementById("indexHealthTableBody");
    if (!body) return;

    if (data.length === 0) {
      body.innerHTML = `<tr><td colspan="3" class="p-12 text-center text-slate-400 font-bold">該当するURLがありません</td></tr>`;
      return;
    }

    body.innerHTML = data
      .map((p) => {
        const originalIndex = fullIndexData.findIndex((item) => item.url === p.url);
        const info = INDEX_ERROR_MASTER[p.reasonKey] || { label: "Indexed" };
        let badgeColor =
          p.reasonKey === "404"
            ? "text-red-500 bg-red-50"
            : p.reasonKey === "unindexed"
              ? "text-indigo-600 bg-indigo-50"
              : "text-orange-500 bg-orange-50";

        return `<tr onclick="window.showIndexDetail(${originalIndex})" class="hover:bg-indigo-50/50 border-b border-slate-50 cursor-pointer transition-all group">
            <td class="p-6 break-all font-mono group-hover:text-indigo-600">${escapeHtml(p.url)}</td>
            <td class="p-6"><span class="px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest ${badgeColor}">${escapeHtml(info.label)}</span></td>
            <td class="p-6 text-center"><span class="px-2 py-1 rounded-md bg-slate-100 text-slate-500 text-[10px] font-mono">${p.status}</span></td>
        </tr>`;
      })
      .join("");
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderStats() {
    const stats = {
      err: fullIndexData.filter((p) => ["404", "noindex"].includes(p.reasonKey)).length,
      warn: fullIndexData.filter((p) => p.reasonKey === "canonical" || p.reasonKey === "redirect").length,
      ok: fullIndexData.filter((p) => p.reasonKey === "ok").length,
      excluded: fullIndexData.filter((p) => p.reasonKey === "unindexed").length,
      dup: fullIndexData.filter((p) => p.reasonKey === "canonical").length,
      noi: fullIndexData.filter((p) => p.reasonKey === "noindex").length,
      red: fullIndexData.filter((p) => p.status === 301 || p.status === 302).length,
    };

    const errEl = document.getElementById("errorCount");
    if (errEl) errEl.textContent = stats.err;

    const warnEl = document.getElementById("warningCount");
    if (warnEl) warnEl.textContent = stats.warn;

    const scoreEl = document.getElementById("indexHealthScore");
    if (scoreEl) scoreEl.textContent = stats.ok;

    const uniEl = document.getElementById("unindexedCount");
    if (uniEl) uniEl.textContent = stats.excluded;

    const gscEl = document.getElementById("gscCountDisplay");
    if (gscEl) gscEl.textContent = `${fullIndexData.length} URLs`;

    const card404 = document.getElementById("card-count-404");
    if (card404) card404.textContent = `対象: ${stats.err} ページ`;
    const cardNoi = document.getElementById("card-count-noindex");
    if (cardNoi) cardNoi.textContent = `対象: ${stats.noi} ページ`;
    const cardRed = document.getElementById("card-count-redirect");
    if (cardRed) cardRed.textContent = `対象: ${stats.red} ページ`;
    const cardUni = document.getElementById("card-count-unindexed");
    if (cardUni) cardUni.textContent = `対象: ${stats.excluded} ページ`;
  }

  window.showIndexDetail = function (index) {
    const item = fullIndexData[index];
    const panel = document.getElementById("panelContent");
    const placeholder = document.getElementById("panelPlaceholder");
    if (!item || !panel) return;

    placeholder?.classList.add("hidden");
    panel.classList.remove("hidden");

    const nameEl = document.getElementById("detailQueryName");
    if (nameEl) nameEl.textContent = item.url;

    const baseInfo = INDEX_ERROR_MASTER[item.reasonKey] || { label: "Unknown", desc: "-", action: "-" };
    const displayInfo =
      item.reasonKey === "unindexed" || item.reasonKey === "ok"
        ? analyzeUrlContext(item.url, baseInfo)
        : baseInfo;

    const analysisEl = document.getElementById("analysisText");
    if (analysisEl) {
      analysisEl.innerHTML = `<p class="font-black text-indigo-600 mb-2">${escapeHtml(baseInfo.title || baseInfo.label)}</p><p>${escapeHtml(displayInfo.desc)}</p>`;
    }

    const actionEl = document.getElementById("actionList");
    if (actionEl) {
      actionEl.innerHTML = `<div class="p-5 bg-indigo-600 rounded-[24px] shadow-lg shadow-indigo-100"><p class="text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-1">💡 Action Required</p><p class="text-[13px] text-white font-bold leading-relaxed">${escapeHtml(displayInfo.action)}</p></div>`;
    }
  };

  window.downloadGSCExcel = function () {
    try {
      let exportData = [];
      let fileName = "";
      if (currentViewTab === "duplicate") {
        exportData = fullIndexData
          .filter((p) => {
            const analysis = analyzeUrlContext(p.url, {});
            return p.reasonKey === "canonical" || analysis.isDuplicate;
          })
          .map((item) => {
            const analysis = analyzeUrlContext(
              item.url,
              INDEX_ERROR_MASTER[item.reasonKey] || {}
            );
            return {
              重複URL: item.url,
              ステータス: item.status,
              詳細分析: analysis.desc,
              推奨アクション: analysis.action,
            };
          });
        fileName = "SEO_Duplicate_Report.xlsx";
      } else {
        exportData = fullIndexData
          .filter((p) => p.reasonKey !== "ok")
          .map((item) => {
            const info = INDEX_ERROR_MASTER[item.reasonKey] || {};
            const analysis = analyzeUrlContext(item.url, info);
            return {
              対象URL: item.url,
              ステータス: item.status,
              理由: info.label,
              詳細分析: analysis.desc,
            };
          });
        fileName = "Index_Health_Report.xlsx";
      }
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Report");
      XLSX.writeFile(wb, fileName);
    } catch (e) {
      alert("出力失敗");
    }
  };

  window.addEventListener("DOMContentLoaded", () => {
    const suffix = "?scan=" + encodeURIComponent(scanId);
    const taskLink = document.getElementById("nav-task");
    if (taskLink) taskLink.setAttribute("href", "gsc-task.html" + suffix);
    const perfLink = document.querySelector('a[href="gsc.html"]');
    if (perfLink) perfLink.setAttribute("href", "gsc.html" + suffix);
    const indexLink = document.querySelector('a[href="gsc-indexhealth.html"]');
    if (indexLink) indexLink.setAttribute("href", "gsc-indexhealth.html" + suffix);
    const techLink = document.getElementById("nav-technical");
    if (techLink) techLink.setAttribute("href", "gsc-technical.html" + suffix);
    const oppLink = document.getElementById("nav-opportunities");
    if (oppLink) oppLink.setAttribute("href", "gsc-opportunities.html" + suffix);
    void loadData();
  });
})();
