/**
 * ADs Dashboard - 運用型広告レポート
 * Chart.js, API連携, Excel出力
 */
(function () {
  "use strict";

  let adsData = [];
  let adsAreaRows = [];
  let adsHourRows = [];
  let adsDailyRows = [];
  let adsKeywordRows = [];
  let adsAdRows = [];
  let adsAssetRows = [];
  let mediaData = [];
  let connectedMediaFromStatus = []; // 連携済み媒体（status API から取得）
  let lastReportMeta = {}; // 直近レポートの meta（google_customer_id があれば Google 連携済み）
  let lastReportHint = null; // 取得失敗時のヒント（MCC 等）
  let lastCreativeDiagnostic = null; // AD/Asset レポートのエラー（クリエイティブタブが空のとき）
  let lastReportAdRows = []; // API応答の adRows を別途保持（上書き検証用）
  let lastFallbackCreative = null; // フォールバックで取得した件数 { ad, asset }
  let _lastParseAdCount = -1; // 前回loadAdsData成功時のadRows件数（-1=未成功）

  /** JSON を期待する fetch のレスポンスを安全にパース。HTML が返った場合のエラーを防止 */
  async function parseJsonResponse(res, fallback = null) {
    const ct = (res.headers.get("Content-Type") || "").toLowerCase();
    if (!ct.includes("application/json") && !ct.includes("text/json")) {
      const text = await res.text();
      if (text && (text.trim().startsWith("<") || text.includes("<!DOCTYPE"))) {
        throw new Error("サーバーがHTMLを返しました。ログインが必要か、APIのURLを確認してください。");
      }
      try {
        return JSON.parse(text) ?? fallback;
      } catch {
        throw new Error("応答を解析できませんでした。");
      }
    }
    try {
      return await res.json();
    } catch (e) {
      if (fallback !== undefined) return fallback;
      throw new Error("応答の形式が不正です: " + (e.message || "JSON parse error"));
    }
  }

  function $(id) {
    return document.getElementById(id);
  }

  /** データなし時のメッセージ（API連携済みで rows が空の場合にヒントを表示） */
  function getEmptyMessage() {
    const gc = lastReportMeta?.google_row_count ?? 0;
    const yc = lastReportMeta?.yahoo_row_count ?? 0;
    const mc = lastReportMeta?.meta_row_count ?? 0;
    const period = lastReportMeta?.requested_startDate && lastReportMeta?.requested_endDate
      ? `指定期間: ${lastReportMeta.requested_startDate}〜${lastReportMeta.requested_endDate}\n取得件数: Google ${gc}件, Yahoo ${yc}件` + (mc > 0 ? `, Meta ${mc}件` : "")
      : "";
    if (period) {
      return period + "\n\n" + (lastReportHint || "期間内に配信実績がないか、APIの取得に失敗した可能性があります。");
    }
    if (lastReportHint) return lastReportHint;
    if (lastReportMeta?.google_customer_id) {
      return "データが取得できません。認証は成功していますが、指定期間にキャンペーンデータがありません。別の月を試すか、MCC の場合はクライアント（広告運用）アカウント ID を連携してください。";
    }
    return "データがありません。API連携して更新してください。";
  }

  function initReportMonthSelect() {
    const sel = $("report-month-select");
    if (!sel) return;
    const now = new Date();
    let html = "";
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
      html += `<option value="${ym}"${i === 0 ? " selected" : ""}>${label}</option>`;
    }
    sel.innerHTML = html;
    syncDateRangeDisplay();
  }

  function getReportMonth() {
    const sel = $("report-month-select");
    return (sel && sel.value) || (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();
  }

  /** 取得月の選択に合わせて日付範囲ラベルを更新 */
  function syncDateRangeDisplay() {
    const label = $("date-range-label");
    if (!label) return;
    const ym = getReportMonth();
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
      label.textContent = "—";
      return;
    }
    const [y, m] = ym.split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    label.textContent = `${start.toLocaleDateString("ja-JP")} 〜 ${end.toLocaleDateString("ja-JP")}`;
  }

  function getPeriodType() {
    return (($("period-type-select") || {}).value || "month");
  }

  /** API用のパラメータを返す（month または startDate+endDate） */
  function getReportParams() {
    let params = null;
    if (getPeriodType() === "date") {
      const ds = $("date-start");
      const de = $("date-end");
      const start = (ds && ds.value) || "";
      const end = (de && de.value) || "";
      if (start && end && start <= end) params = { startDate: start, endDate: end };
    } else {
      const ym = getReportMonth();
      if (ym && /^\d{4}-\d{2}$/.test(ym)) params = { month: ym };
    }
    if (params) {
      const metaVals = JSON.parse(localStorage.getItem("api_meta") || "{}");
      const metaId = (metaVals.ad_account_id || "").trim();
      if (metaId) params.ad_account_id = metaId;
    }
    return params;
  }

  function updateTrendChart(dailyRows) {
    const chart = window._trendChart;
    const trendSub = document.getElementById("trend-sub");
    const params = typeof getReportParams === "function" ? getReportParams() : null;
    if (trendSub && params) {
      if (params.month && /^\d{4}-\d{2}$/.test(params.month)) {
        const [y, m] = params.month.split("-").map(Number);
        trendSub.textContent = `${y}年${m}月`;
      } else if (params.startDate && params.endDate) {
        trendSub.textContent = `${params.startDate} 〜 ${params.endDate}`;
      } else {
        trendSub.textContent = "31日分";
      }
    } else if (trendSub) {
      trendSub.textContent = "31日分";
    }
    if (!chart) return;
    if (!dailyRows || dailyRows.length === 0) {
      chart.data.labels = [];
      chart.data.datasets[0].data = [];
      chart.data.datasets[1].data = [];
      chart.update();
      return;
    }
    const limited = dailyRows.slice(-31);
    const labels = limited.map((r) => {
      const d = String(r.date || "");
      if (d.length >= 8) return `${parseInt(d.slice(4, 6), 10)}/${parseInt(d.slice(6, 8), 10)}`;
      return d;
    });
    const costData = limited.map((r) => Math.round((Number(r.cost) || 0) / 100) / 10);
    const cvData = limited.map((r) => r.conversions ?? 0);
    chart.data.labels = labels;
    chart.data.datasets[0].data = costData;
    chart.data.datasets[1].data = cvData;
    chart.update();
  }

  function switchPeriodTypeUI() {
    const type = getPeriodType();
    const monthUi = $("period-month-ui");
    const dateUi = $("period-date-ui");
    if (monthUi) monthUi.style.display = type === "month" ? "flex" : "none";
    if (dateUi) dateUi.style.display = type === "date" ? "flex" : "none";
    if (type === "date") initDateRangeInputs();
  }

  function initDateRangeInputs() {
    const ds = $("date-start");
    const de = $("date-end");
    if (!ds || !de) return;
    const today = new Date();
    if (!ds.value) {
      const start = new Date(today);
      start.setDate(today.getDate() - 7);
      ds.value = start.toISOString().slice(0, 10);
    }
    if (!de.value) de.value = today.toISOString().slice(0, 10);
  }

  let _creativeAutoFetchDone = false;
  function switchTab(id, btn) {
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    document.querySelectorAll(".tabs-bar .tab-btn").forEach((b) => b.classList.remove("active"));
    const panel = document.getElementById("tab-" + id);
    if (panel) panel.classList.add("active");
    if (btn) btn.classList.add("active");
    if (id === "keyword") {
      refreshKeywordTab();
    }
    if (id === "creative") {
      refreshCreativeTab();
      if (!_creativeAutoFetchDone && adsAdRows.length === 0 && adsAssetRows.length === 0 && panel) {
        _creativeAutoFetchDone = true;
        setTimeout(() => runCreativeDiagnostic(), 100);
      }
    } else {
      _creativeAutoFetchDone = false;
    }
  }
  window.switchTab = switchTab;

  async function runCreativeDiagnostic() {
    const el = document.getElementById("creative-diagnostic");
    if (!el) return;
    el.style.display = "block";
    el.textContent = "診断中…";
    const params = getReportParams() || {};
    const q = params.month ? { month: params.month } : { startDate: params.startDate, endDate: params.endDate };
    const query = new URLSearchParams(q).toString();
    try {
      const res = await fetch("/api/ads/yahoo/creative-debug" + (query ? "?" + query : ""), { credentials: "include" });
      const data = await res.json();
      if (data.error) {
        el.textContent = "エラー: " + data.error;
        refreshCreativeTab(); /* Show main report data if available */
        return;
      }
      const d = data._diagnostic || {};
      const gotAdRows = Array.isArray(data.adRows) && data.adRows.length > 0;
      const gotAssetRows = Array.isArray(data.assetRows) && data.assetRows.length > 0;
      if (gotAdRows || gotAssetRows) {
        if (gotAdRows) {
          adsAdRows = data.adRows;
          lastReportAdRows = [...data.adRows];
          _lastParseAdCount = data.adRows.length;
        }
        if (gotAssetRows) adsAssetRows = data.assetRows;
      }
      /* Always refresh: main report may have adRows even when diagnostic returns empty */
      refreshCreativeTab();
      el.textContent = "AD: " + (d.ad?.error || "OK") + " (Yahoo生:" + (d.ad?.rawRowCount ?? 0) + " → パース後:" + (d.ad?.parsedCount ?? 0) + ")\n"
        + "Asset: " + (d.asset?.error || "OK") + " (Yahoo生:" + (d.asset?.rawRowCount ?? 0) + " → パース後:" + (d.asset?.parsedCount ?? 0) + ")\n"
        + (gotAdRows || gotAssetRows ? "※データを表示しました\n" : "")
        + (d.adFields?.length ? "AD有効フィールド: " + d.adFields.slice(0, 15).join(", ") + "\n" : "")
        + (d.assetFields?.length ? "Asset有効フィールド: " + d.assetFields.slice(0, 15).join(", ") + "\n" : "")
        + (d.adFieldsError ? "AD getReportFields: " + d.adFieldsError + "\n" : "")
        + (d.assetFieldsError ? "Asset getReportFields: " + d.assetFieldsError : "");
    } catch (e) {
      el.textContent = "エラー: " + e.message;
      refreshCreativeTab(); /* Show main report data if available */
    }
  }
  window.runCreativeDiagnostic = runCreativeDiagnostic;

  function sparkline(id, data, color) {
    const el = document.getElementById(id);
    if (!el || typeof Chart === "undefined" || !Array.isArray(data) || data.length === 0) return;
    new Chart(el.getContext("2d"), {
      type: "line",
      data: {
        labels: data.map((_, i) => i),
        datasets: [{ data, borderColor: color, borderWidth: 1.5, tension: 0.4, pointRadius: 0, fill: false }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
        animation: false,
      },
    });
  }

  function initCharts() {
    const emptySeries = [];
    sparkline("sp1", emptySeries, "#2a5cdb");
    sparkline("sp2", emptySeries, "#0f7a4a");
    sparkline("sp3", emptySeries, "#cc2c2c");
    sparkline("sp4", emptySeries, "#7c3aed");
    sparkline("sp5", emptySeries, "#db2777");
    sparkline("sp6", emptySeries, "#9ca3af");

    let trendChart = null;
    const trendCtx = document.getElementById("trendChart");
    if (trendCtx && typeof Chart !== "undefined") {
      trendChart = new Chart(trendCtx.getContext("2d"), {
        type: "bar",
        data: {
          labels: [],
          datasets: [
            {
              type: "bar",
              label: "広告費（¥千）",
              data: [],
              backgroundColor: "rgba(42,92,219,.12)",
              borderColor: "rgba(42,92,219,.4)",
              borderWidth: 1,
              yAxisID: "y",
              borderRadius: 4,
            },
            {
              type: "line",
              label: "CV",
              data: [],
              borderColor: "#0f7a4a",
              backgroundColor: "transparent",
              borderWidth: 2,
              pointRadius: 3,
              pointBackgroundColor: "#0f7a4a",
              tension: 0.4,
              yAxisID: "y2",
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 }, padding: 12 } } },
          scales: {
            y: { grid: { color: "rgba(0,0,0,.06)" }, ticks: { font: { size: 11 }, callback: (v) => v + "k" } },
            y2: { position: "right", grid: { display: false }, ticks: { font: { size: 11 } } },
          },
        },
      });
    }
    window._trendChart = trendChart;
    updateTrendChart([]);

    let donutChartInstance = null;
    const donutCtx = document.getElementById("donutChart");
    const updateDonutChart = function () {
      if (!donutCtx || typeof Chart === "undefined") return;
      if (donutChartInstance) donutChartInstance.destroy();
      const md = typeof getFilteredMediaData === "function" ? getFilteredMediaData() : mediaData;
      if (md.length === 0) {
        donutChartInstance = new Chart(donutCtx.getContext("2d"), {
          type: "doughnut",
          data: { labels: ["データなし"], datasets: [{ data: [1], backgroundColor: ["#e8e6e0"], borderWidth: 0 }] },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "68%",
            plugins: { legend: { position: "right", labels: { boxWidth: 10, font: { size: 11 }, padding: 10 } } },
          },
        });
      } else {
        donutChartInstance = new Chart(donutCtx.getContext("2d"), {
          type: "doughnut",
          data: {
            labels: md.map((m) => m.name),
            datasets: [{
              data: md.map((m) => m.cost),
              backgroundColor: md.map((m) => m.color),
              borderWidth: 0,
              hoverOffset: 6,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "68%",
            plugins: { legend: { position: "right", labels: { boxWidth: 10, font: { size: 11 }, padding: 10 } } },
          },
        });
      }
    };
    updateDonutChart();
    window._updateDonutChart = updateDonutChart;

    refreshMediaCards();
    initBubbleChart();
    initHeatmap();
  }

  function refreshMediaCards() {
    const mc = document.getElementById("media-cards");
    if (!mc) return;
    mc.innerHTML = "";
    if (typeof window._updateDonutChart === "function") window._updateDonutChart();
    if (typeof window._initBubbleChart === "function") window._initBubbleChart();
    const md = typeof getFilteredMediaData === "function" ? getFilteredMediaData() : mediaData;
    if (md.length === 0) {
      mc.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--text-muted);white-space:pre-wrap">' + escapeHtml(getEmptyMessage()) + '</div>';
      return;
    }
    mediaData.forEach((m, i) => {
        const costStr = "¥" + m.cost.toLocaleString();
        const cpaStr = "¥" + m.cpa.toLocaleString();
        const div = document.createElement("div");
        div.className = "media-card" + (i === 0 ? " active" : "");
        div.onclick = function () {
          mc.querySelectorAll(".media-card").forEach((c) => c.classList.remove("active"));
          this.classList.add("active");
        };
        div.innerHTML = `
          <div class="media-name"><span class="media-dot" style="background:${m.color}"></span>${m.name}</div>
          <div class="media-metrics">
            <div class="media-metric-item"><div class="media-metric-label">Cost</div><div class="media-metric-value">${costStr}</div></div>
            <div class="media-metric-item"><div class="media-metric-label">CV</div><div class="media-metric-value">${m.cv}</div></div>
            <div class="media-metric-item"><div class="media-metric-label">CPA</div><div class="media-metric-value">${cpaStr}</div></div>
            <div class="media-metric-item"><div class="media-metric-label">CTR</div><div class="media-metric-value">${m.ctr}</div></div>
          </div>
          <div class="roas-bar-wrap">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:4px"><span>ROAS</span><span style="font-weight:600;color:var(--text-primary)">${m.roas}</span></div>
            <div class="roas-bar-bg"><div class="roas-bar-fill" style="width:${((m.roas / m.roasMax) * 100).toFixed(0)}%;background:${m.color}"></div></div>
          </div>
        `;
        mc.appendChild(div);
      });
  }

  let bubbleChartInstance = null;
  function initBubbleChart() {
    const bubbleCtx = document.getElementById("bubbleChart");
    if (!bubbleCtx || typeof Chart === "undefined") return;
    if (bubbleChartInstance) bubbleChartInstance.destroy();
    if (mediaData.length === 0) {
      bubbleChartInstance = new Chart(bubbleCtx.getContext("2d"), {
        type: "bubble",
        data: { datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "bottom" } },
          scales: { x: {}, y: { min: 1.5, max: 5 } },
        },
      });
      return;
    }
    bubbleChartInstance = new Chart(bubbleCtx.getContext("2d"), {
      type: "bubble",
      data: {
        datasets: mediaData.map((m) => ({
            label: m.name,
            data: [{ x: m.cost / 1000, y: m.roas, r: Math.sqrt(m.cv) * 2.5 }],
            backgroundColor: m.color + "55",
            borderColor: m.color,
            borderWidth: 2,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } },
            tooltip: {
              callbacks: {
                label: (ctx) =>
                  `${ctx.dataset.label}  Cost: ¥${mediaData[ctx.datasetIndex].cost.toLocaleString()}  ROAS: ${ctx.raw.y}  CV: ${mediaData[ctx.datasetIndex].cv}`,
              },
            },
          },
          scales: {
            x: {
              title: { display: true, text: "広告費（¥千）", font: { size: 11 } },
              grid: { color: "rgba(0,0,0,.06)" },
              ticks: { font: { size: 11 } },
            },
            y: {
              title: { display: true, text: "ROAS", font: { size: 11 } },
              grid: { color: "rgba(0,0,0,.06)" },
              ticks: { font: { size: 11 } },
              min: 1.5,
              max: 5,
            },
          },
        },
      });
  }
  window._initBubbleChart = initBubbleChart;

  function initHeatmap() {
    const days = ["月", "火", "水", "木", "金", "土", "日"];
    const hours = Array.from({ length: 24 }, (_, i) => i);
    function cvData(_d, _h) {
      return 0;
    }
    const allVals = days.flatMap((_, d) => hours.map((h) => cvData(d, h)));
    const maxVal = Math.max(...allVals);
    const colors = (v) => {
      const t = v / maxVal;
      if (t < 0.15) return "#f0ede6";
      if (t < 0.3) return "#d4e8fc";
      if (t < 0.5) return "#93c5fd";
      if (t < 0.7) return "#3b82f6";
      if (t < 0.85) return "#1d4ed8";
      return "#1e3a8a";
    };

    const hmDiv = document.getElementById("heatmap");
    const legendBar = document.getElementById("hm-legend-bar");
    if (!hmDiv) return;
    let html = '<div class="heatmap-grid"><div></div>';
    hours.forEach((h) => {
      html += `<div class="heatmap-header">${h}</div>`;
    });
    days.forEach((day, d) => {
      html += `<div class="heatmap-row-label">${day}</div>`;
      hours.forEach((h) => {
        const v = cvData(d, h);
        const c = colors(v);
        html += `<div class="hm-cell" style="background:${c}" data-tip="${day}曜 ${h}時 CV:${v}" onmouseenter="window.adsShowTip(event,this.dataset.tip)" onmouseleave="window.adsHideTip()"></div>`;
      });
    });
    html += "</div>";
    hmDiv.innerHTML = html;
    if (legendBar) {
      ["#f0ede6", "#d4e8fc", "#93c5fd", "#3b82f6", "#1d4ed8", "#1e3a8a"].forEach((c) => {
        legendBar.innerHTML += `<div class="hm-legend-step" style="background:${c}"></div>`;
      });
    }
  }

  window.adsShowTip = function (e, text) {
    const tip = document.getElementById("tooltip");
    if (!tip) return;
    tip.textContent = text;
    tip.style.display = "block";
    tip.style.left = e.clientX + 12 + "px";
    tip.style.top = e.clientY - 28 + "px";
  };
  window.adsHideTip = function () {
    const tip = document.getElementById("tooltip");
    if (tip) tip.style.display = "none";
  };

  document.addEventListener("mousemove", (e) => {
    const tip = document.getElementById("tooltip");
    if (tip && tip.style.display === "block") {
      tip.style.left = e.clientX + 12 + "px";
      tip.style.top = e.clientY - 28 + "px";
    }
  });

  const apiMedia = [
    {
      id: "google",
      name: "Google Ads",
      color: "#4285f4",
      bg: "#eef3fe",
      docsUrl: "https://developers.google.com/google-ads/api/docs/start",
      status: "connected",
      fields: [], // Developer Token, Client ID, Client Secret は .env で管理。Refresh Token は OAuth で取得。Customer ID は下の OAuth ブロックで入力。
    },
    {
      id: "yahoo",
      name: "Yahoo広告",
      color: "#ff0033",
      bg: "#fff0f0",
      docsUrl: "https://ads-developers.yahoo.co.jp/ja/ads-api/",
      status: "error",
      fields: [], // Client ID/Secret は .env、OAuth で認証
    },
    {
      id: "meta",
      name: "Meta",
      color: "#1877f2",
      bg: "#eef3fe",
      docsUrl: "https://developers.facebook.com/docs/marketing-api",
      status: "disconnected",
      fields: [{ key: "ad_account_id", label: "Ad Account ID", type: "text" }],
    },
    {
      id: "x",
      name: "X (Twitter)",
      color: "#14171a",
      bg: "#f4f4f4",
      docsUrl: "https://developer.twitter.com/en/docs/twitter-ads-api",
      status: "disconnected",
      fields: [
        { key: "api_key", label: "API Key", type: "text", placeholder: "xxxxxxxxxxxxxxxx" },
        { key: "api_secret", label: "API Secret", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
        { key: "access_token", label: "Access Token", type: "text", placeholder: "xxxxxxxxx-xxxxxxxx" },
        { key: "access_token_secret", label: "Access Token Secret", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
        { key: "account_id", label: "Ads Account ID", type: "text", placeholder: "abc12" },
      ],
    },
    {
      id: "line",
      name: "LINE",
      color: "#06c755",
      bg: "#e8faf0",
      docsUrl: "https://developers.line.biz/ja/docs/line-ads-api/",
      status: "disconnected",
      fields: [
        { key: "channel_id", label: "Channel ID", type: "text", placeholder: "1234567890" },
        { key: "channel_secret", label: "Channel Secret", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
        { key: "access_token", label: "Long-lived Access Token", type: "password", placeholder: "xxxxxxxx..." },
        { key: "advertiser_id", label: "Advertiser ID", type: "text", placeholder: "ad_xxxxxxxxxx" },
      ],
    },
  ];

  const statusLabel = { connected: "接続済み", error: "エラー", disconnected: "未接続" };
  const statusColor = { connected: "var(--good)", error: "var(--bad)", disconnected: "var(--text-muted)" };
  const statusBg = { connected: "var(--good-light)", error: "var(--bad-light)", disconnected: "#f0ede6" };

  let currentApiTab = "google";

  function buildModal() {
    const nav = document.getElementById("media-nav");
    const panels = document.getElementById("api-panels");
    if (!nav || !panels) return;
    nav.innerHTML = "";
    panels.innerHTML = "";

    apiMedia.forEach((m) => {
      const btn = document.createElement("button");
      btn.id = "nav-" + m.id;
      btn.onclick = () => switchApiTab(m.id);
      btn.style.cssText =
        "width:100%;border:none;background:none;text-align:left;padding:8px 10px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:8px;font-family:'DM Sans',sans-serif;font-size:13px;transition:background .12s;margin-bottom:2px";
      btn.innerHTML = `
        <span style="width:8px;height:8px;border-radius:50%;background:${m.color};flex-shrink:0"></span>
        <span style="flex:1">${m.name}</span>
        <span style="width:7px;height:7px;border-radius:50%;background:${statusColor[m.status]}"></span>
      `;
      nav.appendChild(btn);

      const panel = document.createElement("div");
      panel.id = "panel-" + m.id;
      panel.style.display = "none";
      const savedVals = JSON.parse(localStorage.getItem("api_" + m.id) || "{}");

      const hint =
        m.id === "google"
          ? "GOOGLE_ADS_DEVELOPER_TOKEN、GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET は .env で設定済みです。下の「Google でアカウント連携」をクリックすると、お使いの Google アカウントで OAuth 認証を行い、このアカウントから Google Ads データを取得できるようになります。"
          : m.id === "yahoo"
            ? "YAHOO_ADS_CLIENT_ID、YAHOO_ADS_CLIENT_SECRET は .env で設定済みです。下の「Yahoo で連携」をクリックすると、Business ID で OAuth 認証を行います。認証後、代理店アカウント配下のアカウントIDを追加してください。"
            : m.id === "meta"
              ? "META_APP_ID、META_APP_SECRET、META_ACCESS_TOKEN は .env で設定済みです。広告アカウントを選択してください。"
              : m.id === "x"
                ? "X Developer Portal でアプリを登録し、Ads API のアクセス申請を行ってください。OAuth 1.0a の4つのキーが必要です。"
                : "LINE Developers でチャンネルを作成し、LINE Ads API の利用申請を行ってください。";

      panel.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="width:10px;height:10px;border-radius:50%;background:${m.color};display:inline-block"></span>
            <span style="font-size:15px;font-weight:600">${m.name}</span>
            <span style="font-size:11px;font-weight:500;padding:2px 8px;border-radius:20px;background:${statusBg[m.status]};color:${statusColor[m.status]}">${statusLabel[m.status]}</span>
          </div>
          <a href="${m.docsUrl}" target="_blank" style="font-size:12px;color:var(--accent);text-decoration:none;display:flex;align-items:center;gap:4px">
            APIドキュメント
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 10L10 2M10 2H5M10 2v5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          </a>
        </div>
        <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:20px;font-size:12px;color:var(--text-secondary);line-height:1.7">${hint}</div>
        ${m.fields
          .filter((f) => m.id !== "meta")
          .map(
            (f) => `
          <div style="margin-bottom:16px">
            <label style="display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">
              ${f.label}
              ${f.hint ? `<span style="font-weight:400;color:var(--text-muted);margin-left:6px">${f.hint}</span>` : ""}
            </label>
            <div style="position:relative">
              <input
                id="field-${m.id}-${f.key}"
                type="${f.type}"
                placeholder="${f.placeholder}"
                value="${escapeAttr((savedVals[f.key] || ""))}"
                style="width:100%;border:1px solid var(--border);background:var(--surface2);padding:9px 36px 9px 12px;border-radius:8px;font-size:13px;font-family:'DM Mono',monospace;color:var(--text-primary);outline:none;transition:border-color .15s"
                onfocus="this.style.borderColor='var(--accent)';this.style.background='#fff'"
                onblur="this.style.borderColor='var(--border)';this.style.background='var(--surface2)'"
              >
              ${
                f.type === "password"
                  ? `<button onclick="document.getElementById('field-${m.id}-${f.key}').type=document.getElementById('field-${m.id}-${f.key}').type==='password'?'text':'password';this.textContent=document.getElementById('field-${m.id}-${f.key}').type==='password'?'👁':'🙈'" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);border:none;background:none;cursor:pointer;color:var(--text-muted);font-size:13px;padding:2px">👁</button>`
                  : ""
              }
            </div>
          </div>
        `
          )
          .join("")}
        ${m.id === "google" ? `
        <div style="margin-top:20px;padding:16px;background:var(--accent-light);border:1px solid rgba(42,92,219,.2);border-radius:10px">
          <div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:10px">1. API認証元（MCCで先にOAuth）</div>
          <div id="google-auth-sources-list" style="margin-bottom:12px"></div>
          <div style="margin-bottom:12px">
            <div style="margin-bottom:8px">
              <input id="google-auth-source-name" type="text" placeholder="認証元名（例: Google Ads_ワンエイティ）" maxlength="100" style="width:100%;border:1px solid var(--border);padding:8px 12px;border-radius:6px;font-size:13px">
            </div>
            <div style="margin-bottom:8px">
              <input id="google-auth-source-mcc-id" type="text" placeholder="MCC ID（9838710115）" maxlength="12" style="width:100%;border:1px solid var(--border);padding:8px 12px;border-radius:6px;font-size:13px;font-family:'DM Mono',monospace" inputmode="numeric">
            </div>
            <button id="google-auth-connect-btn" type="button" style="display:inline-flex;align-items:center;gap:6px;background:var(--accent);color:#fff;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;border:none;cursor:pointer">
              <svg width="14" height="14" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/></svg>
              Google で連携
            </button>
          </div>
          <div style="font-size:12px;font-weight:600;color:var(--accent);margin:16px 0 10px;padding-top:14px;border-top:1px dashed rgba(42,92,219,.3)">2. アカウント（1URLで1アカウントのみ連携）</div>
          <div id="google-ads-account-list" style="margin-bottom:16px"></div>
          <div id="google-ads-add-section" style="border-top:1px dashed rgba(42,92,219,.3);padding-top:14px;margin-top:14px">
            <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:8px">アカウントを追加</div>
            <div style="margin-bottom:8px">
              <select id="google-ads-auth-source-select" style="width:100%;border:1px solid var(--border);padding:8px 12px;border-radius:6px;font-size:13px;background:#fff">
                <option value="">API認証元を選択</option>
              </select>
            </div>
            <div style="margin-bottom:8px">
              <input id="google-ads-customer-id" type="text" placeholder="Customer ID（1932642284）" maxlength="12" style="width:100%;border:1px solid var(--border);padding:8px 12px;border-radius:6px;font-size:13px;font-family:'DM Mono',monospace" inputmode="numeric">
            </div>
            <div style="margin-bottom:8px">
              <input id="google-ads-account-name" type="text" placeholder="アカウント名（任意・未入力時はCustomer IDで表示）" maxlength="100" style="width:100%;border:1px solid var(--border);padding:8px 12px;border-radius:6px;font-size:13px">
            </div>
            <button id="google-ads-add-account-btn" type="button" style="display:inline-flex;align-items:center;gap:6px;background:var(--good);color:#fff;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;border:none;cursor:pointer">
              保存
            </button>
          </div>
        </div>
        ` : ""}
        ${m.id === "yahoo" ? `
        <div style="margin-top:20px;padding:16px;background:rgba(255,0,51,.08);border:1px solid rgba(255,0,51,.2);border-radius:10px">
          <div style="font-size:12px;font-weight:600;color:#cc0029;margin-bottom:10px">1. API認証元（OAuth）</div>
          <div id="yahoo-auth-sources-list" style="margin-bottom:12px"></div>
          <div style="margin-bottom:12px">
            <input id="yahoo-auth-source-name" type="text" placeholder="認証元名（例: Yahoo広告_ワンエイティ）" maxlength="100" style="width:100%;border:1px solid var(--border);padding:8px 12px;border-radius:6px;font-size:13px;margin-bottom:8px">
            <button id="yahoo-auth-connect-btn" type="button" style="display:inline-flex;align-items:center;gap:6px;background:#cc0029;color:#fff;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;border:none;cursor:pointer">
              Yahoo で連携
            </button>
          </div>
          <div style="font-size:12px;font-weight:600;color:#cc0029;margin:16px 0 10px;padding-top:14px;border-top:1px dashed rgba(255,0,51,.3)">2. アカウント</div>
          <div id="yahoo-ads-account-list" style="margin-bottom:16px"></div>
          <div id="yahoo-ads-add-section" style="border-top:1px dashed rgba(255,0,51,.3);padding-top:14px;margin-top:14px">
            <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:8px">アカウントを追加</div>
            <div style="margin-bottom:8px">
              <select id="yahoo-ads-auth-source-select" style="width:100%;border:1px solid var(--border);padding:8px 12px;border-radius:6px;font-size:13px;background:#fff">
                <option value="">API認証元を選択</option>
              </select>
            </div>
            <div style="margin-bottom:8px">
              <input id="yahoo-ads-account-id" type="text" placeholder="アカウントID（例: 1432223）" maxlength="32" style="width:100%;border:1px solid var(--border);padding:8px 12px;border-radius:6px;font-size:13px;font-family:'DM Mono',monospace">
            </div>
            <div style="margin-bottom:8px">
              <input id="yahoo-ads-agency-account-id" type="text" placeholder="代理店アカウント（例: belga8241waler-1002467041）※代理店配下の場合のみ" maxlength="64" style="width:100%;border:1px solid var(--border);padding:8px 12px;border-radius:6px;font-size:13px;font-family:'DM Mono',monospace">
            </div>
            <div style="margin-bottom:8px">
              <input id="yahoo-ads-account-name" type="text" placeholder="アカウント名（任意）" maxlength="100" style="width:100%;border:1px solid var(--border);padding:8px 12px;border-radius:6px;font-size:13px">
            </div>
            <button id="yahoo-ads-add-account-btn" type="button" style="display:inline-flex;align-items:center;gap:6px;background:var(--good);color:#fff;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;border:none;cursor:pointer">
              保存
            </button>
          </div>
          <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,0,51,.2);display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button id="yahoo-ads-debug-btn" type="button" style="border:1px solid #cc0029;color:#cc0029;background:#fff;padding:8px 16px;border-radius:8px;font-size:12px;cursor:pointer">
              Yahoo レポート診断
            </button>
            <button id="yahoo-account-test-btn" type="button" style="border:1px solid #cc0029;color:#cc0029;background:#fff;padding:8px 16px;border-radius:8px;font-size:12px;cursor:pointer">
              AccountService診断（MCC切り分け）
            </button>
            <span id="yahoo-debug-result" style="font-size:12px;max-width:100%;color:var(--text-muted)"></span>
          </div>
          </div>
        ` : ""}
        ${m.id === "meta" ? `
        <div style="margin-bottom:16px" id="meta-ad-account-wrap">
          <label style="display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">Ad Account ID</label>
          <div style="position:relative" id="meta-ad-account-input-wrap">
            <input type="text" id="meta-ad-account-search" placeholder="キーワードで検索..." autocomplete="off" value="${escapeAttr(savedVals.ad_account_id || "")}" style="width:100%;border:1px solid var(--border);background:var(--surface2);padding:9px 12px;border-radius:8px;font-size:13px;font-family:'DM Sans',sans-serif;color:var(--text-primary);outline:none;box-sizing:border-box">
            <input type="hidden" id="field-meta-ad_account_id" value="${escapeAttr(savedVals.ad_account_id || "")}">
            <div id="meta-ad-account-dropdown" style="display:none;position:fixed;margin-top:2px;max-height:220px;overflow-y:auto;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.12);z-index:10001;font-size:13px"></div>
          </div>
          <span id="meta-ad-account-error" style="display:none;margin-top:6px;font-size:12px;color:var(--bad)"></span>
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
            <button id="meta-report-debug-btn" type="button" style="border:1px solid var(--meta);color:var(--meta);background:#fff;padding:8px 16px;border-radius:8px;font-size:12px;cursor:pointer">Meta レポート診断</button>
            <span id="meta-debug-result" style="font-size:12px;margin-left:8px;color:var(--text-muted)"></span>
          </div>
        </div>
        ` : ""}
        ${m.id === "google" ? `
        <div style="margin-top:20px;padding-top:18px;border-top:1px solid var(--border);display:flex;gap:10px;align-items:center;flex-wrap:wrap" id="test-section-google">
          <button id="google-ads-verify-btn" type="button" style="border:1px solid var(--accent);color:var(--accent);background:#fff;padding:8px 16px;border-radius:8px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;display:flex;align-items:center;gap:6px">
            API取得確認（Customer ID検証）
          </button>
          <button id="google-ads-debug-btn" type="button" style="border:1px solid var(--text-muted);color:var(--text-muted);background:#fff;padding:8px 16px;border-radius:8px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif">
            アカウント診断
          </button>
          <span id="test-result-google" style="font-size:12px;max-width:100%"></span>
        </div>
        ` : ""}
      `;
      panels.appendChild(panel);
    });
    switchApiTab(currentApiTab);

    const authSourcesListEl = document.getElementById("google-auth-sources-list");
    const authSourceSelectEl = document.getElementById("google-ads-auth-source-select");
    const renderAuthSourcesList = () => {
      const sources = lastConnectionStatus?.google?.auth_sources || [];
      if (!authSourcesListEl) return;
      if (sources.length === 0) {
        authSourcesListEl.innerHTML = "<div style='font-size:12px;color:var(--text-muted)'>API認証元がありません。認証元名とMCC IDを入力して「Google で連携」をクリックしてください。</div>";
        return;
      }
      authSourcesListEl.innerHTML = sources.map((s) => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--good);flex-shrink:0"></span>
          <span style="flex:1;font-size:13px"><strong>${escapeHtml(s.name)}</strong>${s.login_customer_id ? " (MCC: " + escapeHtml(s.login_customer_id) + ")" : " <span style='color:var(--warn)'>MCC未設定</span>"}${s.google_email ? " — " + escapeHtml(s.google_email) : ""}</span>
          ${!s.login_customer_id ? `<button type="button" class="google-auth-set-mcc-btn" data-id="${s.id}" style="border:1px solid var(--warn);color:var(--warn);background:#fff;padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer">MCC設定</button>` : ""}
          <button type="button" class="google-auth-delete-btn" data-id="${s.id}" style="border:1px solid var(--bad);color:var(--bad);background:#fff;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer">削除</button>
        </div>
      `).join("");
    };
    const renderAuthSourceSelect = () => {
      const sources = lastConnectionStatus?.google?.auth_sources || [];
      if (!authSourceSelectEl) return;
      authSourceSelectEl.innerHTML = '<option value="">API認証元を選択</option>' + sources.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}${s.login_customer_id ? " (MCC: " + escapeHtml(s.login_customer_id) + ")" : ""}</option>`).join("");
    };
    const accountListEl = document.getElementById("google-ads-account-list");
    const addSectionEl = document.getElementById("google-ads-add-section");
    const renderAccountList = () => {
      const accounts = lastConnectionStatus?.google?.accounts || [];
      if (!accountListEl) return;
      if (addSectionEl) addSectionEl.style.display = accounts.length === 0 ? "block" : "none";
      if (accounts.length === 0) {
        accountListEl.innerHTML = "<div style='font-size:12px;color:var(--text-muted)'>登録アカウントはありません。API認証元を選択し、下のフォームから追加してください。</div>";
        return;
      }
      accountListEl.innerHTML = accounts.map((a) => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
          <input type="radio" name="google-ads-selected" value="${a.id}" ${a.is_selected ? "checked" : ""}>
          <label style="flex:1;cursor:pointer;font-size:13px">
            <strong>${escapeHtml(a.name)}</strong> — Customer: ${escapeHtml(a.customer_id)}${a.login_customer_id ? " / MCC: " + escapeHtml(a.login_customer_id) : ""}${a.auth_source_name ? " <span style='color:var(--text-muted);font-size:11px'>(" + escapeHtml(a.auth_source_name) + ")</span>" : ""}
          </label>
          <button type="button" class="google-ads-delete-btn" data-id="${a.id}" style="border:1px solid var(--bad);color:var(--bad);background:#fff;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer">削除</button>
        </div>
      `).join("");
    };
    renderAuthSourcesList();
    renderAuthSourceSelect();
    renderAccountList();

    const yahooAuthSourcesListEl = document.getElementById("yahoo-auth-sources-list");
    const yahooAuthSourceSelectEl = document.getElementById("yahoo-ads-auth-source-select");
    const yahooAccountListEl = document.getElementById("yahoo-ads-account-list");
    const yahooAddSectionEl = document.getElementById("yahoo-ads-add-section");
    const renderYahooAuthSourcesList = () => {
      const sources = lastConnectionStatus?.yahoo?.auth_sources || [];
      if (!yahooAuthSourcesListEl) return;
      if (sources.length === 0) {
        yahooAuthSourcesListEl.innerHTML = "<div style='font-size:12px;color:var(--text-muted)'>API認証元がありません。認証元名を入力して「Yahoo で連携」をクリックしてください。</div>";
        return;
      }
      yahooAuthSourcesListEl.innerHTML = sources.map((s) => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--good);flex-shrink:0"></span>
          <span style="flex:1;font-size:13px"><strong>${escapeHtml(s.name)}</strong></span>
          <button type="button" class="yahoo-auth-delete-btn" data-id="${s.id}" style="border:1px solid var(--bad);color:var(--bad);background:#fff;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer">削除</button>
        </div>
      `).join("");
    };
    const renderYahooAuthSourceSelect = () => {
      const sources = lastConnectionStatus?.yahoo?.auth_sources || [];
      if (!yahooAuthSourceSelectEl) return;
      yahooAuthSourceSelectEl.innerHTML = '<option value="">API認証元を選択</option>' + sources.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
    };
    const renderYahooAccountList = () => {
      const accounts = lastConnectionStatus?.yahoo?.accounts || [];
      if (!yahooAccountListEl) return;
      if (yahooAddSectionEl) yahooAddSectionEl.style.display = accounts.length === 0 ? "block" : "none";
      if (accounts.length === 0) {
        yahooAccountListEl.innerHTML = "<div style='font-size:12px;color:var(--text-muted)'>登録アカウントはありません。API認証元を選択し、下のフォームから追加してください。</div>";
        return;
      }
      yahooAccountListEl.innerHTML = accounts.map((a) => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
          <input type="radio" name="yahoo-ads-selected" value="${a.id}" ${a.is_selected ? "checked" : ""}>
          <label style="flex:1;cursor:pointer;font-size:13px">
            <strong>${escapeHtml(a.name)}</strong> — ID: ${escapeHtml(a.account_id)}${a.agency_account_id ? " / 代理店: " + escapeHtml(a.agency_account_id) : ""}${a.auth_source_name ? " <span style='color:var(--text-muted);font-size:11px'>(" + escapeHtml(a.auth_source_name) + ")</span>" : ""}
          </label>
          <button type="button" class="yahoo-ads-delete-btn" data-id="${a.id}" style="border:1px solid var(--bad);color:var(--bad);background:#fff;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer">削除</button>
        </div>
      `).join("");
    };
    renderYahooAuthSourcesList();
    renderYahooAuthSourceSelect();
    renderYahooAccountList();

    yahooAuthSourcesListEl?.addEventListener("click", async (e) => {
      const btn = e.target.closest(".yahoo-auth-delete-btn");
      if (btn && confirm("このAPI認証元を削除しますか？紐づくアカウントも削除されます。")) {
        const r = await fetch("/api/ads/yahoo/auth-sources/" + btn.dataset.id, { method: "DELETE", credentials: "include" });
        if (r.ok) {
          const st = await fetch("/api/ads/status", { credentials: "include" }).then((x) => x.json());
          lastConnectionStatus = st;
          renderYahooAuthSourcesList();
          renderYahooAuthSourceSelect();
          renderYahooAccountList();
        }
      }
    });
    yahooAccountListEl?.addEventListener("change", async (e) => {
      if (e.target.name === "yahoo-ads-selected" && e.target.value) {
        const r = await fetch("/api/ads/yahoo/accounts/select", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: parseInt(e.target.value, 10) }),
        });
        if (r.ok) {
          const st = await fetch("/api/ads/status", { credentials: "include" }).then((x) => x.json());
          lastConnectionStatus = st;
        }
      }
    });
    yahooAccountListEl?.addEventListener("click", async (e) => {
      const btn = e.target.closest(".yahoo-ads-delete-btn");
      if (btn && confirm("削除しますか？")) {
        const r = await fetch("/api/ads/yahoo/accounts/" + btn.dataset.id, { method: "DELETE", credentials: "include" });
        if (r.ok) {
          const st = await fetch("/api/ads/status", { credentials: "include" }).then((x) => x.json());
          lastConnectionStatus = st;
          renderYahooAccountList();
        }
      }
    });

    const yahooAuthConnectBtn = document.getElementById("yahoo-auth-connect-btn");
    const yahooAuthSourceNameInput = document.getElementById("yahoo-auth-source-name");
    if (yahooAuthConnectBtn) {
      yahooAuthConnectBtn.onclick = () => {
        const name = (yahooAuthSourceNameInput?.value || "").trim();
        if (!name) {
          alert("認証元名を入力してください");
          return;
        }
        window.location.href = "/api/ads/yahoo/connect?name=" + encodeURIComponent(name);
      };
    }
    const yahooAddAccountBtn = document.getElementById("yahoo-ads-add-account-btn");
    const yahooAccountNameInput = document.getElementById("yahoo-ads-account-name");
    const yahooAccountIdInput = document.getElementById("yahoo-ads-account-id");
    const yahooAgencyAccountIdInput = document.getElementById("yahoo-ads-agency-account-id");
    if (yahooAddAccountBtn) {
      yahooAddAccountBtn.onclick = async () => {
        const authId = (yahooAuthSourceSelectEl?.value || "").trim();
        const name = (yahooAccountNameInput?.value || "").trim();
        const aid = (yahooAccountIdInput?.value || "").trim();
        const agid = (yahooAgencyAccountIdInput?.value || "").trim() || null;
        if (!authId || !aid) {
          alert("API認証元とアカウントIDを入力してください");
          return;
        }
        try {
          const r = await fetch("/api/ads/yahoo/accounts", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name || undefined, account_id: aid, agency_account_id: agid || undefined, api_auth_source_id: authId }),
          });
          const d = await parseJsonResponse(r, { success: false });
          if (d.success) {
            const st = await fetch("/api/ads/status", { credentials: "include" }).then((x) => x.json());
            lastConnectionStatus = st;
            renderYahooAccountList();
            yahooAccountNameInput.value = "";
            yahooAccountIdInput.value = "";
            yahooAgencyAccountIdInput.value = "";
          } else {
            alert(d.error || "登録に失敗しました");
          }
        } catch (e) {
          alert("エラー: " + (e.message || "通信失敗"));
        }
      };
    }
    const yahooDebugBtn = document.getElementById("yahoo-ads-debug-btn");
    const yahooDebugResult = document.getElementById("yahoo-debug-result");
    if (yahooDebugBtn && yahooDebugResult) {
      yahooDebugBtn.onclick = async () => {
        yahooDebugResult.textContent = "診断中...";
        yahooDebugResult.style.color = "var(--text-muted)";
        yahooDebugBtn.disabled = true;
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 200000);
        try {
          const params = typeof getReportParams === "function" ? getReportParams() : {};
          const q = new URLSearchParams(params).toString();
          const r = await fetch("/api/ads/yahoo/report-debug" + (q ? "?" + q : ""), { credentials: "include", signal: ctrl.signal });
          clearTimeout(timeout);
          const d = await parseJsonResponse(r, {});
          if (r.ok) {
            const rows = d.rows || [];
            const hint = d._hint || "";
            const connectionOk = !!d._connectionOk;
            yahooDebugResult.textContent = rows.length > 0
              ? "成功: " + rows.length + "件のキャンペーンを取得"
              : connectionOk
                ? "接続OK: Add・Get API は正常です"
                : hint || "データなし（期間内に実績がないか、APIエラーの可能性）";
            yahooDebugResult.style.color = rows.length > 0 || connectionOk ? "var(--good)" : "var(--warn)";
            if (d._debug) {
              console.log("[Yahoo Ads 診断] APIレスポンス:", d._debug);
            }
            if (hint && !rows.length && !connectionOk) {
              const errDetail = d._debug?.errors ? "\n\nエラー詳細: " + JSON.stringify(d._debug.errors) : "";
              alert(hint + errDetail);
            }
          } else {
            yahooDebugResult.textContent = "エラー: " + (d.error || r.status);
            yahooDebugResult.style.color = "var(--bad)";
          }
        } catch (e) {
          yahooDebugResult.textContent = "エラー: " + (e.name === "AbortError" ? "タイムアウト（3分超）" : (e.message || "通信失敗"));
          yahooDebugResult.style.color = "var(--bad)";
        } finally {
          clearTimeout(timeout);
          yahooDebugBtn.disabled = false;
        }
      };
    }
    const yahooAccountTestBtn = document.getElementById("yahoo-account-test-btn");
    if (yahooAccountTestBtn && yahooDebugResult) {
      yahooAccountTestBtn.onclick = async () => {
        yahooDebugResult.textContent = "AccountService診断中...";
        yahooDebugResult.style.color = "var(--text-muted)";
        yahooAccountTestBtn.disabled = true;
        try {
          const r = await fetch("/api/ads/yahoo/account-test", { credentials: "include" });
          const d = await parseJsonResponse(r, {});
          if (d.ok) {
            yahooDebugResult.textContent = "200 OK: " + (d.interpretation || "接続権限あり");
            yahooDebugResult.style.color = "var(--good)";
            console.log("[Yahoo AccountService診断]", d);
          } else {
            const msg = d.interpretation || d.error || "HTTP " + (d.status || r.status);
            yahooDebugResult.textContent = msg;
            yahooDebugResult.style.color = "var(--bad)";
            console.log("[Yahoo AccountService診断]", d);
          }
        } catch (e) {
          yahooDebugResult.textContent = "エラー: " + (e.message || "通信失敗");
          yahooDebugResult.style.color = "var(--bad)";
        } finally {
          yahooAccountTestBtn.disabled = false;
        }
      };
    }
    const metaDebugBtn = document.getElementById("meta-report-debug-btn");
    const metaDebugResult = document.getElementById("meta-debug-result");
    if (metaDebugBtn && metaDebugResult) {
      metaDebugBtn.onclick = async () => {
        const metaId = (document.getElementById("field-meta-ad_account_id")?.value || "").trim() || (JSON.parse(localStorage.getItem("api_meta") || "{}").ad_account_id || "").trim();
        if (!metaId) {
          metaDebugResult.textContent = "広告アカウントを選択してください";
          metaDebugResult.style.color = "var(--bad)";
          return;
        }
        metaDebugResult.textContent = "診断中...";
        metaDebugResult.style.color = "var(--text-muted)";
        metaDebugBtn.disabled = true;
        try {
          const params = typeof getReportParams === "function" ? getReportParams() : {};
          const ym = params?.month || (typeof getReportMonth === "function" ? getReportMonth() : null);
          const qp = { ad_account_id: metaId };
          if (params?.month) qp.month = params.month;
          else if (params?.startDate && params?.endDate) { qp.startDate = params.startDate; qp.endDate = params.endDate; }
          else if (ym && /^\d{4}-\d{2}$/.test(ym)) qp.month = ym;
          const q = new URLSearchParams(qp).toString();
          const r = await fetch("/api/ads/meta/report-debug" + (q ? "?" + q : ""), { credentials: "include" });
          const d = await parseJsonResponse(r, {});
          if (r.ok) {
            const rows = d.rows || [];
            const err = d.meta?.error;
            metaDebugResult.textContent = err
              ? "エラー: " + err
              : rows.length > 0
                ? "成功: " + rows.length + "件取得"
                : "データなし（期間内に実績がない可能性）";
            metaDebugResult.style.color = err ? "var(--bad)" : rows.length > 0 ? "var(--good)" : "var(--warn)";
            if (d._debug) console.log("[Meta 診断]", d._debug);
          } else {
            metaDebugResult.textContent = "エラー: " + (d.error || r.status);
            metaDebugResult.style.color = "var(--bad)";
          }
        } catch (e) {
          metaDebugResult.textContent = "エラー: " + (e.message || "通信失敗");
          metaDebugResult.style.color = "var(--bad)";
        } finally {
          metaDebugBtn.disabled = false;
        }
      };
    }
    accountListEl?.addEventListener("change", async (e) => {
      if (e.target.name === "google-ads-selected" && e.target.value) {
        const r = await fetch("/api/ads/google/accounts/select", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: parseInt(e.target.value, 10) }),
        });
        if (r.ok) {
          const st = await fetch("/api/ads/status", { credentials: "include" }).then((x) => x.json());
          lastConnectionStatus = st;
        }
      }
    });
    authSourcesListEl?.addEventListener("click", async (e) => {
      const setMccBtn = e.target.closest(".google-auth-set-mcc-btn");
      if (setMccBtn) {
        const mccId = prompt("MCC ID（例: 9838710115）を入力してください");
        if (mccId && mccId.trim()) {
          const r = await fetch("/api/ads/google/auth-sources/" + setMccBtn.dataset.id + "/mcc", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ login_customer_id: mccId.trim().replace(/-/g, "") }),
          });
          if (r.ok) {
            const st = await fetch("/api/ads/status", { credentials: "include" }).then((x) => x.json());
            lastConnectionStatus = st;
            renderAuthSourcesList();
            renderAuthSourceSelect();
            alert("MCC IDを設定しました");
          } else {
            alert("設定に失敗しました");
          }
        }
        return;
      }
      const btn = e.target.closest(".google-auth-delete-btn");
      if (btn && confirm("このAPI認証元を削除しますか？紐づくアカウントも削除されます。")) {
        const r = await fetch("/api/ads/google/auth-sources/" + btn.dataset.id, { method: "DELETE", credentials: "include" });
        if (r.ok) {
          const st = await fetch("/api/ads/status", { credentials: "include" }).then((x) => x.json());
          lastConnectionStatus = st;
          renderAuthSourcesList();
          renderAuthSourceSelect();
          renderAccountList();
        }
      }
    });
    accountListEl?.addEventListener("click", async (e) => {
      const btn = e.target.closest(".google-ads-delete-btn");
      if (btn && confirm("削除しますか？")) {
        const r = await fetch("/api/ads/google/accounts/" + btn.dataset.id, { method: "DELETE", credentials: "include" });
        if (r.ok) {
          const st = await fetch("/api/ads/status", { credentials: "include" }).then((x) => x.json());
          lastConnectionStatus = st;
          renderAccountList();
        }
      }
    });

    const googleAuthConnectBtn = document.getElementById("google-auth-connect-btn");
    const googleAuthSourceNameInput = document.getElementById("google-auth-source-name");
    const googleAuthSourceMccInput = document.getElementById("google-auth-source-mcc-id");
    if (googleAuthConnectBtn) {
      googleAuthConnectBtn.onclick = () => {
        const name = (googleAuthSourceNameInput?.value || "").trim();
        const mccId = (googleAuthSourceMccInput?.value || "").trim().replace(/\s/g, "").replace(/-/g, "");
        if (!name) {
          alert("認証元名を入力してください");
          return;
        }
        if (!mccId) {
          alert("MCC IDを入力してください");
          return;
        }
        const params = new URLSearchParams({ mode: "auth_source", name });
        params.set("login_customer_id", mccId);
        window.location.href = "/api/ads/google/connect?" + params.toString();
      };
    }
    const googleAddAccountBtn = document.getElementById("google-ads-add-account-btn");
    const googleAccountNameInput = document.getElementById("google-ads-account-name");
    const googleCustomerInput = document.getElementById("google-ads-customer-id");
    if (googleAddAccountBtn) {
      googleAddAccountBtn.onclick = async () => {
        const authId = (authSourceSelectEl?.value || "").trim();
        const name = (googleAccountNameInput?.value || "").trim();
        const cid = (googleCustomerInput?.value || "").trim().replace(/\s/g, "").replace(/-/g, "");
        if (!authId || !cid) {
          alert("API認証元と Customer ID を入力してください");
          return;
        }
        try {
          const r = await fetch("/api/ads/google/accounts", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name || undefined, customer_id: cid, api_auth_source_id: authId }),
          });
          const d = await parseJsonResponse(r, { success: false });
          if (d.success) {
            const st = await fetch("/api/ads/status", { credentials: "include" }).then((x) => x.json());
            lastConnectionStatus = st;
            renderAccountList();
            googleAccountNameInput.value = "";
            googleCustomerInput.value = "";
          } else {
            alert(d.error || "登録に失敗しました");
          }
        } catch (e) {
          alert("エラー: " + (e.message || "通信失敗"));
        }
      };
    }
    const verifyBtn = document.getElementById("google-ads-verify-btn");
    const verifyResult = document.getElementById("test-result-google");
    if (verifyBtn && verifyResult) {
      verifyBtn.onclick = async () => {
        verifyResult.style.color = "var(--text-muted)";
        verifyResult.textContent = "確認中...";
        try {
          const params = getReportParams();
          const query = params ? new URLSearchParams(params).toString() : "";
          const r = await fetch(`/api/ads/verify${query ? "?" + query : ""}`, { credentials: "include" });
          const d = await parseJsonResponse(r, { success: false });
          if (d.success) {
            verifyResult.style.color = d.customer_id ? "var(--good)" : "var(--warn)";
            verifyResult.textContent = d.message;
            verifyResult.title = d.customer_id ? `使用中: ${d.customer_id} (${d.row_count}件)` : "";
          } else {
            verifyResult.style.color = "var(--bad)";
            verifyResult.textContent = d.message || "確認に失敗しました";
          }
        } catch (e) {
          verifyResult.style.color = "var(--bad)";
          verifyResult.textContent = "エラー: " + (e.message || "通信失敗");
        }
      };
    }
    const debugBtn = document.getElementById("google-ads-debug-btn");
    if (debugBtn) {
      debugBtn.onclick = async () => {
        try {
          const st = await fetch("/api/ads/status", { credentials: "include" }).then((r) => parseJsonResponse(r, {}));
          lastConnectionStatus = st;
          const d = st?.google?.account_debug;
          const accounts = st?.google?.accounts || [];
          const authSources = st?.google?.auth_sources || [];
          if (!d) {
            if (accounts.length === 0 && authSources.length === 0) {
              alert("API認証元とアカウントがありません。\n\n1. 認証元名とMCC IDを入力して「Google で連携」\n2. アカウント追加でAPI認証元を選択、Customer IDを入力して「保存」");
            } else if (authSources.length > 0 && accounts.length === 0) {
              alert("アカウントがありません。\n\n「2. アカウント」でAPI認証元を選択し、Customer ID（例: 1932642284）を入力して「保存」をクリックしてください。");
            } else {
              alert("選択されたアカウントがありません。アカウント一覧でラジオボタンを選択してください。");
            }
            return;
          }
          let msg = `アカウント: ${d.name || "(未設定)"}\nCustomer ID: ${d.customer_id || "(未設定)"}\nMCC ID: ${d.login_customer_id || "(未設定)"}\nrefresh_token: ${d.has_refresh_token ? "あり" : "なし"}`;
          if (d.hint) msg += "\n\n⚠️ " + d.hint;
          alert(msg);
        } catch (e) {
          alert("診断エラー: " + (e.message || "通信失敗"));
        }
      };
    }
  }

  let _metaAdAccounts = [];
  let _metaDropdownCloseHandler = null;
  function renderMetaAdAccountDropdown(filter) {
    const dropdown = document.getElementById("meta-ad-account-dropdown");
    const hiddenEl = document.getElementById("field-meta-ad_account_id");
    if (!dropdown || !hiddenEl) return;
    const q = (filter || "").trim().toLowerCase();
    const list = q ? _metaAdAccounts.filter((a) => {
      const id = (a.id || "").startsWith("act_") ? a.id : "act_" + (a.id || "");
      const name = (a.name || "").toLowerCase();
      return name.includes(q) || id.toLowerCase().includes(q);
    }) : _metaAdAccounts;
    dropdown.innerHTML = list.length === 0
      ? '<div style="padding:12px;color:var(--text-muted);font-size:12px">該当するアカウントがありません</div>'
      : list.map((a) => {
        const id = (a.id || "").startsWith("act_") ? a.id : "act_" + (a.id || "");
        const name = a.name || "（名前なし）";
        const nameSafe = escapeAttr(name);
        const idAttr = String(id).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return '<div class="meta-ad-account-option" data-id="' + idAttr + '" data-name="' + nameSafe + '" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .1s" onmouseover="this.style.background=\'var(--surface2)\'" onmouseout="this.style.background=\'#fff\'">' + escapeHtml(name) + ' <span style="color:var(--text-muted);font-size:11px">(' + idAttr + ')</span></div>';
      }).join("");
  }
  async function loadMetaAdAccounts() {
    const searchEl = document.getElementById("meta-ad-account-search");
    const hiddenEl = document.getElementById("field-meta-ad_account_id");
    const dropdown = document.getElementById("meta-ad-account-dropdown");
    const errorEl = document.getElementById("meta-ad-account-error");
    if (!searchEl || !hiddenEl || !dropdown) return;
    searchEl.placeholder = "読み込み中...";
    searchEl.disabled = true;
    dropdown.style.display = "none";
    if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }
    try {
      const r = await fetch("/api/meta/adaccounts", { credentials: "include" });
      const d = await r.json().catch(() => ({}));
      const savedId = (JSON.parse(localStorage.getItem("api_meta") || "{}").ad_account_id || "").trim();
      const savedIdNorm = savedId ? (savedId.startsWith("act_") ? savedId : "act_" + savedId) : "";
      if (!r.ok) {
        searchEl.placeholder = "取得に失敗しました";
        if (errorEl) { errorEl.textContent = d?.error || "取得に失敗しました"; errorEl.style.display = "block"; }
        return;
      }
      _metaAdAccounts = d.accounts || d.data || [];
      searchEl.placeholder = "キーワードで検索...";
      searchEl.disabled = false;
      const saved = _metaAdAccounts.find((a) => {
        const id = (a.id || "").startsWith("act_") ? a.id : "act_" + (a.id || "");
        return id === savedIdNorm;
      });
      if (saved) {
        hiddenEl.value = savedIdNorm;
        searchEl.value = saved.name || savedIdNorm;
      } else {
        hiddenEl.value = "";
        searchEl.value = "";
      }
      renderMetaAdAccountDropdown("");
      function hideMetaDropdown() {
        dropdown.style.display = "none";
        if (_metaDropdownCloseHandler) {
          document.removeEventListener("click", _metaDropdownCloseHandler);
          _metaDropdownCloseHandler = null;
        }
      }
      function showMetaDropdown() {
        if (_metaDropdownCloseHandler) {
          document.removeEventListener("click", _metaDropdownCloseHandler);
          _metaDropdownCloseHandler = null;
        }
        renderMetaAdAccountDropdown(searchEl.value);
        const rect = searchEl.getBoundingClientRect();
        dropdown.style.top = (rect.bottom + 2) + "px";
        dropdown.style.left = rect.left + "px";
        dropdown.style.width = rect.width + "px";
        dropdown.style.display = "block";
        const close = (ev) => {
          if (!dropdown.contains(ev.target) && ev.target !== searchEl) {
            hideMetaDropdown();
          }
        };
        _metaDropdownCloseHandler = close;
        setTimeout(() => document.addEventListener("click", close), 0);
        const panels = document.getElementById("api-panels");
        const onScroll = () => { hideMetaDropdown(); panels?.removeEventListener("scroll", onScroll); };
        panels?.addEventListener("scroll", onScroll);
      }
      searchEl.oninput = showMetaDropdown;
      searchEl.onfocus = () => { if (_metaAdAccounts.length > 0) showMetaDropdown(); };
      dropdown.onclick = (e) => {
        const opt = e.target?.closest?.(".meta-ad-account-option");
        if (!opt) return;
        const id = opt.dataset.id;
        const name = opt.dataset.name || opt.textContent.trim().replace(/\s*\(act_[^)]+\)\s*$/, "") || id;
        hiddenEl.value = id;
        searchEl.value = name;
        const prev = JSON.parse(localStorage.getItem("api_meta") || "{}");
        localStorage.setItem("api_meta", JSON.stringify({ ...prev, ad_account_id: id }));
        if (!connectedMediaFromStatus.includes("Meta")) connectedMediaFromStatus = [...connectedMediaFromStatus, "Meta"];
        refreshMediaFilter();
        hideMetaDropdown();
      };
    } catch (e) {
      searchEl.placeholder = "エラー";
      searchEl.disabled = false;
      if (errorEl) { errorEl.textContent = "エラー: " + (e?.message || "通信失敗"); errorEl.style.display = "block"; }
    }
  }

  function switchApiTab(id) {
    currentApiTab = id;
    apiMedia.forEach((m) => {
      const panel = document.getElementById("panel-" + m.id);
      const navBtn = document.getElementById("nav-" + m.id);
      if (!panel || !navBtn) return;
      const active = m.id === id;
      panel.style.display = active ? "block" : "none";
      navBtn.style.background = active ? "#fff" : "none";
      navBtn.style.fontWeight = active ? "500" : "400";
      navBtn.style.boxShadow = active ? "0 1px 4px rgba(0,0,0,.07)" : "none";
    });
    if (id === "meta") loadMetaAdAccounts();
  }

  let lastConnectionStatus = {};
  window.openSettings = async function (defaultTab) {
    try {
      const res = await fetch("/api/ads/status", { credentials: "include" });
      if (res.ok) {
        const st = await parseJsonResponse(res, {});
        lastConnectionStatus = st;
        if (st.google?.connected) apiMedia[0].status = "connected";
        else apiMedia[0].status = "disconnected";
        if (st.yahoo?.connected) apiMedia[1].status = "connected";
        else apiMedia[1].status = "disconnected";
        const conn = [];
        if (st.google?.connected) conn.push("Google Ads");
        if (st.yahoo?.connected) conn.push("Yahoo広告");
        if (st.microsoft?.connected) conn.push("Microsoft Advertising");
        connectedMediaFromStatus = conn;
        refreshMediaFilter();
      }
    } catch (e) {}
    const metaVals = JSON.parse(localStorage.getItem("api_meta") || "{}");
    if ((metaVals.ad_account_id || "").trim()) {
      apiMedia[2].status = "connected";
      if (!connectedMediaFromStatus.includes("Meta")) connectedMediaFromStatus = [...connectedMediaFromStatus, "Meta"];
    } else {
      apiMedia[2].status = "disconnected";
      connectedMediaFromStatus = (connectedMediaFromStatus || []).filter((m) => m !== "Meta");
    }
    refreshMediaFilter();
    buildModal();
    if (defaultTab) switchApiTab(defaultTab);
    const ov = document.getElementById("settings-overlay");
    if (ov) {
      ov.style.display = "flex";
      setTimeout(() => (ov.style.opacity = "1"), 10);
    }
  };

  window.closeSettings = function () {
    const ov = document.getElementById("settings-overlay");
    if (ov) ov.style.display = "none";
  };

  window.saveSettings = async function () {
    apiMedia.forEach((m) => {
      const vals = {};
      m.fields.forEach((f) => {
        const el = document.getElementById("field-" + m.id + "-" + f.key);
        if (el) vals[f.key] = el.value;
      });
      localStorage.setItem("api_" + m.id, JSON.stringify(vals));
    });
    const metaVals = JSON.parse(localStorage.getItem("api_meta") || "{}");
    if ((metaVals.ad_account_id || "").trim()) {
      apiMedia[2].status = "connected";
      if (!connectedMediaFromStatus.includes("Meta")) connectedMediaFromStatus = [...connectedMediaFromStatus, "Meta"];
    } else {
      apiMedia[2].status = "disconnected";
      connectedMediaFromStatus = (connectedMediaFromStatus || []).filter((m) => m !== "Meta");
    }
    refreshMediaFilter();
    const badge = document.getElementById("badge-integrated");
    if (badge) {
      badge.textContent = connectedMediaFromStatus.length > 0 ? "✓ " + connectedMediaFromStatus.join("・") + " 連携済み" : "未連携";
      badge.classList.toggle("connected", connectedMediaFromStatus.length > 0);
    }
    closeSettings();
    if ((metaVals.ad_account_id || "").trim()) {
      loadAdsData({ trigger: "settings-saved" }).catch(() => {});
    }
  };

  document.getElementById("settings-overlay")?.addEventListener("click", function (e) {
    if (e.target === this) window.closeSettings();
  });

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML;
  }

  function escapeAttr(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  let reportAbortController = null;
  async function loadAdsData(options = {}) {
    const params = getReportParams();
    if (!params) {
      console.warn("ads: 期間が指定されていません");
      return;
    }
    if (reportAbortController) {
      reportAbortController.abort();
    }
    reportAbortController = new AbortController();
    const signal = reportAbortController.signal;
    const qp = { ...params };
    const force = options.force || (typeof document !== "undefined" && document.getElementById("ads-force-refresh")?.checked);
    if (force) {
      qp.force = "1";
      qp.debug = "1";
    }
    const query = new URLSearchParams(qp).toString();
    const timeoutMs = options.timeoutMs ?? 200000;
    const cacheBust = "_t=" + Date.now();
    const timeoutId = timeoutMs > 0 ? setTimeout(() => reportAbortController?.abort(), timeoutMs) : null;

    try {
      const res = await fetch(`/api/ads/report?${query}&${cacheBust}`, { credentials: "include", signal, cache: "no-store" });
      if (timeoutId) clearTimeout(timeoutId);
      if (!res.ok) {
        const err = await parseJsonResponse(res, {}).catch(() => ({}));
        console.warn("ads report error", err);
        throw new Error("Report fetch failed: " + (res.status || "unknown"));
      }
      const data = await parseJsonResponse(res, { rows: [], areaRows: [], hourRows: [], dailyRows: [], keywordRows: [], adRows: [], assetRows: [], meta: {} });
      const rawAdRows = data.adRows ?? data.ad_rows ?? data.creative?.adRows ?? [];
      const safeAdRows = Array.isArray(rawAdRows) ? rawAdRows : (rawAdRows?.rows ? Array.from(rawAdRows.rows) : []);
      const rawAssetRows = data.assetRows ?? data.asset_rows ?? data.creative?.assetRows ?? [];
      const safeAssetRows = Array.isArray(rawAssetRows) ? rawAssetRows : (rawAssetRows?.rows ? Array.from(rawAssetRows.rows) : []);
      adsData = data.rows || [];
      adsAreaRows = data.areaRows || [];
      adsHourRows = data.hourRows || [];
      adsDailyRows = data.dailyRows || [];
      adsAdRows = safeAdRows;
      adsAssetRows = safeAssetRows;
      lastReportAdRows = [...safeAdRows];
      _lastParseAdCount = safeAdRows.length;
      _creativeAutoFetchDone = false;
      adsKeywordRows = data.keywordRows || [];
      const adLen = safeAdRows.length;
      if (adLen > 0 || typeof data.adRows !== "undefined") {
        console.log("[Ads] API応答 adRows=" + adLen + "件" + (adLen > 0 ? " 先頭=" + JSON.stringify(safeAdRows[0]).slice(0, 80) : ""));
      }
      const meta = data.meta || {};
      lastReportMeta = meta || {};
      if (meta.requested_startDate) {
        const called = meta._media_called || [];
        console.log("[Ads] 取得結果:", `${meta.requested_startDate}〜${meta.requested_endDate}`, "呼び出し媒体:", called.join(", ") || "なし", "| Google:", meta.google_row_count ?? 0, "件, Yahoo:", meta.yahoo_row_count ?? 0, "件");
      }
      lastReportHint = data._hint || null;
      lastCreativeDiagnostic = data._creativeDiagnostic || null;
      lastFallbackCreative = data._fallbackCreative || null;
      if (data._yahooRawSample) {
        console.log("[Ads] _yahooRawSample (Yahoo parse debug):", data._yahooRawSample);
      }

      if (adsData.length > 0) {
        const byMedia = {};
        adsData.forEach((r) => {
          const m = /Yahoo/i.test(r.media) ? "Yahoo広告" : (r.media || "その他");
          if (!byMedia[m]) byMedia[m] = { cost: 0, cv: 0, imp: 0, clicks: 0 };
          byMedia[m].cost += Number(r.cost) || 0;
          byMedia[m].cv += Number(r.conversions) || 0;
          byMedia[m].imp += Number(r.impressions) || 0;
          byMedia[m].clicks += Number(r.clicks) || 0;
        });
        const mediaColors = { "Google Ads": "#4285f4", "Yahoo広告": "#ff0033", "Microsoft Advertising": "#107c10", "Meta": "#1877f2" };
        mediaData = Object.entries(byMedia).map(([name, v]) => {
          const cpa = v.cv > 0 ? Math.round(v.cost / v.cv) : 0;
          const revenue = v.cv * 35000;
          const roas = v.cost > 0 ? (revenue / v.cost).toFixed(1) : 0;
          const ctr = v.imp > 0 ? ((v.clicks / v.imp) * 100).toFixed(1) + "%" : "0%";
          return {
            name,
            color: mediaColors[name] || "#666",
            cost: v.cost,
            cv: v.cv,
            cpa,
            roas: parseFloat(roas),
            ctr,
            imp: v.imp,
            roasMax: 5,
          };
        });
      } else {
        mediaData = [];
      }
      const badgeEl = document.getElementById("badge-integrated");
      if (badgeEl) {
        const parts = [];
        if (meta.requested_startDate && meta.requested_endDate) {
          parts.push(`取得期間: ${meta.requested_startDate}〜${meta.requested_endDate}`);
        }
        const gc = meta.google_row_count ?? 0;
        const yc = meta.yahoo_row_count ?? 0;
        const mc = meta.meta_row_count ?? 0;
        if (gc > 0 || yc > 0 || mc > 0) parts.push(`Google: ${gc}件, Yahoo: ${yc}件` + (mc > 0 ? `, Meta: ${mc}件` : ""));
        if (meta.meta_account_id && !meta.meta_error) parts.push("MetaID: " + meta.meta_account_id);
        if (meta.meta_error) parts.push("Meta エラー: " + meta.meta_error);
        if (meta.google_customer_id) parts.push("GoogleID: " + meta.google_customer_id);
        if (meta.yahoo_account_id) parts.push("YahooID: " + meta.yahoo_account_id);
        badgeEl.title = parts.length > 0 ? parts.join("\n") : (badgeEl.title || "API連携状態");
      }
      if (meta.meta_error && meta.meta_account_id) {
        lastReportHint = lastReportHint ? lastReportHint + " [Meta: " + meta.meta_error + "]" : "Meta: " + meta.meta_error;
        const ar = document.getElementById("alert-row");
        if (ar) {
          ar.innerHTML = '<div class="alert-item bad"><span class="alert-icon">⚠</span><span>Meta: ' + escapeHtml(meta.meta_error) + ' — .env に META_ACCESS_TOKEN を追加するか、設定を確認してください。</span></div>';
          ar.style.display = "flex";
        }
      } else if (meta.meta_account_id && meta.meta_row_count === 0) {
        const ar = document.getElementById("alert-row");
        if (ar) {
          ar.innerHTML = '<div class="alert-item warn"><span class="alert-icon">ℹ</span><span>Meta: 指定期間のデータが0件です。.env の META_ACCESS_TOKEN が正しいか、設定の「Meta レポート診断」で確認してください。</span></div>';
          ar.style.display = "flex";
        }
      } else {
        const ar = document.getElementById("alert-row");
        if (ar) ar.style.display = "none";
      }
      updateTrendChart(adsDailyRows);
      return { adRows: safeAdRows, assetRows: safeAssetRows, dailyRows: adsDailyRows };
    } catch (e) {
      if (timeoutId) clearTimeout(timeoutId);
      if (e.name === "AbortError") throw e;
      _lastParseAdCount = -1;
      console.warn("ads load failed", e);
      throw e;
    }
  }

  function updateOverviewFromData() {
    const selMedia = getSelectedMedia();
    const dataForOverview = selMedia ? adsData.filter((r) => {
      const m = r.media || "";
      return m === selMedia || (selMedia === "Yahoo広告" && /Yahoo/i.test(m));
    }) : adsData;
    const mediaDataFiltered = selMedia ? mediaData.filter((m) => m.name === selMedia || (selMedia === "Yahoo広告" && /Yahoo/i.test(m.name))) : mediaData;

    const tbody = document.getElementById("overview-media-tbody");
    const kpiCost = $("kpi-cost");
    const kpiCv = $("kpi-cv");
    const kpiCpa = $("kpi-cpa");
    const kpiRevenue = $("kpi-revenue");
    const kpiRoas = $("kpi-roas");
    const kpiLtv = $("kpi-ltv");
    ["kpi-cost-delta", "kpi-cpa-delta", "kpi-revenue-delta", "kpi-roas-delta", "kpi-ltv-delta"].forEach((id) => {
      const el = $(id);
      if (el) el.textContent = "—";
    });
    if (adsData.length === 0) {
      if (kpiCost) kpiCost.textContent = "—";
      if (kpiCv) kpiCv.textContent = "—";
      if (kpiCpa) kpiCpa.textContent = "—";
      if (kpiRevenue) kpiRevenue.textContent = "—";
      if (kpiRoas) kpiRoas.textContent = "—";
      if (kpiLtv) kpiLtv.textContent = "—";
      if (tbody) tbody.innerHTML = '<tr class="empty-row"><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;white-space:pre-wrap">' + escapeHtml(getEmptyMessage()) + '</td></tr>';
      const ar = document.getElementById("alert-row");
      if (ar) ar.style.display = "none";
      refreshMediaFilter();
      refreshCampaignTable();
      refreshAreaTable();
      refreshHourTable();
      refreshHeatmap();
      refreshMediaCards();
      refreshCreativeTab();
      refreshKeywordTab();
      updateTrendChart(adsDailyRows);
      return;
    }
    let cost = 0,
      cv = 0;
    dataForOverview.forEach((r) => {
      cost += Number(r.cost) || 0;
      cv += Number(r.conversions) || 0;
    });
    const cpa = cv > 0 ? Math.round(cost / cv) : 0;
    const revenue = cv * 35000;
    const roas = cost > 0 ? (revenue / cost).toFixed(1) : 0;

    if (kpiCost) kpiCost.textContent = "¥" + cost.toLocaleString();
    if (kpiCv) kpiCv.textContent = cv;
    if (kpiCpa) kpiCpa.textContent = "¥" + cpa.toLocaleString();
    if (kpiRevenue) kpiRevenue.textContent = "¥" + revenue.toLocaleString();
    if (kpiRoas) kpiRoas.textContent = roas;

    if (tbody && mediaDataFiltered.length > 0) {
        const mediaStyles = {
        "Google Ads": { bg: "#eef3fe", color: "#2a5cdb", dot: "#4285f4" },
        "Yahoo広告": { bg: "#fff0f0", color: "#cc2c2c", dot: "#ff0033" },
        "Microsoft Advertising": { bg: "#e8f5e9", color: "#107c10", dot: "#107c10" },
        "Meta": { bg: "#eef3fe", color: "#1877f2", dot: "#1877f2" },
      };
      tbody.innerHTML = mediaDataFiltered
        .map((m) => {
          const s = mediaStyles[m.name] || { bg: "#f0ede6", color: "#666", dot: "#666" };
          const cpaBadge = m.cpa <= 8000 ? '<span class="goal-badge goal-ok">目標内</span>' : '<span class="goal-badge goal-over">+' + Math.round(((m.cpa - 8000) / 8000) * 100) + "%</span>";
          const cpaCls = m.cpa <= 8000 ? "perf-good" : m.cpa <= 12000 ? "perf-warn" : "perf-bad";
          const roasCls = m.roas >= 3.5 ? "perf-good" : m.roas >= 2.5 ? "" : "perf-bad";
          return `<tr>
            <td><span class="tag-media" style="background:${s.bg};color:${s.color}"><span style="width:7px;height:7px;border-radius:50%;background:${s.dot};display:inline-block"></span>${escapeHtml(m.name)}</span></td>
            <td>¥${m.cost.toLocaleString()}</td><td>${m.cv}</td>
            <td class="${cpaCls}">¥${m.cpa.toLocaleString()} ${cpaBadge}</td>
            <td class="${roasCls}">${m.roas}</td><td>${m.ctr}</td><td>${m.imp.toLocaleString()}</td>
          </tr>`;
        })
        .join("");
    } else if (tbody) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;white-space:pre-wrap">' + escapeHtml(getEmptyMessage()) + '</td></tr>';
    }
    refreshMediaFilter();
    refreshCampaignTable();
    refreshAreaTable();
    refreshHourTable();
    refreshHeatmap();
    refreshMediaCards();
    refreshCreativeTab();
    refreshKeywordTab();
    updateTrendChart(adsDailyRows);
  }

  let keywordSortKey = "cost";
  let keywordSortDir = -1; // -1 = desc, 1 = asc (default: cost desc)

  function refreshKeywordTab() {
    const selMedia = getSelectedMedia();
    const hasKeywordData = (m) => isYahooMedia(m) || isMetaMedia(m);
    if (selMedia && !hasKeywordData(selMedia)) {
      const tbody = document.getElementById("keyword-tbody");
      const countEl = document.getElementById("keyword-count");
      if (tbody) tbody.innerHTML = '<tr class="empty-row"><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">この媒体ではデータがありません（キーワードはYahoo広告・Meta対応）</td></tr>';
      if (countEl) countEl.textContent = "—";
      return;
    }
    const tbody = document.getElementById("keyword-tbody");
    const countEl = document.getElementById("keyword-count");
    const searchInput = document.getElementById("keyword-search");
    const searchQ = (searchInput && searchInput.value || "").trim().toLowerCase();
    let rows = Array.isArray(adsKeywordRows) ? adsKeywordRows : [];
    if (selMedia) {
      rows = rows.filter((r) => (r.media && r.media === selMedia) || (!r.media && isYahooMedia(selMedia)));
    }
    const filtered = searchQ
      ? rows.filter((r) => String(r.keyword || "").toLowerCase().includes(searchQ))
      : [...rows];
    const sorted = [...filtered].sort((a, b) => {
      let va, vb;
      if (keywordSortKey === "ctr") {
        va = (a.impressions || 0) > 0 ? ((a.clicks || 0) / (a.impressions || 1)) * 100 : 0;
        vb = (b.impressions || 0) > 0 ? ((b.clicks || 0) / (b.impressions || 1)) * 100 : 0;
      } else if (keywordSortKey === "cpa") {
        va = (a.conversions || 0) > 0 ? (a.cost || 0) / (a.conversions || 1) : 0;
        vb = (b.conversions || 0) > 0 ? (b.cost || 0) / (b.conversions || 1) : 0;
      } else {
        va = a[keywordSortKey] ?? 0;
        vb = b[keywordSortKey] ?? 0;
      }
      if (typeof va === "string") return keywordSortDir * String(va).localeCompare(String(vb), "ja");
      return keywordSortDir * (Number(va) - Number(vb));
    });
    const displayCount = 100;
    const displayed = sorted.slice(0, displayCount);
    const total = filtered.length;
    if (countEl) countEl.textContent = total > 0 ? `全 ${total.toLocaleString()} 件中 ${Math.min(displayCount, total).toLocaleString()} 件表示` : "—";
    if (!tbody) return;
    if (displayed.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">データがありません</td></tr>';
      return;
    }
    tbody.innerHTML = displayed
      .map((r) => {
        const imp = Number(r.impressions) || 0;
        const clicks = Number(r.clicks) || 0;
        const cost = Number(r.cost) || 0;
        const cv = Number(r.conversions) || 0;
        const ctr = imp > 0 ? ((clicks / imp) * 100).toFixed(1) + "%" : "0%";
        const cpa = cv > 0 ? Math.round(cost / cv) : 0;
        const avgCpc = Number(r.avgCpc) || 0;
        return `<tr>
          <td>${escapeHtml(r.keyword || "—")}</td>
          <td>${escapeHtml(r.campaign || "—")}</td>
          <td>¥${cost.toLocaleString()}</td>
          <td>${imp.toLocaleString()}</td>
          <td>${ctr}</td>
          <td>${cv}</td>
          <td>¥${cpa.toLocaleString()}</td>
          <td>¥${avgCpc.toLocaleString()}</td>
        </tr>`;
      })
      .join("");
  }

  function refreshCreativeTab(overrideAdRows, overrideAssetRows) {
    const selMedia = getSelectedMedia();
    if (selMedia && !hasCreativeData(selMedia)) {
      const adTbody = document.getElementById("creative-ad-tbody");
      const assetTbody = document.getElementById("creative-asset-tbody");
      const msg = '<tr class="empty-row"><td colspan="9" style="text-align:center;color:var(--text-muted);padding:24px">この媒体ではデータがありません（クリエイティブはYahoo広告・Meta対応）</td></tr>';
      const msgAsset = '<tr class="empty-row"><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">この媒体ではデータがありません（クリエイティブはYahoo広告・Meta対応）</td></tr>';
      if (adTbody) adTbody.innerHTML = msg;
      if (assetTbody) assetTbody.innerHTML = msgAsset;
      const diagEl = document.getElementById("creative-diagnostic");
      if (diagEl) diagEl.style.display = "none";
      return;
    }
    let adRowsSource = Array.isArray(overrideAdRows) && overrideAdRows.length > 0 ? overrideAdRows : (Array.isArray(adsAdRows) ? adsAdRows : []);
    let assetRowsSource = Array.isArray(overrideAssetRows) && overrideAssetRows.length > 0 ? overrideAssetRows : (Array.isArray(adsAssetRows) ? adsAssetRows : []);
    if (selMedia) {
      adRowsSource = adRowsSource.filter((r) => (r.media && r.media === selMedia) || (!r.media && isYahooMedia(selMedia)));
      assetRowsSource = assetRowsSource.filter((r) => (r.media && r.media === selMedia) || (!r.media && isYahooMedia(selMedia)));
    }
    const debugJson = document.getElementById("creative-debug-json");
    const showDebug = /creative_debug=1/.test(location.search);
    if (debugJson) {
      debugJson.style.display = showDebug ? "block" : "none";
      if (showDebug) {
        debugJson.textContent = "refreshCreativeTab: adRows=" + (Array.isArray(adRowsSource) ? adRowsSource.length : "?") + " 件";
        if (adRowsSource?.length > 0) debugJson.textContent += "\n先頭: " + JSON.stringify(adRowsSource[0], null, 2).slice(0, 300);
      }
    }
    const diagEl = document.getElementById("creative-diagnostic");
    if (diagEl) {
      const hasError = lastCreativeDiagnostic && (lastCreativeDiagnostic.adError || lastCreativeDiagnostic.assetError);
      const isEmpty = adRowsSource.length === 0 && assetRowsSource.length === 0;
      if (hasError || isEmpty) {
        diagEl.style.display = "block";
        const parts = [];
        if (lastCreativeDiagnostic?.adError) parts.push("AD: " + lastCreativeDiagnostic.adError);
        if (lastCreativeDiagnostic?.assetError) parts.push("Asset: " + lastCreativeDiagnostic.assetError);
        if (parts.length) {
          diagEl.textContent = "【Yahoo API エラー】\n" + parts.join("\n");
        } else {
          const rawAd = lastCreativeDiagnostic?.adRawCount ?? "?";
          const parsedAd = lastCreativeDiagnostic?.adParsedCount ?? adRowsSource.length;
          const rawAsset = lastCreativeDiagnostic?.assetRawCount ?? "?";
          const parsedAsset = lastCreativeDiagnostic?.assetParsedCount ?? assetRowsSource.length;
          const memAd = Array.isArray(adRowsSource) ? adRowsSource.length : "?";
          const backupAd = lastReportAdRows.length;
          const fb = lastFallbackCreative ? " フォールバックad=" + (lastFallbackCreative.ad || 0) + " asset=" + (lastFallbackCreative.asset || 0) : "";
          const hasYahoo = (connectedMediaFromStatus || []).some((m) => /yahoo/i.test(m || ""));
          diagEl.textContent = "【取得状況】\n"
            + "前回APIパース時adRows=" + _lastParseAdCount + " | メモリadsAdRows=" + memAd + " | lastReportAdRows=" + backupAd + "\n"
            + "AD: Yahoo生=" + rawAd + " → パース後=" + parsedAd + (backupAd > 0 ? " バックアップ=" + backupAd : "") + fb + " 件\n"
            + "Asset: Yahoo生=" + rawAsset + " → パース後=" + parsedAsset + " 件\n"
            + (!hasYahoo ? "※クリエイティブタブはYahoo広告連携が必要です。API設定でYahooを連携してください。\n" : "")
            + (lastFallbackCreative ? "※フォールバック取得済み。表示されない場合はブラウザをハードリロード(Ctrl+Shift+R)してください。" : "※ターミナルで [Ads] クリエイティブフォールバック を確認してください。");
        }
      } else {
        diagEl.style.display = "none";
      }
    }
    const adTbody = document.getElementById("creative-ad-tbody");
    const assetTbody = document.getElementById("creative-asset-tbody");
    if (adTbody) {
      let rowsToRender = adRowsSource.length > 0 ? adRowsSource : (lastReportAdRows.length > 0 ? lastReportAdRows : []);
      if (rowsToRender.length === 0) {
        adTbody.innerHTML = '<tr class="empty-row"><td colspan="9" style="text-align:center;color:var(--text-muted);padding:24px">データがありません</td></tr>';
      } else {
        try {
          const sortedAd = [...rowsToRender].sort((a, b) => {
            let va, vb;
            if (creativeAdSortKey === "ctr") {
              const impA = Number(a.impressions) || 0;
              const impB = Number(b.impressions) || 0;
              va = impA > 0 ? ((a.clicks || 0) / impA) * 100 : 0;
              vb = impB > 0 ? ((b.clicks || 0) / impB) * 100 : 0;
            } else if (creativeAdSortKey === "cpa") {
              const cvA = Number(a.conversions) || 0;
              const cvB = Number(b.conversions) || 0;
              va = cvA > 0 ? (Number(a.cost) || 0) / cvA : 0;
              vb = cvB > 0 ? (Number(b.cost) || 0) / cvB : 0;
            } else if (creativeAdSortKey === "roas") {
              const cA = Number(a.cost) || 0;
              const cB = Number(b.cost) || 0;
              va = cA > 0 ? ((Number(a.conversions) || 0) * 35000) / cA : 0;
              vb = cB > 0 ? ((Number(b.conversions) || 0) * 35000) / cB : 0;
            } else {
              va = a[creativeAdSortKey] ?? "";
              vb = b[creativeAdSortKey] ?? "";
            }
            if (typeof va === "string") return creativeAdSortDir * String(va).localeCompare(String(vb), "ja");
            return creativeAdSortDir * (Number(va) - Number(vb));
          });
          adTbody.innerHTML = sortedAd.map((r) => {
            const imp = Number(r.impressions) || 0;
            const clicks = Number(r.clicks) || 0;
            const cost = Number(r.cost) || 0;
            const cv = Number(r.conversions) || 0;
            const ctr = imp > 0 ? ((clicks / imp) * 100).toFixed(1) + "%" : "0%";
            const cpa = cv > 0 ? Math.round(cost / cv) : 0;
            const roas = cost > 0 ? ((cv * 35000) / cost).toFixed(1) : "0";
            return `<tr>
              <td>${escapeHtml(String(r.campaign ?? "—"))}</td>
              <td>${escapeHtml(String(r.adGroup ?? "—"))}</td>
              <td>${escapeHtml(String(r.adName ?? "—"))}</td>
              <td>¥${cost.toLocaleString()}</td>
              <td>${imp.toLocaleString()}</td>
              <td>${ctr}</td>
              <td>${cv}</td>
              <td>¥${cpa.toLocaleString()}</td>
              <td>${roas}</td>
            </tr>`;
          }).join("");
        } catch (err) {
          console.error("[Ads] クリエイティブAD描画エラー:", err, "rowsToRender.length=" + rowsToRender.length);
          adTbody.innerHTML = '<tr class="empty-row"><td colspan="9" style="text-align:center;color:var(--bad);padding:24px">描画エラー: ' + escapeHtml(String(err.message || err)) + '</td></tr>';
        }
      }
    }
    if (assetTbody) {
      if (assetRowsSource.length === 0) {
        assetTbody.innerHTML = '<tr class="empty-row"><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">データがありません</td></tr>';
      } else {
        const assetTypeLabel = (t) => {
          const s = String(t || "").toUpperCase();
          if (s === "HEADLINE") return "見出し";
          if (s === "DESCRIPTION") return "説明文";
          return t || "—";
        };
        const sortedAsset = [...assetRowsSource].sort((a, b) => {
          const va = a[creativeAssetSortKey] ?? "";
          const vb = b[creativeAssetSortKey] ?? "";
          if (typeof va === "string") return creativeAssetSortDir * String(va).localeCompare(String(vb), "ja");
          return creativeAssetSortDir * (Number(va) - Number(vb));
        });
        assetTbody.innerHTML = sortedAsset.map((r) => {
          const imp = Number(r.impressions) || 0;
          const clicks = Number(r.clicks) || 0;
          const cost = Number(r.cost) || 0;
          return `<tr>
            <td>${escapeHtml(r.campaign || "—")}</td>
            <td>${escapeHtml(r.adGroup || "—")}</td>
            <td>${escapeHtml((r.assetText || "—").slice(0, 80))}${(r.assetText || "").length > 80 ? "…" : ""}</td>
            <td>${escapeHtml(assetTypeLabel(r.assetType))}</td>
            <td>${imp.toLocaleString()}</td>
            <td>${clicks.toLocaleString()}</td>
            <td>¥${cost.toLocaleString()}</td>
          </tr>`;
        }).join("");
      }
    }
  }

  let creativeAdSortKey = "cost";
  let creativeAdSortDir = -1;
  let creativeAssetSortKey = "impressions";
  let creativeAssetSortDir = -1;

  let areaSortKey = "cost";
  let areaSortDir = -1;

  function refreshAreaTable() {
    const tbody = document.getElementById("area-tbody");
    if (!tbody) return;
    const selMedia = getSelectedMedia();
    if (selMedia && !hasAreaOrHourData(selMedia)) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">この媒体ではデータがありません（エリア別はYahoo広告・Meta対応）</td></tr>';
      return;
    }
    const areaRowsFiltered = selMedia
      ? adsAreaRows.filter((r) => (r.media && r.media === selMedia) || (!r.media && isYahooMedia(selMedia)))
      : adsAreaRows;
    if (areaRowsFiltered.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">データがありません</td></tr>';
      return;
    }
    const totalCost = areaRowsFiltered.reduce((a, r) => a + (Number(r.cost) || 0), 0);
    const sorted = [...areaRowsFiltered].sort((a, b) => {
      let va, vb;
      if (areaSortKey === "cpa") {
        const cvA = Number(a.conversions) || 0;
        const cvB = Number(b.conversions) || 0;
        va = cvA > 0 ? (Number(a.cost) || 0) / cvA : 0;
        vb = cvB > 0 ? (Number(b.cost) || 0) / cvB : 0;
      } else if (areaSortKey === "roas") {
        const cA = Number(a.cost) || 0;
        const cB = Number(b.cost) || 0;
        va = cA > 0 ? ((Number(a.conversions) || 0) * 35000) / cA : 0;
        vb = cB > 0 ? ((Number(b.conversions) || 0) * 35000) / cB : 0;
      } else if (areaSortKey === "revenue") {
        va = (Number(a.conversions) || 0) * 35000;
        vb = (Number(b.conversions) || 0) * 35000;
      } else {
        va = a[areaSortKey] ?? 0;
        vb = b[areaSortKey] ?? 0;
      }
      if (typeof va === "string") return areaSortDir * String(va).localeCompare(String(vb), "ja");
      return areaSortDir * (Number(va) - Number(vb));
    });
    tbody.innerHTML = sorted
      .map((r) => {
        const c = Number(r.cost) || 0;
        const cv = Number(r.conversions) || 0;
        const cpa = cv > 0 ? Math.round(c / cv) : 0;
        const revenue = cv * 35000;
        const roas = c > 0 ? (revenue / c).toFixed(1) : "0";
        const pct = totalCost > 0 ? ((c / totalCost) * 100).toFixed(1) + "%" : "0%";
        return `<tr>
          <td>${escapeHtml(r.pref || r.campaign || "—")}</td>
          <td>¥${c.toLocaleString()}</td>
          <td>${cv}</td>
          <td>¥${cpa.toLocaleString()}</td>
          <td>${roas}</td>
          <td>¥${revenue.toLocaleString()}</td>
          <td>${pct}</td>
        </tr>`;
      })
      .join("");
  }

  function refreshHourTable() {
    const tbody = document.getElementById("time-tbody");
    if (!tbody) return;
    const selMedia = getSelectedMedia();
    if (selMedia && !hasAreaOrHourData(selMedia)) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px">この媒体ではデータがありません（時間帯別はYahoo広告・Meta対応）</td></tr>';
      return;
    }
    const hourRowsFiltered = selMedia
      ? adsHourRows.filter((r) => (r.media && r.media === selMedia) || (!r.media && isYahooMedia(selMedia)))
      : adsHourRows;
    if (hourRowsFiltered.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px">データがありません</td></tr>';
      return;
    }
    tbody.innerHTML = hourRowsFiltered
      .map((r) => {
        const c = Number(r.cost) || 0;
        const cv = Number(r.conversions) || 0;
        const cpa = cv > 0 ? Math.round(c / cv) : 0;
        const roas = c > 0 ? ((cv * 35000) / c).toFixed(1) : "0";
        const label = `${r.hourOfDay || "—"}時 ${r.dayOfWeek || ""}`.trim();
        return `<tr>
          <td>${escapeHtml(label)}</td>
          <td>¥${c.toLocaleString()}</td>
          <td>${cv}</td>
          <td>¥${cpa.toLocaleString()}</td>
          <td>${roas}</td>
        </tr>`;
      })
      .join("");
  }

  function refreshHeatmap() {
    const hmDiv = document.getElementById("heatmap");
    const legendBar = document.getElementById("hm-legend-bar");
    if (!hmDiv) return;
    const selMedia = getSelectedMedia();
    if (selMedia && !hasAreaOrHourData(selMedia)) {
      hmDiv.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:32px">この媒体ではデータがありません（ヒートマップはYahoo広告・Meta対応）</div>';
      if (legendBar) legendBar.innerHTML = "";
      return;
    }
    const hourRowsForHeatmap = selMedia
      ? adsHourRows.filter((r) => (r.media && r.media === selMedia) || (!r.media && isYahooMedia(selMedia)))
      : adsHourRows;
    const days = ["月", "火", "水", "木", "金", "土", "日"];
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const cvMap = {};
    hourRowsForHeatmap.forEach((r) => {
      const h = parseInt(r.hourOfDay, 10);
      let d = parseInt(r.dayOfWeek, 10);
      if (Number.isNaN(h) || h < 0 || h > 23) return;
      if (Number.isNaN(d)) d = 0;
      if (d === 0) d = 6;
      else d -= 1;
      if (d < 0 || d > 6) return;
      const key = `${d}_${h}`;
      cvMap[key] = (cvMap[key] || 0) + (Number(r.conversions) || 0);
    });
    function cvData(d, h) {
      return cvMap[`${d}_${h}`] || 0;
    }
    const allVals = days.flatMap((_, d) => hours.map((h) => cvData(d, h)));
    const maxVal = Math.max(1, ...allVals);
    const colors = (v) => {
      const t = v / maxVal;
      if (t < 0.15) return "#f0ede6";
      if (t < 0.3) return "#d4e8fc";
      if (t < 0.5) return "#93c5fd";
      if (t < 0.7) return "#3b82f6";
      if (t < 0.85) return "#1d4ed8";
      return "#1e3a8a";
    };
    let html = '<div class="heatmap-grid"><div></div>';
    hours.forEach((h) => {
      html += `<div class="heatmap-header">${h}</div>`;
    });
    days.forEach((day, d) => {
      html += `<div class="heatmap-row-label">${day}</div>`;
      hours.forEach((h) => {
        const v = cvData(d, h);
        const c = colors(v);
        html += `<div class="hm-cell" style="background:${c}" data-tip="${day}曜 ${h}時 CV:${v}" onmouseenter="window.adsShowTip(event,this.dataset.tip)" onmouseleave="window.adsHideTip()"></div>`;
      });
    });
    html += "</div>";
    hmDiv.innerHTML = html;
    if (legendBar) {
      legendBar.innerHTML = "";
      ["#f0ede6", "#d4e8fc", "#93c5fd", "#3b82f6", "#1d4ed8", "#1e3a8a"].forEach((c) => {
        legendBar.innerHTML += `<div class="hm-legend-step" style="background:${c}"></div>`;
      });
    }
  }

  function getSelectedMedia() {
    const sel = document.getElementById("media-filter");
    return sel && sel.value ? sel.value.trim() : "";
  }

  function isYahooMedia(media) {
    return !media || /Yahoo/i.test(media);
  }
  function isMetaMedia(media) {
    return media && /^Meta$/i.test(media);
  }
  function hasAreaOrHourData(media) {
    return isYahooMedia(media) || isMetaMedia(media);
  }
  function hasCreativeData(media) {
    return isYahooMedia(media) || isMetaMedia(media);
  }

  function getFilteredMediaData() {
    const selMedia = getSelectedMedia();
    if (!selMedia) return mediaData;
    return mediaData.filter((m) => m.name === selMedia || (selMedia === "Yahoo広告" && /Yahoo/i.test(m.name)));
  }

  const MEDIA_DISPLAY_ORDER = ["Yahoo広告", "Meta", "Google Ads", "Microsoft Advertising", "X (Twitter)", "LINE"];
  function normalizeMediaName(name) {
    if (!name) return "";
    if (/Yahoo/i.test(name)) return "Yahoo広告";
    return name;
  }
  function refreshMediaFilter() {
    const sel = document.getElementById("media-filter");
    if (!sel) return;
    const selected = normalizeMediaName(sel.value) || sel.value;
    sel.innerHTML = '<option value="">媒体：ALL</option>';
    const seen = new Set();
    const fromStatus = (connectedMediaFromStatus || []).map(normalizeMediaName).filter(Boolean);
    const fromData = (mediaData || []).map((m) => normalizeMediaName(m.name)).filter(Boolean);
    if (lastReportMeta?.google_customer_id && !fromStatus.includes("Google Ads") && !fromData.includes("Google Ads")) {
      fromData.push("Google Ads");
    }
    const ordered = [];
    for (const name of MEDIA_DISPLAY_ORDER) {
      if ((fromStatus.includes(name) || fromData.includes(name)) && !seen.has(name)) {
        seen.add(name);
        ordered.push(name);
      }
    }
    for (const name of [...fromStatus, ...fromData]) {
      if (!seen.has(name)) { seen.add(name); ordered.push(name); }
    }
    ordered.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      if (opt.value === selected) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  let campaignSortKey = "cost";
  let campaignSortDir = -1;

  function refreshCampaignTable() {
    const tbody = document.getElementById("campaign-tbody");
    if (!tbody) return;
    const selMedia = getSelectedMedia();
    const sel = document.getElementById("campaign-media-filter");
    if (sel) {
      const currentVal = normalizeMediaName(sel.value) || sel.value;
      sel.innerHTML = '<option value="">すべての媒体</option>';
      const seen = new Set();
      const fromStatus = (connectedMediaFromStatus || []).map(normalizeMediaName).filter(Boolean);
      const fromData = (mediaData || []).map((m) => normalizeMediaName(m.name)).filter(Boolean);
      if (lastReportMeta?.google_customer_id && !fromData.includes("Google Ads")) fromData.push("Google Ads");
      const ordered = [];
      for (const name of MEDIA_DISPLAY_ORDER) {
        if ((fromStatus.includes(name) || fromData.includes(name)) && !seen.has(name)) { seen.add(name); ordered.push(name); }
      }
      for (const name of [...fromStatus, ...fromData]) {
        if (!seen.has(name)) { seen.add(name); ordered.push(name); }
      }
      ordered.forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        if (name === selMedia || name === currentVal) opt.selected = true;
        sel.appendChild(opt);
      });
    }
    const campaignData = selMedia ? adsData.filter((r) => {
      const m = r.media || "";
      return m === selMedia || (selMedia === "Yahoo広告" && /Yahoo/i.test(m));
    }) : adsData;
    const mediaStyles = {
      "Google Ads": { bg: "#eef3fe", color: "#2a5cdb" },
      "Yahoo広告": { bg: "#fff0f0", color: "#cc2c2c" },
      "Microsoft Advertising": { bg: "#e8f5e9", color: "#107c10" },
      "Meta": { bg: "#eef3fe", color: "#1877f2" },
    };
    if (campaignData.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px;white-space:pre-wrap">' + escapeHtml(adsData.length === 0 ? getEmptyMessage() : "この媒体のデータがありません") + '</td></tr>';
      return;
    }
    const sorted = [...campaignData].sort((a, b) => {
      let va, vb;
      if (campaignSortKey === "ctr") {
        const impA = Number(a.impressions) || 0;
        const impB = Number(b.impressions) || 0;
        va = impA > 0 ? ((a.clicks || 0) / impA) * 100 : 0;
        vb = impB > 0 ? ((b.clicks || 0) / impB) * 100 : 0;
      } else if (campaignSortKey === "cpa") {
        const cvA = Number(a.conversions) || 0;
        const cvB = Number(b.conversions) || 0;
        va = cvA > 0 ? (Number(a.cost) || 0) / cvA : 0;
        vb = cvB > 0 ? (Number(b.cost) || 0) / cvB : 0;
      } else if (campaignSortKey === "roas") {
        const cA = Number(a.cost) || 0;
        const cB = Number(b.cost) || 0;
        va = cA > 0 ? ((Number(a.conversions) || 0) * 35000) / cA : 0;
        vb = cB > 0 ? ((Number(b.conversions) || 0) * 35000) / cB : 0;
      } else {
        va = a[campaignSortKey] ?? 0;
        vb = b[campaignSortKey] ?? 0;
      }
      if (typeof va === "string") return campaignSortDir * String(va).localeCompare(String(vb), "ja");
      return campaignSortDir * (Number(va) - Number(vb));
    });
    tbody.innerHTML = sorted
      .map((r) => {
        const ctr = r.impressions > 0 ? ((r.clicks || 0) / r.impressions * 100).toFixed(1) + "%" : "0%";
        const cpa = (r.conversions || 0) > 0 ? Math.round((r.cost || 0) / r.conversions) : 0;
        const roas = (r.cost || 0) > 0 ? ((r.conversions || 0) * 35000 / (r.cost || 1)).toFixed(1) : "0";
        const s = mediaStyles[r.media] || { bg: "#f0ede6", color: "#666" };
        return `<tr>
          <td>${escapeHtml(r.campaign || "—")}</td>
          <td><span class="tag-media" style="background:${s.bg};color:${s.color}">${escapeHtml(r.media || "—")}</span></td>
          <td>¥${(r.cost || 0).toLocaleString()}</td>
          <td>${(r.impressions || 0).toLocaleString()}</td>
          <td>${ctr}</td>
          <td>${r.conversions || 0}</td>
          <td>¥${cpa.toLocaleString()}</td>
          <td>${roas}</td>
        </tr>`;
      })
      .join("");
  }

  window.downloadExcel = function () {
    if (typeof XLSX === "undefined") {
      alert("Excel ライブラリが読み込まれていません");
      return;
    }
    const wb = XLSX.utils.book_new();
    const params = getReportParams();
    let period = "—";
    if (params) {
      if (params.month) {
        const [y, m] = params.month.split("-").map(Number);
        period = `${y}年${m}月`;
      } else if (params.startDate && params.endDate) {
        period = `${params.startDate} 〜 ${params.endDate}`;
      }
    }
    const today = new Date().toISOString().slice(0, 10);

    const sHeader = {
      font: { name: "Arial", bold: true, sz: 9, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "1A2A4A" } },
      alignment: { horizontal: "center", vertical: "center" },
    };
    const sBody = {
      font: { name: "Arial", sz: 9 },
      alignment: { horizontal: "center", vertical: "center" },
      border: {
        top: { style: "thin", color: { rgb: "E8E6E0" } },
        bottom: { style: "thin", color: { rgb: "E8E6E0" } },
        left: { style: "thin", color: { rgb: "E8E6E0" } },
        right: { style: "thin", color: { rgb: "E8E6E0" } },
      },
    };
    const sBodyL = { ...sBody, alignment: { horizontal: "left", vertical: "center" } };
    const sTotal = {
      font: { name: "Arial", sz: 10, bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "1A2A4A" } },
      alignment: { horizontal: "center" },
    };

    function cell(v, s) {
      return { v, s, t: typeof v === "number" ? "n" : "s" };
    }

    const totalCost = adsData.reduce((a, r) => a + (r.cost || 0), 0);
    const totalCv = adsData.reduce((a, r) => a + (r.conversions || 0), 0);
    const cpa = totalCv > 0 ? Math.round(totalCost / totalCv) : 0;
    const revenue = totalCv * 35000;
    const roas = totalCost > 0 ? (revenue / totalCost).toFixed(1) : "—";
    const kpiData = [
      [{ v: "ADs Dashboard — KPIサマリー", s: { font: { name: "Arial", bold: true, sz: 14, color: { rgb: "1A2A4A" } }, alignment: { horizontal: "left" } } }, "", "", "", "", ""],
      [{ v: `期間：${period}　出力日：${today}`, s: { font: { name: "Arial", sz: 9, color: { rgb: "A09E99" } }, alignment: { horizontal: "left" } } }, "", "", "", "", ""],
      ["", "", "", "", "", ""],
      [cell("指標", sHeader), cell("値", sHeader), cell("前期比", sHeader), cell("目標", sHeader), cell("達成状況", sHeader), cell("備考", sHeader)],
      [cell("広告費", sBodyL), cell(totalCost, sBody), cell("—", sBody), cell("—", sBody), cell("—", sBody), cell("", sBody)],
      [cell("CV", sBodyL), cell(totalCv, sBody), cell("—", sBody), cell("—", sBody), cell("—", sBody), cell("", sBody)],
      [cell("CPA", sBodyL), cell(cpa, sBody), cell("—", sBody), cell("—", sBody), cell("—", sBody), cell("", sBody)],
      [cell("売上", sBodyL), cell(revenue, sBody), cell("—", sBody), cell("—", sBody), cell("—", sBody), cell("", sBody)],
      [cell("ROAS", sBodyL), cell(roas, sBody), cell("—", sBody), cell("—", sBody), cell("—", sBody), cell("", sBody)],
      [cell("LTV", sBodyL), cell("—", sBody), cell("—", sBody), cell("—", sBody), cell("—", sBody), cell("", sBody)],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(kpiData);
    ws1["!cols"] = [{ wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws1, "KPIサマリー");

    const mediaRows = [
      [{ v: "ADs Dashboard — 媒体別パフォーマンス", s: { font: { name: "Arial", bold: true, sz: 14, color: { rgb: "1A2A4A" } }, alignment: { horizontal: "left" } } }, "", "", "", "", "", ""],
      [{ v: `期間：${period}　出力日：${today}`, s: { font: { name: "Arial", sz: 9, color: { rgb: "A09E99" } }, alignment: { horizontal: "left" } } }, "", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      [cell("媒体", sHeader), cell("広告費", sHeader), cell("CV", sHeader), cell("CPA", sHeader), cell("ROAS", sHeader), cell("CTR", sHeader), cell("IMP", sHeader)],
    ];
    mediaData.forEach((m) => {
      mediaRows.push([
        cell(m.name, sBodyL),
        cell(m.cost, sBody),
        cell(m.cv, sBody),
        cell(m.cpa, sBody),
        cell(m.roas, sBody),
        cell(m.ctr || "0%", sBody),
        cell(m.imp || 0, sBody),
      ]);
    });
    const mediaTotalCost = mediaData.reduce((a, m) => a + m.cost, 0);
    const mediaTotalCv = mediaData.reduce((a, m) => a + m.cv, 0);
    mediaRows.push([
      cell("合計", sTotal),
      cell(mediaTotalCost, sTotal),
      cell(mediaTotalCv, sTotal),
      cell("—", sTotal),
      cell("—", sTotal),
      cell("—", sTotal),
      cell(mediaData.reduce((a, m) => a + (m.imp || 0), 0), sTotal),
    ]);
    const ws2 = XLSX.utils.aoa_to_sheet(mediaRows);
    ws2["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws2, "媒体別");

    const areaTotalCost = adsAreaRows.reduce((a, r) => a + (Number(r.cost) || 0), 0);
    const areaRows = [
      [{ v: "ADs Dashboard — エリア別パフォーマンス", s: { font: { name: "Arial", bold: true, sz: 14, color: { rgb: "1A2A4A" } }, alignment: { horizontal: "left" } } }, "", "", "", "", "", ""],
      [{ v: `期間：${period}　出力日：${today}`, s: { font: { name: "Arial", sz: 9, color: { rgb: "A09E99" } }, alignment: { horizontal: "left" } } }, "", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      [cell("エリア", sHeader), cell("広告費", sHeader), cell("CV", sHeader), cell("CPA", sHeader), cell("ROAS", sHeader), cell("売上", sHeader), cell("構成比", sHeader)],
      ...adsAreaRows.map((r) => {
        const c = Number(r.cost) || 0;
        const cv = Number(r.conversions) || 0;
        const cpa = cv > 0 ? Math.round(c / cv) : 0;
        const revenue = cv * 35000;
        const roas = c > 0 ? (revenue / c).toFixed(1) : "0";
        const pct = areaTotalCost > 0 ? ((c / areaTotalCost) * 100).toFixed(1) + "%" : "0%";
        return [cell(r.pref || r.campaign || "—", sBodyL), cell(c, sBody), cell(cv, sBody), cell(cpa, sBody), cell(roas, sBody), cell(revenue, sBody), cell(pct, sBody)];
      }),
    ];
    const ws3 = XLSX.utils.aoa_to_sheet(areaRows);
    ws3["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws3, "エリア別");

    const timeRows = [
      [{ v: "ADs Dashboard — 時間帯別パフォーマンス", s: { font: { name: "Arial", bold: true, sz: 14, color: { rgb: "1A2A4A" } }, alignment: { horizontal: "left" } } }, "", "", "", ""],
      [{ v: `期間：${period}　出力日：${today}`, s: { font: { name: "Arial", sz: 9, color: { rgb: "A09E99" } }, alignment: { horizontal: "left" } } }, "", "", "", ""],
      ["", "", "", "", ""],
      [cell("時間帯", sHeader), cell("広告費", sHeader), cell("CV", sHeader), cell("CPA", sHeader), cell("ROAS", sHeader)],
      ...adsHourRows.map((r) => {
        const c = Number(r.cost) || 0;
        const cv = Number(r.conversions) || 0;
        const cpa = cv > 0 ? Math.round(c / cv) : 0;
        const roas = c > 0 ? ((cv * 35000) / c).toFixed(1) : "0";
        const label = `${r.hourOfDay || "—"}時 ${r.dayOfWeek || ""}`.trim();
        return [cell(label, sBodyL), cell(c, sBody), cell(cv, sBody), cell(cpa, sBody), cell(roas, sBody)];
      }),
    ];
    const ws4 = XLSX.utils.aoa_to_sheet(timeRows);
    ws4["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws4, "時間帯別");

    const campRows = [
      [{ v: "ADs Dashboard — キャンペーン一覧", s: { font: { name: "Arial", bold: true, sz: 14, color: { rgb: "1A2A4A" } }, alignment: { horizontal: "left" } } }, "", "", "", "", "", "", ""],
      [{ v: `期間：${period}　出力日：${today}`, s: { font: { name: "Arial", sz: 9, color: { rgb: "A09E99" } }, alignment: { horizontal: "left" } } }, "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", ""],
      [cell("キャンペーン名", sHeader), cell("媒体", sHeader), cell("広告費", sHeader), cell("IMP", sHeader), cell("CTR", sHeader), cell("CV", sHeader), cell("CPA", sHeader), cell("ROAS", sHeader)],
    ];
    adsData.forEach((r) => {
      const ctr = r.impressions > 0 ? ((r.clicks || 0) / r.impressions * 100).toFixed(1) + "%" : "0%";
      const cpa = (r.conversions || 0) > 0 ? Math.round((r.cost || 0) / r.conversions) : 0;
      const roas = (r.cost || 0) > 0 ? ((r.conversions || 0) * 35000 / (r.cost || 1)).toFixed(1) : "0";
      campRows.push([
        cell(r.campaign || "—", sBodyL),
        cell(r.media || "—", sBody),
        cell(r.cost || 0, sBody),
        cell(r.impressions || 0, sBody),
        cell(ctr, sBody),
        cell(r.conversions || 0, sBody),
        cell(cpa, sBody),
        cell(parseFloat(roas), sBody),
      ]);
    });
    const ws5 = XLSX.utils.aoa_to_sheet(campRows);
    ws5["!cols"] = [{ wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 6 }, { wch: 12 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws5, "キャンペーン");

    const filename = `運用型広告レポート_${today}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  function handleOAuthResult() {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get("google_ads");
    const yahooLinked = params.get("yahoo_ads");
    const err = params.get("google_ads_error");
    const yahooErr = params.get("yahoo_ads_error");
    const refreshStatusAndOpenSettings = (tab) => {
      fetch("/api/ads/status", { credentials: "include" })
        .then(async (r) => parseJsonResponse(r, {}))
        .then((st) => {
          lastConnectionStatus = st;
          if (st.google?.customer_id) localStorage.setItem("google_ads_customer_id", st.google.customer_id);
          const conn = [];
          if (st.google?.connected) conn.push("Google Ads");
          if (st.yahoo?.connected) conn.push("Yahoo広告");
          if (st.microsoft?.connected) conn.push("Microsoft Advertising");
          connectedMediaFromStatus = conn;
          refreshMediaFilter();
          if (typeof openSettings === "function") openSettings(tab);
        })
        .catch(() => {});
    };
    if (linked === "auth_linked") {
      if (window.history.replaceState) window.history.replaceState({}, "", window.location.pathname);
      refreshStatusAndOpenSettings("google");
    }
    if (yahooLinked === "auth_linked") {
      if (window.history.replaceState) window.history.replaceState({}, "", window.location.pathname);
      refreshStatusAndOpenSettings("yahoo");
    }
    if (linked === "linked") {
      if (window.history.replaceState) window.history.replaceState({}, "", window.location.pathname);
      const badge = document.getElementById("badge-integrated");
      if (badge) {
        badge.textContent = "✓ Google Ads 連携済み";
        badge.classList.add("connected");
      }
      fetch("/api/ads/status", { credentials: "include" })
        .then(async (r) => parseJsonResponse(r, {}))
        .then((st) => {
          lastConnectionStatus = st;
          if (st.google?.customer_id) localStorage.setItem("google_ads_customer_id", st.google.customer_id);
          const conn = [];
          if (st.google?.connected) conn.push("Google Ads");
          if (st.yahoo?.connected) conn.push("Yahoo広告");
          if (st.microsoft?.connected) conn.push("Microsoft Advertising");
          connectedMediaFromStatus = conn;
          refreshMediaFilter();
        })
        .catch(() => {});
    }
    if (err) {
      if (window.history.replaceState) window.history.replaceState({}, "", window.location.pathname);
      alert("Google Ads 連携エラー: " + decodeURIComponent(err));
    }
    if (yahooErr) {
      if (window.history.replaceState) window.history.replaceState({}, "", window.location.pathname);
      alert("Yahoo広告 連携エラー: " + decodeURIComponent(yahooErr));
    }
  }

  function init() {
    initReportMonthSelect();
    switchPeriodTypeUI();
    handleOAuthResult();

    fetch("/api/ads/status", { credentials: "include" })
      .then(async (r) => parseJsonResponse(r, {}))
      .then((st) => {
        const connected = [];
        if (st.google?.connected) connected.push("Google Ads");
        if (st.yahoo?.connected) connected.push("Yahoo広告");
        if (st.microsoft?.connected) connected.push("Microsoft Advertising");
        const metaVals = JSON.parse(localStorage.getItem("api_meta") || "{}");
        if ((metaVals.ad_account_id || "").trim()) {
          connected.push("Meta");
          apiMedia[2].status = "connected";
        } else {
          apiMedia[2].status = "disconnected";
        }
        connectedMediaFromStatus = connected;
        refreshMediaFilter();
        const badge = document.getElementById("badge-integrated");
        if (!badge) return;
        badge.textContent = connected.length > 0 ? "✓ " + connected.join("・") + " 連携済み" : "未連携";
        badge.classList.toggle("connected", connected.length > 0);
      })
      .catch(() => {
        const badge = document.getElementById("badge-integrated");
        if (badge) {
          badge.textContent = "—";
          badge.classList.remove("connected");
        }
      });

    initCharts();

    let loadAdsDataDebounceTimer = null;
    loadAdsData({ trigger: "init" })
      .then((result) => {
        updateOverviewFromData();
        if (result?.adRows?.length > 0 || result?.assetRows?.length > 0) {
          refreshCreativeTab(result.adRows || adsAdRows, result.assetRows || adsAssetRows);
        }
        _creativeAutoFetchDone = false;
        runCreativeDiagnostic();
      })
      .catch((e) => {
        if (e?.name !== "AbortError") console.warn("ads init load failed", e);
        _creativeAutoFetchDone = false;
        runCreativeDiagnostic();
      });
    const scheduleLoadAdsData = () => {
      if (loadAdsDataDebounceTimer) clearTimeout(loadAdsDataDebounceTimer);
      loadAdsDataDebounceTimer = setTimeout(() => {
        loadAdsDataDebounceTimer = null;
        loadAdsData({ trigger: "schedule" })
          .then((result) => {
            updateOverviewFromData();
            if (result?.adRows?.length > 0 || result?.assetRows?.length > 0) {
              refreshCreativeTab(result.adRows || adsAdRows, result.assetRows || adsAssetRows);
            }
            refreshMediaCards();
            _creativeAutoFetchDone = false;
            runCreativeDiagnostic();
          })
          .catch((e) => {
            if (e?.name !== "AbortError") console.warn("ads schedule load failed", e);
            _creativeAutoFetchDone = false;
            runCreativeDiagnostic();
          });
      }, 150);
    };
    ($("period-type-select") || {}).addEventListener?.("change", () => {
      switchPeriodTypeUI();
      scheduleLoadAdsData();
    });
    ($("report-month-select") || {}).addEventListener?.("change", () => {
      syncDateRangeDisplay();
      scheduleLoadAdsData();
    });
    const campaignPanel = document.getElementById("tab-campaign");
    if (campaignPanel) {
      campaignPanel.addEventListener("click", (e) => {
        const th = e.target?.closest?.("th.sortable");
        if (th && th.dataset.sort) {
          const key = th.dataset.sort;
          if (campaignSortKey === key) campaignSortDir *= -1;
          else {
            campaignSortKey = key;
            campaignSortDir = ["campaign", "media"].includes(key) ? 1 : -1;
          }
          refreshCampaignTable();
        }
      });
    }
    const areaPanel = document.getElementById("tab-area");
    if (areaPanel) {
      areaPanel.addEventListener("click", (e) => {
        const th = e.target?.closest?.("th.sortable");
        if (th && th.dataset.sort) {
          const key = th.dataset.sort;
          if (areaSortKey === key) areaSortDir *= -1;
          else {
            areaSortKey = key;
            areaSortDir = key === "pref" ? 1 : -1;
          }
          refreshAreaTable();
        }
      });
    }
    const creativePanel = document.getElementById("tab-creative");
    if (creativePanel) {
      creativePanel.addEventListener("click", (e) => {
        const th = e.target?.closest?.("th.sortable");
        if (th && th.dataset.sort) {
          const table = th.closest("table");
          const key = th.dataset.sort;
          if (table?.id === "creative-ad-table") {
            if (creativeAdSortKey === key) creativeAdSortDir *= -1;
            else {
              creativeAdSortKey = key;
              creativeAdSortDir = ["campaign", "adGroup", "adName"].includes(key) ? 1 : -1;
            }
          } else if (table?.id === "creative-asset-table") {
            if (creativeAssetSortKey === key) creativeAssetSortDir *= -1;
            else {
              creativeAssetSortKey = key;
              creativeAssetSortDir = ["campaign", "adGroup", "assetText", "assetType"].includes(key) ? 1 : -1;
            }
          }
          refreshCreativeTab();
        }
      });
    }
    const keywordPanel = document.getElementById("tab-keyword");
    if (keywordPanel) {
      keywordPanel.addEventListener("click", (e) => {
        const th = e.target?.closest?.("th.sortable");
        if (th && th.dataset.sort) {
          const key = th.dataset.sort;
          if (keywordSortKey === key) keywordSortDir *= -1;
          else {
            keywordSortKey = key;
            keywordSortDir = ["keyword", "campaign"].includes(key) ? 1 : -1;
          }
          refreshKeywordTab();
        }
      });
    }
    let kwSearchDebounce = null;
    const keywordSearch = document.getElementById("keyword-search");
    if (keywordSearch) {
      keywordSearch.addEventListener("input", () => {
        if (kwSearchDebounce) clearTimeout(kwSearchDebounce);
        kwSearchDebounce = setTimeout(() => {
          kwSearchDebounce = null;
          refreshKeywordTab();
        }, 150);
      });
      keywordSearch.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && kwSearchDebounce) {
          clearTimeout(kwSearchDebounce);
          kwSearchDebounce = null;
          refreshKeywordTab();
        }
      });
    }
    const btnUpdate = $("btn-update");
    if (btnUpdate) {
      btnUpdate.addEventListener("click", async () => {
        if (loadAdsDataDebounceTimer) {
          clearTimeout(loadAdsDataDebounceTimer);
          loadAdsDataDebounceTimer = null;
        }
        btnUpdate.disabled = true;
        const origText = btnUpdate.textContent;
        btnUpdate.textContent = "取得中...";
        const force = document.getElementById("ads-force-refresh")?.checked ?? false;
        try {
          const result = await loadAdsData({ force, trigger: "btnUpdate" });
          updateOverviewFromData();
          if (result?.adRows?.length > 0 || result?.assetRows?.length > 0) {
            refreshCreativeTab(result.adRows || adsAdRows, result.assetRows || adsAssetRows);
          }
          refreshMediaCards();
          _creativeAutoFetchDone = false;
          runCreativeDiagnostic();
        } catch (e) {
          if (e?.name !== "AbortError") console.warn("ads update failed", e);
          _creativeAutoFetchDone = false;
          runCreativeDiagnostic();
        } finally {
          btnUpdate.disabled = false;
          btnUpdate.textContent = origText;
        }
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
