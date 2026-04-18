(function () {
  "use strict";

  /* ── DOM refs ── */
  var siteSelect = document.getElementById("siteSelect");
  var btnAddSite = document.getElementById("btnAddSite");
  var btnShowSnippet = document.getElementById("btnShowSnippet");
  var filterBar = document.getElementById("filterBar");
  var pageSidebar = document.getElementById("pageSidebar");
  var pageList = document.getElementById("pageList");
  var emptyState = document.getElementById("emptyState");
  var heatmapView = document.getElementById("heatmapView");
  var previewFrame = document.getElementById("previewFrame");
  var heatmapCanvas = document.getElementById("heatmapCanvas");
  var clickRankSection = document.getElementById("clickRankSection");
  var clickRankBody = document.getElementById("clickRankBody");

  var addSiteModal = document.getElementById("addSiteModal");
  var snippetModal = document.getElementById("snippetModal");
  var snippetCode = document.getElementById("snippetCode");

  /* ── State ── */
  var sites = [];
  var currentSiteId = null;
  var currentPageUrl = null;

  /* ── API helpers ── */
  function api(path, opts) {
    return fetch(path, Object.assign({ credentials: "same-origin" }, opts)).then(function (r) {
      if (r.status === 204) return {};
      if (!r.ok) throw new Error("API error " + r.status);
      return r.json();
    });
  }

  /* ── Init ── */
  loadSites();

  async function loadSites() {
    try {
      var data = await api("/api/heatmap/sites");
      sites = data.sites || [];
      renderSiteSelect();
      // admin向けボタン表示（サーバー側で権限チェックするのでここでは常に表示）
      btnAddSite.classList.remove("hidden");
    } catch (e) {
      console.error("Failed to load sites:", e);
    }
  }

  function renderSiteSelect() {
    siteSelect.innerHTML = '<option value="">サイトを選択...</option>';
    sites.forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.label || s.site_url;
      siteSelect.appendChild(opt);
    });
  }

  siteSelect.addEventListener("change", function () {
    var id = parseInt(siteSelect.value, 10);
    if (!id) {
      currentSiteId = null;
      hidePanels();
      return;
    }
    currentSiteId = id;
    btnShowSnippet.classList.remove("hidden");
    filterBar.classList.remove("hidden");
    pageSidebar.classList.remove("hidden");
    loadPages(id);
  });

  /* ── ページ一覧 ── */
  async function loadPages(siteId) {
    pageList.innerHTML = '<p class="text-xs text-slate-400 py-4 text-center">読み込み中...</p>';
    try {
      var data = await api("/api/heatmap/sites/" + siteId + "/pages");
      var pages = data.pages || [];
      if (pages.length === 0) {
        pageList.innerHTML = '<p class="text-xs text-slate-400 py-4 text-center">データなし</p>';
        showEmpty();
        return;
      }
      pageList.innerHTML = "";
      pages.forEach(function (p) {
        var div = document.createElement("div");
        div.className = "page-item px-3 py-2 rounded-lg";
        var shortUrl = p.page_url.replace(/^https?:\/\/[^/]+/, "");
        div.innerHTML =
          '<div class="text-xs font-medium text-slate-700 truncate">' + escHtml(shortUrl || "/") + "</div>" +
          '<div class="text-[10px] text-slate-400 mt-0.5">' + (p.click_count || 0) + " clicks</div>";
        div.addEventListener("click", function () {
          document.querySelectorAll(".page-item.active").forEach(function (el) { el.classList.remove("active"); });
          div.classList.add("active");
          currentPageUrl = p.page_url;
          loadHeatmap(currentSiteId, p.page_url);
        });
        pageList.appendChild(div);
      });
    } catch (e) {
      pageList.innerHTML = '<p class="text-xs text-red-400 py-4 text-center">読み込み失敗</p>';
    }
  }

  /* ── ヒートマップ描画 ── */
  async function loadHeatmap(siteId, pageUrl) {
    emptyState.classList.add("hidden");
    heatmapView.classList.remove("hidden");
    clickRankSection.classList.remove("hidden");

    // フィルタ
    var params = new URLSearchParams({ page_url: pageUrl });
    var df = document.getElementById("dateFrom").value;
    var dt = document.getElementById("dateTo").value;
    var dv = document.getElementById("deviceFilter").value;
    if (df) params.set("date_from", df);
    if (dt) params.set("date_to", dt);
    if (dv !== "all") params.set("device_type", dv);

    // iframe にページロード（proxy経由）
    previewFrame.src = "/api/proxy?url=" + encodeURIComponent(pageUrl);

    try {
      var [heatData, clickData] = await Promise.all([
        api("/api/heatmap/sites/" + siteId + "/data?" + params.toString()),
        api("/api/heatmap/sites/" + siteId + "/clicks?" + params.toString())
      ]);

      // iframe ロード後にcanvas描画
      previewFrame.onload = function () {
        try {
          var h = previewFrame.contentDocument.documentElement.scrollHeight;
          previewFrame.style.height = h + "px";
        } catch (e) {
          previewFrame.style.height = "2000px";
        }
        renderHeatmap(heatData.points || [], heatData.meta || {});
      };

      renderClickRank(clickData.clicks || []);
    } catch (e) {
      console.error("Failed to load heatmap data:", e);
    }
  }

  function renderHeatmap(points, meta) {
    var wrapper = heatmapView;
    var w = wrapper.offsetWidth;
    var h = wrapper.offsetHeight;
    heatmapCanvas.width = w;
    heatmapCanvas.height = h;

    var ctx = heatmapCanvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);

    if (points.length === 0) return;

    var maxCount = Math.max.apply(null, points.map(function (p) { return p.count; }));
    var radius = Math.max(20, Math.min(40, w / 30));

    // Pass 1: グレースケール intensity 描画
    points.forEach(function (p) {
      var x = (p.x / 100) * w;
      var y = (p.y / 100) * h;
      var intensity = Math.min(1, p.count / maxCount);

      var grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
      grad.addColorStop(0, "rgba(0,0,0," + intensity + ")");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    });

    // Pass 2: カラー化
    colorize(ctx, w, h);
  }

  function colorize(ctx, w, h) {
    var imgData = ctx.getImageData(0, 0, w, h);
    var data = imgData.data;

    // グラデーションパレット生成（256段階）
    var palette = createPalette();

    for (var i = 0; i < data.length; i += 4) {
      var alpha = data[i + 3]; // グレースケールのalpha = intensity
      if (alpha === 0) continue;
      var idx = alpha;
      data[i] = palette[idx * 4];
      data[i + 1] = palette[idx * 4 + 1];
      data[i + 2] = palette[idx * 4 + 2];
      data[i + 3] = Math.min(255, alpha + 80); // 半透明オーバーレイ
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function createPalette() {
    var canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 1;
    var ctx = canvas.getContext("2d");
    var grad = ctx.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, "rgba(0,0,255,1)");
    grad.addColorStop(0.25, "rgba(0,255,255,1)");
    grad.addColorStop(0.5, "rgba(0,255,0,1)");
    grad.addColorStop(0.75, "rgba(255,255,0,1)");
    grad.addColorStop(1, "rgba(255,0,0,1)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 1);
    return ctx.getImageData(0, 0, 256, 1).data;
  }

  /* ── クリックランキング ── */
  function renderClickRank(clicks) {
    clickRankBody.innerHTML = "";
    if (clicks.length === 0) {
      clickRankBody.innerHTML = '<tr><td colspan="4" class="py-4 text-center text-xs text-slate-400">データなし</td></tr>';
      return;
    }
    clicks.forEach(function (c, i) {
      var tr = document.createElement("tr");
      tr.className = "click-rank-row border-b border-slate-100";
      tr.innerHTML =
        '<td class="py-2 pr-4 text-xs text-slate-400">' + (i + 1) + "</td>" +
        '<td class="py-2 pr-4"><span class="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-mono rounded">' + escHtml(c.element_tag || "-") + "</span></td>" +
        '<td class="py-2 pr-4 text-xs text-slate-600 truncate max-w-[300px]">' + escHtml(c.element_text || "-") + "</td>" +
        '<td class="py-2 text-right text-xs font-bold text-slate-700">' + c.count + "</td>";
      clickRankBody.appendChild(tr);
    });
  }

  /* ── サイト追加 ── */
  btnAddSite.addEventListener("click", function () { addSiteModal.classList.remove("hidden"); });
  document.getElementById("btnCancelAdd").addEventListener("click", closeAddModal);
  document.getElementById("btnCloseAddModal").addEventListener("click", closeAddModal);
  function closeAddModal() { addSiteModal.classList.add("hidden"); }

  document.getElementById("btnConfirmAdd").addEventListener("click", async function () {
    var url = document.getElementById("newSiteUrl").value.trim();
    var label = document.getElementById("newSiteLabel").value.trim();
    if (!url) return;
    try {
      await api("/api/heatmap/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_url: url, label: label || null })
      });
      closeAddModal();
      document.getElementById("newSiteUrl").value = "";
      document.getElementById("newSiteLabel").value = "";
      await loadSites();
    } catch (e) {
      alert("追加に失敗しました: " + e.message);
    }
  });

  /* ── 埋め込みコード表示 ── */
  btnShowSnippet.addEventListener("click", function () {
    var site = sites.find(function (s) { return s.id === currentSiteId; });
    if (!site) return;
    var host = location.origin;
    snippetCode.textContent =
      '<script src="' + host + '/js/seoscan-tracker.js" data-site-key="' + site.site_key + '" async><\/script>';
    snippetModal.classList.remove("hidden");
  });
  document.getElementById("btnCloseSnippet").addEventListener("click", function () { snippetModal.classList.add("hidden"); });
  document.getElementById("btnCopySnippet").addEventListener("click", function () {
    navigator.clipboard.writeText(snippetCode.textContent).then(function () {
      document.getElementById("btnCopySnippet").textContent = "コピーしました!";
      setTimeout(function () { document.getElementById("btnCopySnippet").textContent = "コピー"; }, 2000);
    });
  });

  /* ── フィルタ適用 ── */
  document.getElementById("btnApplyFilter").addEventListener("click", function () {
    if (currentSiteId && currentPageUrl) {
      loadHeatmap(currentSiteId, currentPageUrl);
    }
  });

  /* ── ユーティリティ ── */
  function hidePanels() {
    btnShowSnippet.classList.add("hidden");
    filterBar.classList.add("hidden");
    pageSidebar.classList.add("hidden");
    clickRankSection.classList.add("hidden");
    showEmpty();
  }

  function showEmpty() {
    heatmapView.classList.add("hidden");
    emptyState.classList.remove("hidden");
  }

  function escHtml(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
})();
