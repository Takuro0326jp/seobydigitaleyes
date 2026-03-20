/**
 * Historical Trends - 過去スキャン結果の推移
 * GET /api/scan/trends?url=xxx からデータ取得
 */
let trendsData = [];
let currentMetric = "score";

const METRIC_LABELS = {
  score: "SEOスコア",
  pages: "ページ数",
  issues: "エラー数",
};

window.initHistoryChart = async function () {
  const canvas = document.getElementById("historyChart");
  if (!canvas || typeof Chart === "undefined") return;

  const targetUrl = SEOState?.scan?.target_url || SEOState?.scanInfo?.target_url;
  if (!targetUrl) {
    renderEmptyChart(canvas);
    return;
  }

  try {
    const res = await fetch(
      `/api/scans/trends?url=${encodeURIComponent(targetUrl)}`,
      { credentials: "include" }
    );
    if (!res.ok) {
      renderEmptyChart(canvas);
      return;
    }
    trendsData = await res.json();
  } catch (e) {
    console.error("trends fetch error:", e);
    renderEmptyChart(canvas);
    return;
  }

  if (!trendsData || !trendsData.length) {
    renderEmptyChart(canvas);
    if (typeof updateScanDates === "function") {
      updateScanDates(SEOState.scanHistory || []);
    }
    return;
  }

  if (typeof updateScanDates === "function") {
    const history = trendsData.map((t) => ({
      created_at: t.date + "T00:00:00",
      avg_score: t.score,
      critical_issues: t.issues,
    }));
    updateScanDates(history);
  }

  wireMetricSelect();
  renderTrendsChart();
};

function wireMetricSelect() {
  const select = document.getElementById("trendsMetricSelect");
  if (!select) return;

  select.value = currentMetric;
  select.onchange = () => {
    currentMetric = select.value;
    renderTrendsChart();
  };
}

function getMetricValue(row) {
  return row[currentMetric] ?? 0;
}

function renderTrendsChart() {
  const canvas = document.getElementById("historyChart");
  if (!canvas || !trendsData.length) return;

  const labels = trendsData.map((t) => t.date);
  const values = trendsData.map((t) => getMetricValue(t));
  const lastIdx = values.length - 1;

  const diffEl = document.getElementById("trendsDiff");
  if (diffEl && values.length >= 2) {
    const prev = values[lastIdx - 1];
    const curr = values[lastIdx];
    const diff = curr - prev;
    const sign = diff >= 0 ? "+" : "";
    diffEl.textContent = `前回比: ${sign}${diff}`;
    const isGood =
      (currentMetric === "score" || currentMetric === "pages") ? diff > 0 : diff < 0;
    diffEl.className =
      "text-xs font-bold min-w-[4rem] " +
      (diff === 0 ? "text-slate-500" : isGood ? "text-emerald-600" : "text-red-500");
  } else if (diffEl) {
    diffEl.textContent = "";
  }

  const pointRadius = labels.map((_, i) => (i === lastIdx ? 8 : 4));
  const pointBackgroundColor = labels.map((_, i) =>
    i === lastIdx ? "#2563eb" : "rgba(37,99,235,0.6)"
  );
  const pointBorderWidth = labels.map((_, i) => (i === lastIdx ? 3 : 1));

  if (SEOState.chart) SEOState.chart.destroy();

  const ctx = canvas.getContext("2d");
  SEOState.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: METRIC_LABELS[currentMetric] || currentMetric,
          data: values,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37,99,235,0.08)",
          fill: true,
          tension: 0.3,
          pointRadius,
          pointBackgroundColor,
          pointBorderColor: "#2563eb",
          pointBorderWidth,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const idx = items[0]?.dataIndex;
              if (idx == null || idx >= trendsData.length) return "";
              const row = trendsData[idx];
              return [
                "",
                `スコア: ${row.score} | ページ: ${row.pages} | エラー: ${row.issues}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(0,0,0,0.05)" },
          ticks: { maxRotation: 45, font: { size: 10 } },
        },
        y: {
          min: currentMetric === "score" ? 0 : undefined,
          max: currentMetric === "score" ? 100 : undefined,
          grid: { color: "rgba(0,0,0,0.05)" },
          ticks: { font: { size: 10 } },
        },
      },
    },
  });
}

function renderEmptyChart(canvas) {
  if (!canvas || typeof Chart === "undefined") return;
  const ctx = canvas.getContext("2d");
  if (SEOState.chart) SEOState.chart.destroy();
  SEOState.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: ["—"],
      datasets: [
        {
          label: "データなし",
          data: [0],
          borderColor: "#e2e8f0",
          backgroundColor: "rgba(226,232,240,0.2)",
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { min: 0, max: 100 },
      },
    },
  });
}

window.openScheduleModal = function () {
  const m = document.getElementById("scheduleModal");
  if (m) m.classList.remove("hidden");
};

window.closeScheduleModal = function () {
  const m = document.getElementById("scheduleModal");
  if (m) m.classList.add("hidden");
};

window.saveSchedule = async function () {
  const select = document.getElementById("scheduleSelect");
  const frequency = select?.value || "manual";
  const label = document.getElementById("current-schedule-label");
  if (label) label.textContent = "更新頻度: " + frequency;
  closeScheduleModal();
};

window.updateScanDates = function (history) {
  if (!history || !history.length) return;
  const first = history[0];
  const last = history[history.length - 1];
  const fe = document.getElementById("first-scan-time");
  const le = document.getElementById("last-update-time");
  if (fe) fe.textContent = formatScanDate(first.created_at);
  if (le) le.textContent = formatScanDate(last.created_at);
};

function formatScanDate(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ja-JP");
}

window.showHistoryModal = async function () {
  const modal = document.getElementById("historyModal");
  const body = document.getElementById("history-list-body");
  if (!modal || !body) return;

  // trendsData が空ならクリック時に再取得を試行
  if (!trendsData.length) {
    const targetUrl = SEOState?.scan?.target_url || SEOState?.scanInfo?.target_url;
    if (targetUrl) {
      try {
        const res = await fetch(
          `/api/scans/trends?url=${encodeURIComponent(targetUrl)}`,
          { credentials: "include" }
        );
        if (res.ok) {
          const data = await res.json();
          if (data && data.length) {
            trendsData = data;
            if (typeof updateScanDates === "function") {
              updateScanDates(trendsData.map((t) => ({
                created_at: t.date + "T00:00:00",
                avg_score: t.score,
                critical_issues: t.issues,
              })));
            }
          }
        }
      } catch (e) {
        console.warn("trends fetch on modal open:", e);
      }
    }
  }

  let history = trendsData.length
    ? trendsData.map((t) => ({
        created_at: t.date + "T00:00:00",
        avg_score: t.score,
        critical_issues: t.issues,
      }))
    : SEOState.scanHistory || [];

  // どちらも空なら現在のスキャン結果を1件表示
  if (!history.length && SEOState.scan) {
    const s = SEOState.scan;
    const d = s.created_at || s.updated_at;
    history = [{
      created_at: d || new Date().toISOString(),
      avg_score: SEOState.avgScore ?? s.avg_score ?? "—",
      critical_issues: SEOState.criticalIssues ?? "—",
    }];
  }

  history.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  body.innerHTML = history.length
    ? history
        .map(
          (h) => `
    <tr>
      <td class="px-4 py-2 text-xs text-slate-600">${formatScanDate(h.created_at)}</td>
      <td class="px-4 py-2 text-xs font-bold text-slate-800 text-right">${h.avg_score ?? "—"}</td>
      <td class="px-4 py-2 text-xs text-red-500 text-right">${h.critical_issues ?? "—"}</td>
    </tr>`
        )
        .join("")
    : `<tr><td colspan="3" class="px-4 py-4 text-center text-slate-400 text-xs">履歴がありません（再診断で蓄積されます）</td></tr>`;

  modal.classList.remove("hidden");
};

window.closeHistoryModal = function () {
  const m = document.getElementById("historyModal");
  if (m) m.classList.add("hidden");
};
