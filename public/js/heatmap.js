(function () {
  "use strict";

  /* ── DOM refs ── */
  var btnShowSnippet = document.getElementById("btnShowSnippet");
  var pageList = document.getElementById("pageList");
  var pageCount = document.getElementById("pageCount");
  var heatmapPlaceholder = document.getElementById("heatmapPlaceholder");
  var previewImage = document.getElementById("previewImage");
  var heatmapCanvas = document.getElementById("heatmapCanvas");
  var screenshotLoading = document.getElementById("screenshotLoading");
  var clickRankSection = document.getElementById("clickRankSection");
  var clickRankBody = document.getElementById("clickRankBody");
  var snippetModal = document.getElementById("snippetModal");
  var snippetCode = document.getElementById("snippetCode");
  var scrollOverlay = document.getElementById("scrollOverlay");
  var attentionOverlay = document.getElementById("attentionOverlay");

  /* ── State ── */
  var sites = [];
  var currentSiteId = null;
  var currentPageUrl = null;
  var currentViewMode = "click"; // "click" | "scroll" | "attention"

  /* ── デフォルト期間: 当月 ── */
  (function setDefaultDates() {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, "0");
    document.getElementById("dateFrom").value = y + "-" + m + "-01";
    document.getElementById("dateTo").value = y + "-" + m + "-" + String(now.getDate()).padStart(2, "0");
  })();

  /* ── API ── */
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
      if (sites.length > 0) {
        selectSite(sites[0]);
      } else {
        pageList.innerHTML = '<div class="hm-placeholder" style="min-height:200px"><p style="font-size:12px">登録サイトがありません</p></div>';
      }
    } catch (e) {
      console.error("Failed to load sites:", e);
      pageList.innerHTML = '<div class="hm-placeholder" style="min-height:200px"><p style="font-size:12px;color:#ef4444">読み込み失敗</p></div>';
    }
  }

  function selectSite(site) {
    currentSiteId = site.id;
    var siteLabel = document.getElementById("currentSiteLabel");
    if (siteLabel) {
      try {
        siteLabel.textContent = new URL(site.site_url).hostname + " のクリックデータ";
      } catch (_) {
        siteLabel.textContent = site.site_url;
      }
    }
    btnShowSnippet.classList.remove("hidden");
    loadPages(site.id);
  }

  /* ── ページ一覧 ── */
  async function loadPages(siteId) {
    pageList.innerHTML = '<div class="hm-placeholder" style="min-height:120px"><div class="hm-spinner"></div></div>';
    try {
      var data = await api("/api/heatmap/sites/" + siteId + "/pages");
      var pages = data.pages || [];
      pageCount.textContent = pages.length + " ページ";

      if (pages.length === 0) {
        pageList.innerHTML = '<div class="hm-placeholder" style="min-height:120px"><p style="font-size:12px">クリックデータがありません</p><p style="font-size:11px;color:#94a3b8;margin-top:4px">トラッキングコードを設置してください</p></div>';
        return;
      }

      pageList.innerHTML = "";
      pages.forEach(function (p) {
        var div = document.createElement("div");
        div.className = "page-card";
        var shortUrl = p.page_url.replace(/^https?:\/\/[^/]+/, "") || "/";
        var count = parseInt(p.click_count, 10) || 0;
        var lastDate = p.last_event ? new Date(p.last_event).toLocaleDateString("ja-JP") : "-";

        div.innerHTML =
          '<div class="path" title="' + escHtml(p.page_url) + '">' + escHtml(shortUrl) + '</div>' +
          '<div class="meta">' +
            '<span class="clicks-badge">' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 15l-2 5L9 9l11 4-5 2z"/></svg>' +
              count + ' clicks' +
            '</span>' +
            '<span>最終: ' + lastDate + '</span>' +
          '</div>';

        div.addEventListener("click", function () {
          document.querySelectorAll(".page-card.active").forEach(function (el) { el.classList.remove("active"); });
          div.classList.add("active");
          currentPageUrl = p.page_url;
          loadHeatmap(currentSiteId, p.page_url);
        });
        pageList.appendChild(div);
      });
    } catch (e) {
      pageList.innerHTML = '<div class="hm-placeholder" style="min-height:120px"><p style="font-size:12px;color:#ef4444">読み込み失敗</p></div>';
    }
  }

  /* ── ビューモード切り替え ── */
  var viewTabs = document.querySelectorAll("[data-hm-view]");
  viewTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      viewTabs.forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      currentViewMode = tab.getAttribute("data-hm-view");
      if (currentSiteId && currentPageUrl) {
        loadHeatmap(currentSiteId, currentPageUrl);
      }
    });
  });

  /* ── ヒートマップ描画 ── */
  var cachedScrollData = null;
  var cachedAttentionData = null;
  var cachedHeatData = null;
  var cachedClickData = null;

  async function loadHeatmap(siteId, pageUrl) {
    heatmapPlaceholder.style.display = "none";
    previewImage.style.display = "none";
    heatmapCanvas.style.display = "none";
    scrollOverlay.style.display = "none";
    attentionOverlay.style.display = "none";
    screenshotLoading.style.display = "";
    clickRankSection.style.display = "";

    var params = new URLSearchParams({ page_url: pageUrl });
    var df = document.getElementById("dateFrom").value;
    var dt = document.getElementById("dateTo").value;
    var dv = document.getElementById("deviceFilter").value;
    if (df) params.set("date_from", df);
    if (dt) params.set("date_to", dt);
    if (dv !== "all") params.set("device_type", dv);

    try {
      var [heatData, clickData, scrollData, attentionData] = await Promise.all([
        api("/api/heatmap/sites/" + siteId + "/data?" + params.toString()),
        api("/api/heatmap/sites/" + siteId + "/clicks?" + params.toString()),
        api("/api/heatmap/sites/" + siteId + "/scroll?" + params.toString()),
        api("/api/heatmap/sites/" + siteId + "/attention?" + params.toString())
      ]);

      cachedHeatData = heatData;
      cachedClickData = clickData;
      cachedScrollData = scrollData;
      cachedAttentionData = attentionData;

      var imgUrl = "/api/heatmap/screenshot?url=" + encodeURIComponent(pageUrl);
      previewImage.onload = function () {
        screenshotLoading.style.display = "none";
        previewImage.style.display = "";
        applyViewMode();
      };
      previewImage.onerror = function () {
        screenshotLoading.style.display = "none";
        heatmapPlaceholder.style.display = "";
        heatmapPlaceholder.innerHTML = '<p style="font-size:13px;color:#ef4444;font-weight:600">スクリーンショットの取得に失敗しました</p>';
      };
      previewImage.src = imgUrl;

      renderClickRank(clickData.clicks || []);
    } catch (e) {
      screenshotLoading.style.display = "none";
      heatmapPlaceholder.style.display = "";
      console.error("Failed to load heatmap data:", e);
    }
  }

  function applyViewMode() {
    heatmapCanvas.style.display = "none";
    scrollOverlay.style.display = "none";
    attentionOverlay.style.display = "none";

    if (currentViewMode === "click") {
      heatmapCanvas.style.display = "";
      renderHeatmap((cachedHeatData && cachedHeatData.points) || [], (cachedHeatData && cachedHeatData.meta) || {});
    } else if (currentViewMode === "scroll") {
      scrollOverlay.style.display = "";
      renderScrollMap((cachedScrollData && cachedScrollData.bands) || [], (cachedScrollData && cachedScrollData.total_sessions) || 0);
    } else if (currentViewMode === "attention") {
      attentionOverlay.style.display = "";
      renderAttentionMap((cachedAttentionData && cachedAttentionData.bands) || []);
    }
  }

  function renderHeatmap(points, meta) {
    var wrapper = document.getElementById("heatmapArea");
    var w = wrapper.offsetWidth;
    var h = wrapper.offsetHeight;
    heatmapCanvas.width = w;
    heatmapCanvas.height = h;

    var ctx = heatmapCanvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    if (points.length === 0) return;

    var maxCount = Math.max.apply(null, points.map(function (p) { return p.count; }));
    var radius = Math.max(20, Math.min(40, w / 30));

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

    colorize(ctx, w, h);
  }

  function colorize(ctx, w, h) {
    var imgData = ctx.getImageData(0, 0, w, h);
    var data = imgData.data;
    var palette = createPalette();
    for (var i = 0; i < data.length; i += 4) {
      var alpha = data[i + 3];
      if (alpha === 0) continue;
      data[i] = palette[alpha * 4];
      data[i + 1] = palette[alpha * 4 + 1];
      data[i + 2] = palette[alpha * 4 + 2];
      data[i + 3] = Math.min(255, alpha + 80);
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function createPalette() {
    var c = document.createElement("canvas");
    c.width = 256; c.height = 1;
    var ctx = c.getContext("2d");
    var g = ctx.createLinearGradient(0, 0, 256, 0);
    g.addColorStop(0, "rgba(0,0,255,1)");
    g.addColorStop(0.25, "rgba(0,255,255,1)");
    g.addColorStop(0.5, "rgba(0,255,0,1)");
    g.addColorStop(0.75, "rgba(255,255,0,1)");
    g.addColorStop(1, "rgba(255,0,0,1)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 1);
    return ctx.getImageData(0, 0, 256, 1).data;
  }

  /* ── スクロール到達マップ ── */
  function renderScrollMap(bands, totalSessions) {
    scrollOverlay.innerHTML = "";
    if (!bands.length || !totalSessions) {
      scrollOverlay.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;font-size:12px">スクロールデータなし</div>';
      return;
    }
    var wrapper = document.getElementById("heatmapArea");
    var h = wrapper.offsetHeight;

    bands.forEach(function (band) {
      var pct = band.reach_pct; // % of sessions that reached this depth
      var yStart = (band.depth_from / 100) * h;
      var bandH = ((band.depth_to - band.depth_from) / 100) * h;

      var div = document.createElement("div");
      div.className = "scroll-band";
      div.style.position = "absolute";
      div.style.left = "0";
      div.style.right = "0";
      div.style.top = yStart + "px";
      div.style.height = bandH + "px";

      // Color: green (100%) → yellow (50%) → red (0%)
      var r, g;
      if (pct >= 50) {
        r = Math.round(255 * (1 - (pct - 50) / 50));
        g = 200;
      } else {
        r = 255;
        g = Math.round(200 * (pct / 50));
      }
      div.style.background = "rgba(" + r + "," + g + ",0,0.35)";

      // Label at band boundary
      if (band.depth_from > 0 && band.depth_from % 10 === 0) {
        var label = document.createElement("div");
        label.className = "scroll-label";
        label.style.cssText = "position:absolute;top:0;right:8px;font-size:11px;font-weight:700;color:#1e293b;background:rgba(255,255,255,0.85);padding:1px 6px;border-radius:4px;pointer-events:none;";
        label.textContent = Math.round(pct) + "%";
        div.appendChild(label);
      }

      scrollOverlay.appendChild(div);
    });
  }

  /* ── 熟読エリアマップ ── */
  function renderAttentionMap(bands) {
    attentionOverlay.innerHTML = "";
    if (!bands.length) {
      attentionOverlay.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;font-size:12px">閲覧データなし</div>';
      return;
    }
    var wrapper = document.getElementById("heatmapArea");
    var h = wrapper.offsetHeight;

    var maxTime = Math.max.apply(null, bands.map(function (b) { return b.avg_time; }));
    if (maxTime <= 0) maxTime = 1;

    bands.forEach(function (band) {
      var intensity = band.avg_time / maxTime;
      var yStart = (band.depth_from / 100) * h;
      var bandH = ((band.depth_to - band.depth_from) / 100) * h;

      var div = document.createElement("div");
      div.style.position = "absolute";
      div.style.left = "0";
      div.style.right = "0";
      div.style.top = yStart + "px";
      div.style.height = bandH + "px";

      // Color: transparent (low) → red (high attention)
      var alpha = 0.1 + intensity * 0.5;
      div.style.background = "rgba(239,68,68," + alpha.toFixed(2) + ")";

      if (band.depth_from % 20 === 0) {
        var label = document.createElement("div");
        label.style.cssText = "position:absolute;top:2px;right:8px;font-size:10px;font-weight:600;color:#1e293b;background:rgba(255,255,255,0.85);padding:1px 5px;border-radius:3px;pointer-events:none;";
        label.textContent = (band.avg_time / 1000).toFixed(1) + "s";
        div.appendChild(label);
      }

      attentionOverlay.appendChild(div);
    });
  }

  /* ── クリックランキング ── */
  function renderClickRank(clicks) {
    clickRankBody.innerHTML = "";
    if (clicks.length === 0) {
      clickRankBody.innerHTML = '<tr><td colspan="4" style="padding:16px;text-align:center;font-size:12px;color:#94a3b8">データなし</td></tr>';
      return;
    }
    clicks.forEach(function (c, i) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td style="color:#94a3b8;font-weight:700">' + (i + 1) + '</td>' +
        '<td><span class="rank-tag">' + escHtml(c.element_tag || "-") + '</span></td>' +
        '<td style="color:#475569;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(c.element_text || "-") + '</td>' +
        '<td style="text-align:right;font-weight:700;color:#1e293b">' + c.count + '</td>';
      clickRankBody.appendChild(tr);
    });
  }

  /* ── 埋め込みコード ── */
  btnShowSnippet.addEventListener("click", function () {
    var site = sites.find(function (s) { return s.id === currentSiteId; });
    if (!site) return;
    snippetCode.textContent =
      '<script src="' + location.origin + '/js/seoscan-tracker.js" data-site-key="' + site.site_key + '" async><\/script>';
    snippetModal.classList.remove("hidden");
  });
  document.getElementById("btnCloseSnippet").addEventListener("click", function () { snippetModal.classList.add("hidden"); });
  document.getElementById("btnCopySnippet").addEventListener("click", function () {
    navigator.clipboard.writeText(snippetCode.textContent).then(function () {
      var btn = document.getElementById("btnCopySnippet");
      btn.textContent = "コピーしました!";
      setTimeout(function () { btn.textContent = "コピー"; }, 2000);
    });
  });

  /* ── フィルタ ── */
  document.getElementById("btnApplyFilter").addEventListener("click", function () {
    if (currentSiteId && currentPageUrl) {
      loadHeatmap(currentSiteId, currentPageUrl);
    }
  });

  /* ── ユーティリティ ── */
  function escHtml(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
})();
