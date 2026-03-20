/**
 * gsc-monitoring.js - パフォーマンス推移の可視化
 * seoscan: scan パラメータ、/api/gsc/performance (dimensions: ['date'])
 */
(function () {
  "use strict";

  let monitorChart = null;
  let chartData = [];

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
    const links = {
      "nav-performance": "gsc.html",
      "nav-indexHealth": "gsc-indexhealth.html",
      "nav-technical": "gsc-technical.html",
      "nav-monitoring": "gsc-monitoring.html",
    };
    Object.entries(links).forEach(([id, base]) => {
      const el = document.getElementById(id);
      if (el) el.setAttribute("href", base + suffix);
    });
  }

  function showEmptyState(message) {
    ["totalClicks", "totalImpressions", "avgCtr", "avgPosition"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = "--";
    });
    ["clickDiff", "impDiff", "posDiff"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = "";
    });
    const ctrEl = document.getElementById("avgCtr");
    if (ctrEl) ctrEl.textContent = "--";
    const aiEl = document.getElementById("aiMonitorReview");
    if (aiEl) aiEl.textContent = message || "GSC API が接続されると、トレンド分析がここに表示されます。";

    chartData = [];
    if (monitorChart) {
      monitorChart.destroy();
      monitorChart = null;
    }
    const canvas = document.getElementById("performanceChart");
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  async function fetchMonitoringData(propertyUrl, days) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days || 30));

    try {
      const res = await fetch("/api/gsc/performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          propertyUrl,
          scanId,
          dimensions: ["date"],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showEmptyState(err.error || "GSC データの取得に失敗しました。");
        return;
      }

      let rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        showEmptyState("GSC にデータがありません。");
        return;
      }

      const startStr = startDate.toISOString().slice(0, 10);
      const endStr = endDate.toISOString().slice(0, 10);
      rows = rows.filter((r) => {
        const d = r.keys && r.keys[0] ? r.keys[0] : "";
        return d >= startStr && d <= endStr;
      });
      rows.sort((a, b) => new Date(a.keys[0]) - new Date(b.keys[0]));

      chartData = rows;
      updateSummaryCards(rows);
      renderPerformanceChart(rows);
      updateAiMonitorInsight(rows);
    } catch (e) {
      console.error("Monitoring Error:", e);
      showEmptyState("データの取得中にエラーが発生しました。");
    }
  }

  function updateSummaryCards(data) {
    const totalClicks = data.reduce((sum, r) => sum + (r.clicks || 0), 0);
    const totalImpressions = data.reduce((sum, r) => sum + (r.impressions || 0), 0);
    const avgPos = data.length > 0
      ? (data.reduce((sum, r) => sum + (r.position || 0), 0) / data.length).toFixed(1)
      : "--";
    const avgCtrVal = data.length > 0
      ? (data.reduce((sum, r) => sum + (r.ctr || 0), 0) / data.length * 100).toFixed(2) + "%"
      : "--";

    const clickEl = document.getElementById("totalClicks");
    const impEl = document.getElementById("totalImpressions");
    const ctrEl = document.getElementById("avgCtr");
    const posEl = document.getElementById("avgPosition");
    if (clickEl) clickEl.textContent = totalClicks.toLocaleString();
    if (impEl) impEl.textContent = totalImpressions.toLocaleString();
    if (ctrEl) ctrEl.textContent = avgCtrVal;
    if (posEl) posEl.textContent = avgPos;

    if (data.length >= 14) {
      const recent = data.slice(-7);
      const prev = data.slice(-14, -7);
      const recentClicks = recent.reduce((sum, r) => sum + (r.clicks || 0), 0);
      const prevClicks = prev.reduce((sum, r) => sum + (r.clicks || 0), 0);
      const recentImp = recent.reduce((sum, r) => sum + (r.impressions || 0), 0);
      const prevImp = prev.reduce((sum, r) => sum + (r.impressions || 0), 0);

      const clickDiffEl = document.getElementById("clickDiff");
      const impDiffEl = document.getElementById("impDiff");
      if (clickDiffEl && prevClicks > 0) {
        const pct = Math.round(((recentClicks - prevClicks) / prevClicks) * 100);
        clickDiffEl.textContent = pct >= 0 ? `+${pct}%` : `${pct}%`;
        clickDiffEl.className = `text-[10px] sm:text-xs font-bold ${pct >= 0 ? "text-emerald-500" : "text-red-500"}`;
      }
      if (impDiffEl && prevImp > 0) {
        const pct = Math.round(((recentImp - prevImp) / prevImp) * 100);
        impDiffEl.textContent = pct >= 0 ? `+${pct}%` : `${pct}%`;
        impDiffEl.className = `text-[10px] sm:text-xs font-bold ${pct >= 0 ? "text-emerald-500" : "text-red-500"}`;
      }
    }
  }

  function renderPerformanceChart(data) {
    const canvas = document.getElementById("performanceChart");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (monitorChart) monitorChart.destroy();

    const labels = data.map((r) => {
      const d = r.keys && r.keys[0] ? r.keys[0] : "";
      return d.split("-").slice(1).join("/");
    });
    const clickData = data.map((r) => r.clicks || 0);
    const impData = data.map((r) => r.impressions || 0);

    monitorChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Clicks",
            data: clickData,
            borderColor: "#4f46e5",
            backgroundColor: "rgba(79, 70, 229, 0.05)",
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
            yAxisID: "y",
          },
          {
            label: "Impressions",
            data: impData,
            borderColor: "#94a3b8",
            borderDash: [5, 5],
            fill: false,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
            yAxisID: "y1",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { weight: "bold", size: 10 }, maxRotation: 45 },
          },
          y: {
            type: "linear",
            display: true,
            position: "left",
            grid: { color: "#f1f5f9" },
          },
          y1: {
            type: "linear",
            display: true,
            position: "right",
            grid: { display: false },
          },
        },
      },
    });
  }

  function updateAiMonitorInsight(data) {
    const aiEl = document.getElementById("aiMonitorReview");
    if (!aiEl || data.length < 14) return;

    const recent = data.slice(-7);
    const prev = data.slice(-14, -7);
    const recentClicks = recent.reduce((sum, r) => sum + (r.clicks || 0), 0);
    const prevClicks = prev.reduce((sum, r) => sum + (r.clicks || 0), 0);

    let text = "";
    if (prevClicks > 0 && recentClicks > prevClicks) {
      const pct = Math.round(((recentClicks / prevClicks - 1) * 100));
      text = `直近1週間でクリック数が ${pct}% 増加しています。特定のキーワードでの掲載順位上昇が寄与している可能性が高いです。`;
    } else {
      text = `パフォーマンスは安定していますが、表示回数に対してクリック数が伸び悩んでいます。検索結果での見え方（タイトル・説明文）を改善する余地があります。`;
    }
    aiEl.textContent = text;
  }

  async function loadData(days) {
    const mappings = JSON.parse(localStorage.getItem("gsc_mappings") || "{}");
    const propertyUrl = mappings[scanId];

    if (!propertyUrl) {
      showEmptyState("GSC API が接続されると、パフォーマンス推移が表示されます。seo.html の設定から「Google で連携」を行ってください。");
      return;
    }

    await fetchMonitoringData(propertyUrl, days || 30);
  }

  window.addEventListener("DOMContentLoaded", () => {
    updateNavLinks();
    void loadData(30);

    const btn30 = document.getElementById("btn-30d");
    const btn90 = document.getElementById("btn-90d");
    if (btn30) {
      btn30.addEventListener("click", () => {
        btn30.classList.add("bg-white", "shadow-sm");
        btn30.classList.remove("text-slate-400");
        if (btn90) {
          btn90.classList.remove("bg-white", "shadow-sm");
          btn90.classList.add("text-slate-400");
        }
        void loadData(30);
      });
    }
    if (btn90) {
      btn90.addEventListener("click", () => {
        btn90.classList.add("bg-white", "shadow-sm");
        btn90.classList.remove("text-slate-400");
        if (btn30) {
          btn30.classList.remove("bg-white", "shadow-sm");
          btn30.classList.add("text-slate-400");
        }
        void loadData(90);
      });
    }
  });
})();
