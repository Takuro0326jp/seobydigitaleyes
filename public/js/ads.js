/**
 * ADs Dashboard - 運用型広告レポート
 * Chart.js, API連携, Excel出力
 */
(function () {
  "use strict";

  let adsData = [];
  let mediaData = [];
  let connectedMediaFromStatus = []; // 連携済み媒体（status API から取得）
  let lastReportMeta = {}; // 直近レポートの meta（google_customer_id があれば Google 連携済み）
  let lastReportHint = null; // 取得失敗時のヒント（MCC 等）

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
    if (getPeriodType() === "date") {
      const ds = $("date-start");
      const de = $("date-end");
      const start = (ds && ds.value) || "";
      const end = (de && de.value) || "";
      if (start && end && start <= end) return { startDate: start, endDate: end };
      return null;
    }
    const ym = getReportMonth();
    if (ym && /^\d{4}-\d{2}$/.test(ym)) return { month: ym };
    return null;
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

  function switchTab(id, btn) {
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    const panel = document.getElementById("tab-" + id);
    if (panel) panel.classList.add("active");
    if (btn) btn.classList.add("active");
  }
  window.switchTab = switchTab;

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

    const trendCtx = document.getElementById("trendChart");
    if (trendCtx && typeof Chart !== "undefined") {
      new Chart(trendCtx.getContext("2d"), {
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

    let donutChartInstance = null;
    const donutCtx = document.getElementById("donutChart");
    const updateDonutChart = function () {
      if (!donutCtx || typeof Chart === "undefined") return;
      if (donutChartInstance) donutChartInstance.destroy();
      if (mediaData.length === 0) {
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
            labels: mediaData.map((m) => m.name),
            datasets: [{
              data: mediaData.map((m) => m.cost),
              backgroundColor: mediaData.map((m) => m.color),
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
    if (mediaData.length === 0) {
      mc.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--text-muted);white-space:pre-wrap">' + escapeHtml(getEmptyMessage()) + '</div>';
      return;
    }
    mediaData.forEach((m, i) => {
        const costK = Math.round(m.cost / 1000) + "k";
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
            <div class="media-metric-item"><div class="media-metric-label">Cost</div><div class="media-metric-value">¥${costK}</div></div>
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
      fields: [
        { key: "client_id", label: "Client ID", type: "text", placeholder: "dj0zaiZpPXXXXXX" },
        { key: "client_secret", label: "Client Secret", type: "password", placeholder: "xxxxxxxxxxxxxxxx" },
        { key: "refresh_token", label: "Refresh Token", type: "password", placeholder: "xxxxxxxxxxxxxxxx" },
        { key: "account_id", label: "アカウントID", type: "text", placeholder: "1234567890" },
      ],
    },
    {
      id: "meta",
      name: "Meta",
      color: "#1877f2",
      bg: "#eef3fe",
      docsUrl: "https://developers.facebook.com/docs/marketing-api",
      status: "disconnected",
      fields: [
        { key: "app_id", label: "App ID", type: "text", placeholder: "123456789012345" },
        { key: "app_secret", label: "App Secret", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
        { key: "access_token", label: "Access Token", type: "password", placeholder: "EAAxxxxxxxxxx" },
        { key: "ad_account_id", label: "Ad Account ID", type: "text", placeholder: "act_123456789", hint: '"act_" を含めて入力' },
      ],
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
            ? "Yahoo! Ads API のアプリ登録画面からクライアント情報を取得してください。Refresh Token は OAuth 認証フローで発行されます。"
            : m.id === "meta"
              ? "Meta for Developers でアプリを作成し、Marketing API の権限を付与してください。Access Token は長期トークンを推奨します。"
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

  function switchApiTab(id) {
    currentApiTab = id;
    apiMedia.forEach((m) => {
      const panel = document.getElementById("panel-" + m.id);
      const btn = document.getElementById("nav-" + m.id);
      if (!panel || !btn) return;
      const active = m.id === id;
      panel.style.display = active ? "block" : "none";
      btn.style.background = active ? "#fff" : "none";
      btn.style.fontWeight = active ? "500" : "400";
      btn.style.boxShadow = active ? "0 1px 4px rgba(0,0,0,.07)" : "none";
    });
  }

  let lastConnectionStatus = {};
  window.openSettings = async function () {
    try {
      const res = await fetch("/api/ads/status", { credentials: "include" });
      if (res.ok) {
        const st = await parseJsonResponse(res, {});
        lastConnectionStatus = st;
        if (st.google?.connected) apiMedia[0].status = "connected";
        else apiMedia[0].status = "disconnected";
        const conn = [];
        if (st.google?.connected) conn.push("Google Ads");
        if (st.yahoo?.connected) conn.push("Yahoo広告");
        if (st.microsoft?.connected) conn.push("Microsoft Advertising");
        connectedMediaFromStatus = conn;
        refreshMediaFilter();
      }
    } catch (e) {}
    buildModal();
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
    closeSettings();
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

  async function loadAdsData() {
    const params = getReportParams();
    if (!params) {
      console.warn("ads: 期間が指定されていません");
      return;
    }
    const query = new URLSearchParams(params).toString();

    try {
      const res = await fetch(`/api/ads/report?${query}`, { credentials: "include" });
      if (!res.ok) {
        const err = await parseJsonResponse(res, {}).catch(() => ({}));
        console.warn("ads report error", err);
        return;
      }
      const data = await parseJsonResponse(res, { rows: [], meta: {} });
      adsData = data.rows || [];
      const meta = data.meta || {};
      lastReportMeta = meta || {};
      lastReportHint = data._hint || null;

      if (adsData.length > 0) {
        const byMedia = {};
        adsData.forEach((r) => {
          const m = r.media || "その他";
          if (!byMedia[m]) byMedia[m] = { cost: 0, cv: 0, imp: 0, clicks: 0 };
          byMedia[m].cost += r.cost || 0;
          byMedia[m].cv += r.conversions || 0;
          byMedia[m].imp += r.impressions || 0;
          byMedia[m].clicks += r.clicks || 0;
        });
        const mediaColors = { "Google Ads": "#4285f4", "Yahoo! 広告": "#ff0033", "Yahoo広告": "#ff0033", "Microsoft Advertising": "#107c10" };
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
        badgeEl.title = meta.google_customer_id
          ? "取得元 Customer ID: " + meta.google_customer_id
          : (badgeEl.title || "API連携状態");
      }
    } catch (e) {
      console.warn("ads load failed", e);
    }
  }

  function updateOverviewFromData() {
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
      refreshMediaCards();
      return;
    }
    let cost = 0,
      cv = 0;
    adsData.forEach((r) => {
      cost += r.cost || 0;
      cv += r.conversions || 0;
    });
    const cpa = cv > 0 ? Math.round(cost / cv) : 0;
    const revenue = cv * 35000;
    const roas = cost > 0 ? (revenue / cost).toFixed(1) : 0;

    if (kpiCost) kpiCost.textContent = "¥" + cost.toLocaleString();
    if (kpiCv) kpiCv.textContent = cv;
    if (kpiCpa) kpiCpa.textContent = "¥" + cpa.toLocaleString();
    if (kpiRevenue) kpiRevenue.textContent = "¥" + revenue.toLocaleString();
    if (kpiRoas) kpiRoas.textContent = roas;

    if (tbody && mediaData.length > 0) {
      const mediaStyles = {
        "Google Ads": { bg: "#eef3fe", color: "#2a5cdb", dot: "#4285f4" },
        "Yahoo広告": { bg: "#fff0f0", color: "#cc2c2c", dot: "#ff0033" },
        "Yahoo! 広告": { bg: "#fff0f0", color: "#cc2c2c", dot: "#ff0033" },
        "Microsoft Advertising": { bg: "#e8f5e9", color: "#107c10", dot: "#107c10" },
      };
      tbody.innerHTML = mediaData
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
    refreshMediaCards();
  }

  function refreshMediaFilter() {
    const sel = document.getElementById("media-filter");
    if (!sel) return;
    const selected = sel.value;
    sel.innerHTML = '<option value="">媒体：ALL</option>';
    const fromStatus = new Set(connectedMediaFromStatus);
    const fromData = new Set(mediaData.map((m) => m.name));
    if (lastReportMeta?.google_customer_id && !fromStatus.has("Google Ads") && !fromData.has("Google Ads")) {
      fromStatus.add("Google Ads"); // レポートで Google 取得済みなら追加
    }
    const mediaList = [...fromStatus];
    fromData.forEach((n) => { if (!fromStatus.has(n)) mediaList.push(n); });
    mediaList.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      if (opt.value === selected) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function refreshCampaignTable() {
    const tbody = document.getElementById("campaign-tbody");
    if (!tbody) return;
    const sel = document.getElementById("campaign-media-filter");
    if (sel) {
      sel.innerHTML = '<option value="">すべての媒体</option>';
      const fromStatus = new Set(connectedMediaFromStatus);
      const fromData = new Set(mediaData.map((m) => m.name));
      if (lastReportMeta?.google_customer_id) fromStatus.add("Google Ads");
      const list = [...fromStatus];
      fromData.forEach((n) => { if (!fromStatus.has(n)) list.push(n); });
      list.forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      });
    }
    const mediaStyles = {
      "Google Ads": { bg: "#eef3fe", color: "#2a5cdb" },
      "Yahoo広告": { bg: "#fff0f0", color: "#cc2c2c" },
      "Yahoo! 広告": { bg: "#fff0f0", color: "#cc2c2c" },
      "Microsoft Advertising": { bg: "#e8f5e9", color: "#107c10" },
    };
    if (adsData.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px;white-space:pre-wrap">' + escapeHtml(getEmptyMessage()) + '</td></tr>';
      return;
    }
    tbody.innerHTML = adsData
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

    const areaRows = [
      [{ v: "ADs Dashboard — エリア別パフォーマンス", s: { font: { name: "Arial", bold: true, sz: 14, color: { rgb: "1A2A4A" } }, alignment: { horizontal: "left" } } }, "", "", "", "", ""],
      [{ v: `期間：${period}　出力日：${today}`, s: { font: { name: "Arial", sz: 9, color: { rgb: "A09E99" } }, alignment: { horizontal: "left" } } }, "", "", "", "", ""],
      ["", "", "", "", "", ""],
      [cell("エリア", sHeader), cell("広告費", sHeader), cell("CV", sHeader), cell("CPA", sHeader), cell("ROAS", sHeader), cell("構成比", sHeader)],
    ];
    // エリア別データは API で取得可能になったら反映
    const ws3 = XLSX.utils.aoa_to_sheet(areaRows);
    ws3["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws3, "エリア別");

    const timeRows = [
      [{ v: "ADs Dashboard — 時間帯別パフォーマンス", s: { font: { name: "Arial", bold: true, sz: 14, color: { rgb: "1A2A4A" } }, alignment: { horizontal: "left" } } }, "", "", "", ""],
      [{ v: `期間：${period}　出力日：${today}`, s: { font: { name: "Arial", sz: 9, color: { rgb: "A09E99" } }, alignment: { horizontal: "left" } } }, "", "", "", ""],
      ["", "", "", "", ""],
      [cell("時間帯", sHeader), cell("広告費", sHeader), cell("CV", sHeader), cell("CPA", sHeader), cell("ROAS", sHeader)],
    ];
    // 時間帯別データは API で取得可能になったら反映
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
    const err = params.get("google_ads_error");
    const refreshStatusAndOpenSettings = () => {
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
          if (typeof openSettings === "function") openSettings();
        })
        .catch(() => {});
    };
    if (linked === "auth_linked") {
      if (window.history.replaceState) window.history.replaceState({}, "", window.location.pathname);
      refreshStatusAndOpenSettings();
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
  }

  function init() {
    initReportMonthSelect();
    switchPeriodTypeUI();
    handleOAuthResult();
    loadAdsData().then(() => {
      updateOverviewFromData();
    });

    fetch("/api/ads/status", { credentials: "include" })
      .then(async (r) => parseJsonResponse(r, {}))
      .then((st) => {
        const connected = [];
        if (st.google?.connected) connected.push("Google Ads");
        if (st.yahoo?.connected) connected.push("Yahoo広告");
        if (st.microsoft?.connected) connected.push("Microsoft Advertising");
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

    ($("period-type-select") || {}).addEventListener?.("change", () => {
      switchPeriodTypeUI();
      loadAdsData().then(() => {
        updateOverviewFromData();
        refreshMediaCards();
      });
    });
    ($("report-month-select") || {}).addEventListener?.("change", () => {
      syncDateRangeDisplay();
      loadAdsData().then(() => {
        updateOverviewFromData();
        refreshMediaCards();
      });
    });
    ($("btn-update") || {}).addEventListener?.("click", () => {
      loadAdsData().then(() => {
        updateOverviewFromData();
        refreshMediaCards();
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
