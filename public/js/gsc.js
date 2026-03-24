/**
 * gsc.js - Search Console（GSC API 連携前提）
 * GSC API 接続時のみデータ表示。未接続時は seo.html の設定モーダルからアカウントリンクを案内
 */
(function () {
  "use strict";

  let rawGscData = [];
  let gscConnected = false;
  let performanceChart = null;
  let gscPropertyUrlForChart = null;
  let lastFetchedAt = null; // キャッシュ取得日時

  const params = new URLSearchParams(window.location.search);
  const scanId = params.get("scan") || params.get("scanId");
  if (!scanId) {
    window.location.replace("/seo.html");
    return;
  }

  /* ==========================================
   * 1. 接続状態チェック & 空状態表示
   * ========================================== */
  function showEmptyState() {
    gscConnected = false;
    rawGscData = [];

    const body = document.getElementById("gscTableBody");
    if (body) {
      body.innerHTML = `
        <tr>
          <td colspan="7" class="p-16 text-center">
            <div class="flex flex-col items-center gap-4 max-w-md mx-auto">
              <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400">
                <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
              </div>
              <p class="text-sm font-black text-slate-700">GSC API 未接続</p>
              <p class="text-xs text-slate-500 leading-relaxed">Google Search Console のデータを表示するには、<strong>seo.html</strong> のプロジェクト一覧で対象サイトの歯車アイコンをクリックし、「Google で連携」からログイン後、プロパティを選択して保存してください。</p>
              <a href="/seo.html" class="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 transition-all">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                設定へ移動
              </a>
            </div>
          </td>
        </tr>
      `;
    }

    ["totalClicks", "totalImpressions", "avgCtr", "avgPosition"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = "--";
    });
    ["clicksDelta", "impressionsDelta", "ctrDelta", "positionDelta"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = id === "ctrDelta" ? "※ 全取得URLの平均" : "GSC 接続時に表示";
    });

    const reviewEl = document.getElementById("aiTrafficReview");
    if (reviewEl) reviewEl.textContent = "GSC API が接続されると、検索パフォーマンスの総評がここに表示されます。";

    const countEl = document.getElementById("gscCountDisplay");
    if (countEl) countEl.textContent = "-- 件";

    const elFirst = document.getElementById("first-fetch-date");
    const elLast = document.getElementById("last-update-date");
    if (elFirst) elFirst.innerText = "-";
    if (elLast) elLast.innerText = "-";

    setDataSectionEnabled(false);
  }

  function setDataSectionEnabled(enabled) {
    const refreshBtn = document.getElementById("refresh-btn");
    const priorityFilter = document.getElementById("priorityFilter");
    const gscSearchInput = document.getElementById("gscSearchInput");
    if (refreshBtn) refreshBtn.disabled = !enabled;
    if (priorityFilter) priorityFilter.disabled = !enabled;
    if (gscSearchInput) gscSearchInput.disabled = !enabled;
  }

  function setHeaderTargetDomain(targetUrl) {
    const el = document.getElementById("header-target-domain");
    if (!el || !targetUrl) return;
    try {
      const domain = new URL(targetUrl).hostname;
      el.innerHTML = `<span class="text-slate-400">Target</span><span class="ml-1 text-slate-800">${domain}</span>`;
    } catch (e) {}
  }

  /* ==========================================
   * 2. GSC API 連携（将来実装用）
   * ========================================== */
  function processGscData(apiRows) {
    if (!apiRows || !Array.isArray(apiRows)) return [];

    return apiRows.map((row, index) => {
      const url = row.keys && row.keys[0] ? row.keys[0] : "不明なURL";
      const clicks = row.clicks || 0;
      const impressions = row.impressions || 0;
      const ctrNum = row.ctr || 0;
      const position = row.position ? parseFloat(row.position) : 0;

      let priority = "LOW";
      let pClass = "bg-slate-100 text-slate-400 border-slate-200";
      if (position > 10 && impressions > 1000) {
        priority = "HIGH";
        pClass = "bg-red-50 text-red-600 border-red-100";
      } else if (position <= 5 && ctrNum < 0.03) {
        priority = "MID";
        pClass = "bg-orange-50 text-orange-600 border-orange-100";
      }

      return {
        id: index + 1,
        url,
        clicks,
        impressions,
        ctr: (ctrNum * 100).toFixed(1) + "%",
        ctrNum,
        position: position.toFixed(1),
        priority,
        priorityClass: pClass,
      };
    });
  }

  function formatDelta(current, previous, isPosition = false) {
    if (previous == null || previous === 0) return `先月 --`;
    if (isPosition) {
      const arrow = current > previous ? "▼" : "▲";
      const label = current > previous ? "（悪化）" : "（改善）";
      return `${arrow} 先月 ${previous.toFixed(1)}${label}`;
    }
    const pct = Math.round(((current - previous) / previous) * 100);
    const arrow = pct >= 0 ? "▲" : "▼";
    return `${arrow} ${Math.abs(pct)}%　先月 ${previous.toLocaleString("ja-JP")}`;
  }

  function updateSummaryCards(rows) {
    if (!rows || rows.length === 0) return;

    let totalClicks = 0, totalImpressions = 0, sumCtr = 0, sumPosition = 0;
    rows.forEach((row) => {
      totalClicks += row.clicks || 0;
      totalImpressions += row.impressions || 0;
      sumCtr += row.ctrNum || 0;
      sumPosition += parseFloat(row.position) || 0;
    });

    const avgCtr = (sumCtr / rows.length) * 100;
    const avgPos = sumPosition / rows.length;
    const prev = window.gscPreviousPeriod || null;

    const elClicks = document.getElementById("totalClicks");
    const elImps = document.getElementById("totalImpressions");
    const elCtr = document.getElementById("avgCtr");
    const elPos = document.getElementById("avgPosition");
    const elClicksD = document.getElementById("clicksDelta");
    const elImpsD = document.getElementById("impressionsDelta");
    const elCtrD = document.getElementById("ctrDelta");
    const elPosD = document.getElementById("positionDelta");

    if (elClicks) elClicks.textContent = totalClicks.toLocaleString("ja-JP");
    if (elImps) elImps.textContent = totalImpressions.toLocaleString("ja-JP");
    if (elCtr) elCtr.textContent = avgCtr.toFixed(1) + "%";
    if (elPos) elPos.textContent = avgPos.toFixed(1);

    if (elClicksD) elClicksD.textContent = prev ? formatDelta(totalClicks, prev.clicks) : "先月 --";
    if (elImpsD) elImpsD.textContent = prev ? formatDelta(totalImpressions, prev.impressions) : "先月 --";
    if (elCtrD) elCtrD.textContent = prev ? `先月 ${(prev.ctr * 100).toFixed(1)}%` : "※ 全取得URLの平均";
    if (elPosD) elPosD.textContent = prev ? formatDelta(avgPos, prev.position, true) : "※ スコアから算出";
  }

  function renderGSCTable(data) {
    const body = document.getElementById("gscTableBody");
    if (!body) return;

    const countEl = document.getElementById("gscCountDisplay");
    if (countEl) countEl.textContent = `${data.length} 件`;

    if (data.length === 0) {
      body.innerHTML = `<tr><td colspan="7" class="p-20 text-center text-slate-400 font-bold">表示できるURLデータがありません</td></tr>`;
      return;
    }

    body.innerHTML = data
      .map(
        (item) => `
        <tr onclick="window.selectQuery(${item.id})" class="hover:bg-slate-50 transition-all group cursor-pointer border-b border-slate-50">
            <td class="p-4 text-center text-[10px] text-slate-300 font-bold">${item.id}</td>
            <td class="p-4">
                <div class="flex flex-col gap-1.5">
                    <span class="font-mono text-[11px] text-blue-600 break-all leading-tight group-hover:text-indigo-600 transition-colors">${item.url}</span>
                    <span class="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Status: GSC</span>
                </div>
            </td>
            <td class="p-4 text-center font-mono text-xs">${item.clicks.toLocaleString()}</td>
            <td class="p-4 text-center font-mono text-xs text-slate-400">${item.impressions.toLocaleString()}</td>
            <td class="p-4 text-center font-bold text-slate-700">${item.ctr}</td>
            <td class="p-4 text-center font-black text-slate-900">${item.position}</td>
            <td class="p-4 text-center">
                <span class="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${item.priorityClass}">${item.priority}</span>
            </td>
        </tr>
    `
      )
      .join("");
  }

  function updateOverallAiInsight() {
    const highCount = rawGscData.filter((d) => d.priority === "HIGH").length;
    const reviewEl = document.getElementById("aiTrafficReview");
    if (reviewEl)
      reviewEl.textContent = `取得した ${rawGscData.length} 件中 ${highCount} 件が「HIGH（最優先）」判定です。内部構造を確認し、優先的に改善を行ってください。`;
  }

  function updateDateDisplay() {
    const now = new Date();
    const s = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const elFirst = document.getElementById("first-fetch-date");
    const elLast = document.getElementById("last-update-date");
    if (elFirst) elFirst.innerText = s;
    if (elLast) elLast.innerText = s;
  }

  async function fetchAndRenderChart(propertyUrl, days) {
    const section = document.getElementById("performanceChartSection");
    const canvas = document.getElementById("performanceChart");
    if (!section || !canvas) return;
    try {
      const res = await fetch("/api/gsc/performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ propertyUrl, scanId, dimensions: ["date"] }),
      });
      if (!res.ok) return;
      let rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) return;
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - (days || 30));
      const startStr = startDate.toISOString().slice(0, 10);
      const endStr = endDate.toISOString().slice(0, 10);
      rows = rows.filter((r) => {
        const d = r.keys?.[0] || "";
        return d >= startStr && d <= endStr;
      });
      rows.sort((a, b) => new Date(a.keys[0]) - new Date(b.keys[0]));
      if (rows.length === 0) return;
      section.classList.remove("hidden");
      if (performanceChart) performanceChart.destroy();
      const ctx = canvas.getContext("2d");
      const labels = rows.map((r) => (r.keys?.[0] || "").split("-").slice(1).join("/"));
      performanceChart = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [
            { label: "Clicks", data: rows.map((r) => r.clicks || 0), borderColor: "#4f46e5", backgroundColor: "rgba(79,70,229,0.05)", fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0, yAxisID: "y" },
            { label: "Impressions", data: rows.map((r) => r.impressions || 0), borderColor: "#94a3b8", borderDash: [5, 5], fill: false, tension: 0.4, borderWidth: 2, pointRadius: 0, yAxisID: "y1" },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { font: { weight: "bold", size: 10 }, maxRotation: 45 } },
            y: { type: "linear", display: true, position: "left", grid: { color: "#f1f5f9" } },
            y1: { type: "linear", display: true, position: "right", grid: { display: false } },
          },
        },
      });
    } catch (e) {
      console.warn("Chart fetch failed", e);
    }
  }

  /* ==========================================
   * 3. 初期化
   * ========================================== */
  let quickFilterState = "all";

  window.addEventListener("DOMContentLoaded", () => {
    const suffix = "?scan=" + encodeURIComponent(scanId);
    const taskLink = document.getElementById("nav-task");
    if (taskLink) taskLink.setAttribute("href", "gsc-task.html" + suffix);
    const perfLink = document.querySelector('a[href="gsc.html"]');
    if (perfLink) perfLink.setAttribute("href", "gsc.html" + suffix);
    const indexLink = document.getElementById("nav-indexHealth");
    if (indexLink) indexLink.setAttribute("href", "gsc-indexhealth.html" + suffix);
    const techLink = document.getElementById("nav-technical");
    if (techLink) techLink.setAttribute("href", "gsc-technical.html" + suffix);
    const oppLink = document.getElementById("nav-opportunities");
    if (oppLink) oppLink.setAttribute("href", "gsc-opportunities.html" + suffix);

    document.querySelectorAll(".quick-filter").forEach((btn) => {
      btn.addEventListener("click", () => {
        quickFilterState = btn.dataset.quick || "all";
        document.querySelectorAll(".quick-filter").forEach((b) => {
          b.classList.toggle("bg-white", b.dataset.quick === quickFilterState);
          b.classList.toggle("text-indigo-600", b.dataset.quick === quickFilterState);
          b.classList.toggle("shadow-sm", b.dataset.quick === quickFilterState);
          b.classList.toggle("text-slate-500", b.dataset.quick !== quickFilterState);
        });
        if (window.filterGSCTable) window.filterGSCTable();
      });
    });
    document.getElementById("chart-30d")?.addEventListener("click", () => {
      document.getElementById("chart-30d")?.classList.add("bg-white", "shadow-sm");
      document.getElementById("chart-90d")?.classList.remove("bg-white", "shadow-sm");
      if (gscPropertyUrlForChart) void fetchAndRenderChart(gscPropertyUrlForChart, 30);
    });
    document.getElementById("chart-90d")?.addEventListener("click", () => {
      document.getElementById("chart-90d")?.classList.add("bg-white", "shadow-sm");
      document.getElementById("chart-30d")?.classList.remove("bg-white", "shadow-sm");
      if (gscPropertyUrlForChart) void fetchAndRenderChart(gscPropertyUrlForChart, 90);
    });
    void init();
  });

  function updateCacheLabel(fetchedAt, isHit) {
    const el = document.getElementById("gsc-cache-label");
    if (!el) return;
    if (!fetchedAt) { el.textContent = ""; return; }
    const d = new Date(fetchedAt);
    const now = new Date();
    const diffMin = Math.floor((now - d) / 60000);
    const timeStr = diffMin < 1 ? "今" : diffMin < 60 ? `${diffMin}分前` : `${Math.floor(diffMin / 60)}時間前`;
    if (!isHit) { el.textContent = ""; return; }
    el.textContent = `キャッシュ（${timeStr}取得）`;
    el.className = "text-[10px] text-amber-500 font-bold";
  }

  async function init(noCache = false) {
    let scanTargetUrl = "";
    let propertyUrl = null;

    try {
      const res = await fetch(`/api/scans/result/${encodeURIComponent(scanId)}`, {
        credentials: "include",
      });

      if (res.status === 401) {
        window.location.replace("/");
        return;
      }
      if (res.ok) {
        const data = await res.json();
        scanTargetUrl = data.scan?.target_url || data.pages?.[0]?.url || "";
        propertyUrl = data.scan?.gsc_property_url || null;
      }
    } catch (e) {
      console.warn("scan fetch failed", e);
    }

    if (!propertyUrl) {
      try {
        const fb = await fetch(`/api/scans/${encodeURIComponent(scanId)}`, { credentials: "include" });
        if (fb.ok) {
          const fbData = await fb.json();
          propertyUrl = fbData.scan?.gsc_property_url || null;
          if (!scanTargetUrl && fbData.scan?.target_url) scanTargetUrl = fbData.scan.target_url;
        }
      } catch (e) {
        console.warn("scan fallback fetch failed", e);
      }
    }

    setHeaderTargetDomain(scanTargetUrl);

    if (!propertyUrl) {
      showEmptyState();
      return;
    }

    // GSC API 呼び出し
    try {
      const apiRes = await fetch("/api/gsc/performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ propertyUrl, scanId, noCache }),
      });
      lastFetchedAt = apiRes.headers.get("X-GSC-Fetched-At") || null;
      updateCacheLabel(lastFetchedAt, apiRes.headers.get("X-GSC-Cache") === "HIT");

      if (!apiRes.ok) {
        const err = await apiRes.json().catch(() => ({}));
        if (err.error) console.warn("GSC API:", err.error);
        showEmptyState();
        return;
      }

      const rows = await apiRes.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        showEmptyState();
        return;
      }

      gscConnected = true;
      gscPropertyUrlForChart = propertyUrl;
      rawGscData = processGscData(rows);
      updateSummaryCards(rawGscData);
      renderGSCTable(rawGscData);
      updateOverallAiInsight();
      updateDateDisplay();
      setDataSectionEnabled(true);
      void fetchAndRenderChart(propertyUrl, 30);
    } catch (e) {
      console.warn("GSC API not available", e);
      showEmptyState();
    }
  }

  /* ==========================================
   * 4. グローバル関数
   * ========================================== */
  window.refreshGSCData = async function () {
    if (!gscConnected) return;
    const btn = document.getElementById("refresh-btn");
    const originalHtml = btn ? btn.innerHTML : "";
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="flex items-center gap-2"><svg class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle class="opacity-25" cx="12" cy="12" r="10" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> 更新中...</span>`;
    }
    // キャッシュをクリアしてから再取得
    try {
      await fetch("/api/gsc/cache/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ scanId }),
      });
    } catch (e) { /* ignore */ }
    await init(true); // noCache=true
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  };

  function populateDetailContent(item) {
    const deviceTag = `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100 text-[9px] font-black uppercase tracking-tighter">GSC</span>`;
    const priorityTag = `<span class="px-2 py-0.5 rounded text-[9px] font-black ${item.priorityClass}">${item.priority}</span>`;

    let analysis = "", actions = [];
    if (item.priority === "HIGH") {
      analysis = "表示回数は多いものの順位が伸び悩んでいます。内部リンクの集約と、競合サイトにない独自情報の追記を検討してください。";
      actions = ["主要キーワードをタイトル前方に配置", "専門家の監修・コメントを追記", "LSIキーワードの補完"];
    } else if (item.ctrNum < 0.03 && parseFloat(item.position) <= 5) {
      analysis = "上位表示されていますが、クリック率が低迷しています。スニペット（説明文）の訴求力が不足しています。";
      actions = ["メタディスクリプションに数字を入れる", "構造化データ(FAQ)の検討"];
    } else {
      analysis = "インデックス状況は良好です。現在の順位を維持しつつ、トピッククラスターモデルでの強化を推奨します。";
      actions = ["関連記事からの内部リンク強化", "情報の最新化（リフレッシュ）"];
    }

    const actionHtml = actions.map((a) => `<li class="flex items-start gap-2"><svg class="w-4 h-4 text-indigo-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg><span>${a}</span></li>`).join("");

    return { deviceTag, priorityTag, analysis, actionHtml };
  }

  window.selectQuery = function (id) {
    if (!gscConnected) return;
    const item = rawGscData.find((d) => d.id === id);
    if (!item) return;

    const rows = document.querySelectorAll("#gscTableBody tr");
    rows.forEach((r) => r.classList.remove("bg-indigo-50/50", "border-indigo-500"));
    if (event?.currentTarget) event.currentTarget.classList.add("bg-indigo-50/50", "border-indigo-500");

    const content = populateDetailContent(item);

    document.getElementById("panelPlaceholder")?.classList.add("hidden");
    document.getElementById("panelContent")?.classList.remove("hidden");
    document.getElementById("detailQueryName").textContent = item.url;
    document.getElementById("detailDeviceTag").innerHTML = content.deviceTag;
    document.getElementById("detailPriorityTag").innerHTML = content.priorityTag;
    document.getElementById("analysisText").textContent = content.analysis;
    document.getElementById("actionList").innerHTML = content.actionHtml;

    const modal = document.getElementById("gscUrlDetailModal");
    if (modal) {
      document.getElementById("modalDetailQueryName").textContent = item.url;
      document.getElementById("modalDetailDeviceTag").innerHTML = content.deviceTag;
      document.getElementById("modalDetailPriorityTag").innerHTML = content.priorityTag;
      document.getElementById("modalAnalysisText").textContent = content.analysis;
      document.getElementById("modalActionList").innerHTML = content.actionHtml;
      modal.classList.remove("hidden");
      document.body.style.overflow = "hidden";
    }
  };

  window.closeGscUrlModal = function () {
    const modal = document.getElementById("gscUrlDetailModal");
    if (modal) {
      modal.classList.add("hidden");
      document.body.style.overflow = "";
    }
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const modal = document.getElementById("gscUrlDetailModal");
      if (modal && !modal.classList.contains("hidden")) window.closeGscUrlModal();
    }
  });

  window.filterGSCTable = function () {
    if (!gscConnected) return;
    const keyword = (document.getElementById("gscSearchInput")?.value || "").toLowerCase();
    const priorityFilter = document.getElementById("priorityFilter")?.value || "";
    let filtered = rawGscData.filter((item) => {
      const matchK = item.url.toLowerCase().includes(keyword);
      const matchP = priorityFilter === "" || item.priority === priorityFilter;
      return matchK && matchP;
    });
    if (quickFilterState === "high") filtered = filtered.filter((i) => i.priority === "HIGH");
    if (quickFilterState === "ctr") filtered = filtered.filter((i) => (i.ctrNum || 0) < 0.01);
    if (quickFilterState === "drop") filtered = filtered.filter((i) => parseFloat(i.position) >= 15);
    renderGSCTable(filtered);
  };

  window.showTabComingSoon = function (tabName) {
    alert(`${tabName} タブは準備中です。`);
  };

  window.downloadGSCExcel = function () {
    if (!gscConnected || !rawGscData?.length) {
      alert("GSC API が接続されていません。seo.html の設定からアカウントをリンクしてください。");
      return;
    }
    try {
      const wb = XLSX.utils.book_new();
      const headers = ["No", "URL", "クリック", "表示回数", "CTR", "平均順位", "優先度"];
      const rows = rawGscData.map((d) => [d.id, d.url, d.clicks, d.impressions, d.ctr, d.position, d.priority]);
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      XLSX.utils.book_append_sheet(wb, ws, "GSCインデックス分析");
      XLSX.writeFile(wb, `GSC_Index_Health_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (error) {
      console.error("Excel Export Error:", error);
    }
  };
})();
