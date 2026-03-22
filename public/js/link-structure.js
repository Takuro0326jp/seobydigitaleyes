/**
 * link-structure.html — Link Structure タブ
 * 内部リンク構造マップ、リンクジュースフロー、リンクジュース詳細テーブル
 */
(function () {
  "use strict";

  const PAGE_SIZE = 25;
  const LINK_MAP_DEFAULT_LIMIT = 50;
  const LINK_MAP_MAX = 200;

  let allPages = [];
  let filteredPages = [];
  let currentPage = 1;
  let sortKey = "page_rank";
  let sortAsc = false;
  let filterOrphan = false;
  let filterDepth4 = false;

  function getScanId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("scan") || params.get("scanId");
  }

  function getFocusUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("focus") ? decodeURIComponent(params.get("focus")) : null;
  }

  let linkEdges = [];
  let linkMapSim = null;
  let linkMapNodes = [];
  let linkMapLinks = [];
  let linkMapHovered = null;
  let linkMapScale = 1;
  let linkMapOx = 0;
  let linkMapOy = 0;
  let linkMapCtx = null;
  let linkMapW = 0;
  let linkMapH = 0;

  async function loadScanData() {
    const scanId = getScanId();
    if (!scanId) {
      window.location.replace("/seo.html");
      return;
    }

    const [res, edgesRes] = await Promise.all([
      fetch(`/api/scans/result/${encodeURIComponent(scanId)}`, { credentials: "include" }),
      fetch(`/api/scans/${encodeURIComponent(scanId)}/link-edges`, { credentials: "include" }),
    ]);
    if (res.status === 401) {
      window.location.replace("/");
      return;
    }
    if (res.status === 404 || !res.ok) {
      document.body.innerHTML = '<div class="p-12 text-center"><p class="text-slate-600 font-bold">スキャンが見つかりません</p><a href="/seo.html" class="inline-block mt-4 px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl">一覧へ</a></div>';
      return;
    }

    const data = await res.json();
    allPages = data.pages || [];
    const edgesData = edgesRes.ok ? await edgesRes.json() : { links: [] };
    linkEdges = edgesData.links || [];
    applyFilters();
    renderLinkJuiceTable();
    renderInternalLinkMap();
    renderLinkJuiceFlow();

    const focusUrl = getFocusUrl();
    if (focusUrl) {
      setTimeout(() => focusOnUrl(focusUrl), 300);
    }
  }

  function getStatusBadge(p) {
    const badges = [];
    if (p.is_orphan) badges.push({ label: "孤立", class: "bg-red-100 text-red-700" });
    if (p.index_status === "noindex") badges.push({ label: "noindex", class: "bg-orange-100 text-orange-700" });
    if ((p.depth || p.crawl_depth || 0) >= 4) badges.push({ label: "深さ4+", class: "bg-amber-100 text-amber-700" });
    if (badges.length === 0) badges.push({ label: "正常", class: "bg-emerald-100 text-emerald-700" });
    return badges.map((b) => `<span class="px-2 py-0.5 rounded text-[10px] font-bold ${b.class}">${b.label}</span>`).join(" ");
  }

  function getPageRankColor(pr) {
    if (pr == null) return "text-slate-400";
    if (pr >= 0.7) return "text-[#059669]";
    if (pr >= 0.4) return "text-[#D97706]";
    return "text-[#DC2626]";
  }

  function applyFilters() {
    let list = [...allPages];
    const keyword = (document.getElementById("linkTableSearch")?.value || "").toLowerCase().trim();
    if (keyword) {
      list = list.filter(
        (p) =>
          (p.url || "").toLowerCase().includes(keyword) ||
          (p.title || "").toLowerCase().includes(keyword)
      );
    }
    if (filterOrphan) list = list.filter((p) => p.is_orphan);
    if (filterDepth4) list = list.filter((p) => (p.depth || p.crawl_depth || 0) >= 4);
    filteredPages = list;
    currentPage = 1;
    sortPages();
  }

  function sortPages() {
    const key = sortKey;
    const asc = sortAsc;
    filteredPages.sort((a, b) => {
      let va = a[key];
      let vb = b[key];
      if (key === "url" || key === "title") {
        va = (va || "").toString().toLowerCase();
        vb = (vb || "").toString().toLowerCase();
        return asc ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      if (key === "status") {
        const sa = getStatusBadge(a).includes("正常") ? 0 : 1;
        const sb = getStatusBadge(b).includes("正常") ? 0 : 1;
        return asc ? sa - sb : sb - sa;
      }
      va = Number(va) ?? 0;
      vb = Number(vb) ?? 0;
      return asc ? va - vb : vb - va;
    });
  }

  function focusOnUrl(url) {
    const row = document.querySelector(`tr[data-url="${CSS.escape(url)}"]`);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("bg-blue-50", "ring-2", "ring-blue-200");
      setTimeout(() => row.classList.remove("bg-blue-50", "ring-2", "ring-blue-200"), 3000);
    }
  }

  function renderLinkJuiceTable() {
    const tbody = document.getElementById("linkJuiceTableBody");
    const infoEl = document.getElementById("linkTableInfo");
    const pageNumEl = document.getElementById("linkTablePageNum");
    const prevBtn = document.getElementById("linkTablePrev");
    const nextBtn = document.getElementById("linkTableNext");

    if (!tbody) return;

    sortPages();
    const total = filteredPages.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageData = filteredPages.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = pageData
      .map(
        (p) => {
          const pr = p.page_rank != null ? Number(p.page_rank) : null;
          const prColor = getPageRankColor(pr);
          const safeUrl = (p.url || "").replace(/"/g, "&quot;").replace(/&/g, "&amp;");
          return `
        <tr class="hover:bg-slate-50 transition" data-url="${safeUrl}">
          <td class="py-3 px-2 overflow-hidden">
            <a href="${p.url}" target="_blank" rel="noopener" class="text-blue-600 hover:underline block truncate" title="${escapeHtml(p.url || "")}">${escapeHtml(p.url || "-")}</a>
          </td>
          <td class="py-3 px-2 overflow-hidden truncate" title="${escapeHtml(p.title || "")}">${escapeHtml(p.title || "-")}</td>
          <td class="py-3 px-2 text-center font-mono font-bold ${prColor}">${pr != null ? pr.toFixed(2) : "-"}</td>
          <td class="py-3 px-2 text-center">${p.inbound_link_count != null ? p.inbound_link_count : "-"}</td>
          <td class="py-3 px-2 text-center">${p.outbound_link_count != null ? p.outbound_link_count : "-"}</td>
          <td class="py-3 px-2 text-center font-mono text-xs">${p.juice_received != null ? Number(p.juice_received).toFixed(4) : "-"}</td>
          <td class="py-3 px-2 text-center font-mono text-xs">${p.juice_sent != null ? Number(p.juice_sent).toFixed(4) : "-"}</td>
          <td class="py-3 px-2">${getStatusBadge(p)}</td>
        </tr>
      `;
        }
      )
      .join("");

    infoEl.textContent = `${total} 件中 ${start + 1}-${Math.min(start + PAGE_SIZE, total)} 件を表示`;
    pageNumEl.textContent = `${currentPage} / ${totalPages}`;
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
  }

  function escapeHtml(s) {
    if (s == null || s === undefined) return "";
    const div = document.createElement("div");
    div.textContent = String(s);
    return div.innerHTML;
  }

  function decodeUrlForDisplay(url) {
    if (!url) return "";
    try {
      return decodeURIComponent(url);
    } catch {
      return url;
    }
  }

  function exportLinkCsv() {
    sortPages();
    const headers = ["URL", "タイトル", "PageRank", "被リンク数", "発リンク数", "ジュース受信", "ジュース送出", "状態"];
    const rows = filteredPages.map((p) => {
      const status = getStatusBadge(p).replace(/<[^>]+>/g, "").trim() || "正常";
      return [
        p.url || "",
        (p.title || "").replace(/"/g, '""'),
        p.page_rank != null ? p.page_rank.toFixed(2) : "",
        p.inbound_link_count ?? "",
        p.outbound_link_count ?? "",
        p.juice_received != null ? p.juice_received.toFixed(4) : "",
        p.juice_sent != null ? p.juice_sent.toFixed(4) : "",
        status,
      ];
    });
    const csvContent = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "link_juice.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function getPageByUrl(url) {
    return allPages.find((p) => p.url === url);
  }

  function buildJuicePerEdge() {
    const pageByUrl = new Map(allPages.map((p) => [p.url, p]));
    const outbound = new Map();
    linkEdges.forEach(({ from, to }) => {
      if (from !== to) outbound.set(from, (outbound.get(from) || 0) + 1);
    });
    const juicePerEdge = new Map();
    linkEdges.forEach(({ from, to }) => {
      if (from === to) return;
      const p = pageByUrl.get(from);
      const pr = p?.page_rank != null ? Number(p.page_rank) : 0;
      const out = Math.max(outbound.get(from) || 1, 1);
      const juice = (pr * 0.85) / out;
      const key = `${from}\0${to}`;
      juicePerEdge.set(key, (juicePerEdge.get(key) || 0) + juice);
    });
    return juicePerEdge;
  }

  function getDirectories() {
    const dirs = new Set([""]);
    allPages.forEach((p) => {
      try {
        const path = new URL(p.url).pathname;
        const segs = path.split("/").filter(Boolean);
        if (segs.length > 0) dirs.add("/" + segs[0] + "/");
      } catch {}
    });
    return Array.from(dirs).sort();
  }

  function pathFromUrl(url) {
    try {
      let p = new URL(url).pathname;
      try { p = decodeURIComponent(p); } catch {}
      return p || "/";
    } catch { return "/"; }
  }

  function getNodeDir(path) {
    const segs = path.split("/").filter(Boolean);
    if (segs.length >= 2) return "/" + segs[0] + "/";
    return "/";
  }

  function getNodeColor(n) {
    if (n.id === "/") return "#F59E0B";
    if (n.orphan) return "#EF4444";
    const dirs = { "/works/": "#6366F1", "/blog/": "#8B5CF6", "/solution/": "#06B6D4", "/about/": "#10B981", "/news/": "#F97316" };
    return dirs[n.dir] || "#6366F1";
  }

  function linkMapNodeRadius(n) {
    let pr = n.pr ?? 0;
    if (pr <= 0 && (n.inbound != null || n.outbound != null)) {
      pr = Math.min(0.9, 0.05 + ((n.inbound ?? 0) * 0.03) + ((n.outbound ?? 0) * 0.01));
    }
    return Math.max(7, Math.min(pr * 38, 28));
  }

  function linkMapDraw() {
    if (!linkMapCtx || linkMapW <= 0 || linkMapH <= 0) return;
    linkMapCtx.clearRect(0, 0, linkMapW, linkMapH);
    linkMapCtx.save();
    linkMapCtx.translate(linkMapOx, linkMapOy);
    linkMapCtx.scale(linkMapScale, linkMapScale);

    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const edgeAlpha = document.getElementById("linkMapEdgesHoverOnly")?.checked ? 0 : 0.08;
    const edgeColor = isDark ? `rgba(180,180,200,${edgeAlpha || 0.25})` : `rgba(100,100,140,${edgeAlpha || 0.08})`;
    const edgeHover = isDark ? "rgba(245,158,11,0.7)" : "rgba(245,158,11,0.6)";

    linkMapLinks.forEach((l) => {
      const isHov = linkMapHovered && (l.source === linkMapHovered || l.target === linkMapHovered);
      if (!isHov && edgeAlpha === 0) return;
      linkMapCtx.beginPath();
      linkMapCtx.strokeStyle = isHov ? edgeHover : edgeColor;
      linkMapCtx.lineWidth = isHov ? 1.8 : 0.8;
      linkMapCtx.moveTo(l.source.x, l.source.y);
      linkMapCtx.lineTo(l.target.x, l.target.y);
      linkMapCtx.stroke();
      if (isHov) {
        const dx = l.target.x - l.source.x;
        const dy = l.target.y - l.source.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1) return;
        const tr = linkMapNodeRadius(l.target);
        const ex = l.target.x - (dx / len) * (tr + 2);
        const ey = l.target.y - (dy / len) * (tr + 2);
        const ang = Math.atan2(dy, dx);
        linkMapCtx.beginPath();
        linkMapCtx.fillStyle = edgeHover;
        linkMapCtx.moveTo(ex, ey);
        linkMapCtx.lineTo(ex - 9 * Math.cos(ang - 0.4), ey - 9 * Math.sin(ang - 0.4));
        linkMapCtx.lineTo(ex - 9 * Math.cos(ang + 0.4), ey - 9 * Math.sin(ang + 0.4));
        linkMapCtx.closePath();
        linkMapCtx.fill();
      }
    });

    linkMapNodes.forEach((n) => {
      const r = linkMapNodeRadius(n);
      const isHov = linkMapHovered === n;
      linkMapCtx.beginPath();
      linkMapCtx.arc(n.x, n.y, r + (isHov ? 3 : 0), 0, Math.PI * 2);
      linkMapCtx.fillStyle = getNodeColor(n);
      linkMapCtx.globalAlpha = isHov ? 1 : 0.82;
      linkMapCtx.fill();
      linkMapCtx.globalAlpha = 1;
      linkMapCtx.strokeStyle = isDark ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.8)";
      linkMapCtx.lineWidth = isHov ? 2 : 1;
      linkMapCtx.stroke();
      linkMapCtx.font = `${r > 16 ? 11 : 10}px sans-serif`;
      linkMapCtx.textAlign = "center";
      linkMapCtx.fillStyle = isDark ? "#e2e0d6" : "#1e293b";
      linkMapCtx.globalAlpha = r > 10 ? 1 : 0.7;
      linkMapCtx.fillText(n.label, n.x, n.y + r + 13);
      linkMapCtx.globalAlpha = 1;
    });

    linkMapCtx.restore();
  }

  function linkMapBuildGraph() {
    const canvas = document.getElementById("linkMapCanvas");
    const wrap = canvas?.parentElement;
    if (!canvas || !wrap || typeof d3 === "undefined") return;
    linkMapW = wrap.clientWidth;
    linkMapH = wrap.clientHeight;
    canvas.width = linkMapW;
    canvas.height = linkMapH;
    linkMapCtx = canvas.getContext("2d");

    const hasData = allPages.length > 0 && allPages.some((p) => p.page_rank != null);
    if (!hasData) {
      linkMapCtx.fillStyle = "#94a3b8";
      linkMapCtx.font = "14px sans-serif";
      linkMapCtx.textAlign = "center";
      linkMapCtx.fillText("PageRank データがありません。再スキャンしてください。", linkMapW / 2, linkMapH / 2);
      return;
    }

    const orphanOnly = document.getElementById("linkMapOrphanOnly")?.checked || false;
    const limit = Math.min(100, Math.max(5, parseInt(document.getElementById("linkMapLimit")?.value || "30", 10)));
    let dirFilter = (document.getElementById("linkMapDirFilter")?.value || "").trim();
    try {
      if (dirFilter && dirFilter.includes("%")) dirFilter = decodeURIComponent(dirFilter);
    } catch {}

    const rawNodes = allPages.map((p) => {
      const path = pathFromUrl(p.url);
      const segs = path.split("/").filter(Boolean);
      let label = segs.length > 0 ? segs[segs.length - 1] : "トップ";
      return {
        id: path,
        label,
        pr: Number(p.page_rank) ?? 0,
        depth: p.depth ?? p.crawl_depth ?? 1,
        dir: getNodeDir(path),
        orphan: !!p.is_orphan,
        url: p.url,
        inbound: p.inbound_link_count ?? 0,
        outbound: p.outbound_link_count ?? 0,
      };
    });

    let filtered = [...rawNodes];
    if (orphanOnly) filtered = filtered.filter((n) => n.orphan);
    if (dirFilter) {
      const dirNorm = dirFilter.replace(/\/+$/, "") || "";
      filtered = filtered.filter((n) => n.id === "/" || n.dir === dirFilter || n.id === dirNorm || n.id.startsWith(dirNorm + "/"));
    }
    filtered = filtered.sort((a, b) => b.pr - a.pr).slice(0, limit);
    const ids = new Set(filtered.map((n) => n.id));

    const rawLinks = linkEdges
      .map(({ from, to }) => ({ s: pathFromUrl(from), t: pathFromUrl(to) }))
      .filter((l) => l.s !== l.t && ids.has(l.s) && ids.has(l.t));

    linkMapNodes = filtered.map((n) => ({
      ...n,
      x: linkMapW / 2 + (Math.random() - 0.5) * 200,
      y: linkMapH / 2 + (Math.random() - 0.5) * 200,
    }));
    linkMapLinks = rawLinks
      .map((l) => ({
        source: linkMapNodes.find((n) => n.id === l.s),
        target: linkMapNodes.find((n) => n.id === l.t),
      }))
      .filter((l) => l.source && l.target);

    if (linkMapSim) linkMapSim.stop();
    linkMapSim = d3
      .forceSimulation(linkMapNodes)
      .force(
        "link",
        d3
          .forceLink(linkMapLinks)
          .distance((d) => {
            const sr = linkMapNodeRadius(d.source);
            const tr = linkMapNodeRadius(d.target);
            return 60 + sr + tr + 30;
          })
          .strength(0.4)
      )
      .force("charge", d3.forceManyBody().strength((n) => -200 - linkMapNodeRadius(n) * 12))
      .force("center", d3.forceCenter(linkMapW / 2, linkMapH / 2).strength(0.05))
      .force("collision", d3.forceCollide().radius((n) => linkMapNodeRadius(n) + 18))
      .alphaDecay(0.08);

    // 表示前にシミュレーションを先行実行してレイアウトを安定させる（開いた直後の激しい動きを防ぐ）
    for (let i = 0; i < 120; i++) {
      linkMapSim.tick();
    }
    linkMapSim.alphaTarget(0).alpha(0.1);
    linkMapSim.on("tick", linkMapDraw);

    document.getElementById("linkMapLimitVal").textContent = limit;
    const dirSelect = document.getElementById("linkMapDirFilter");
    if (dirSelect) {
      const dirs = getDirectories().filter(Boolean);
      dirSelect.innerHTML =
        '<option value="">すべて</option>' +
        dirs.map((d) => {
          const v = d || "/";
          const escaped = String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
          return `<option value="${escaped}">${escapeHtml(v)}</option>`;
        }).join("");
      dirSelect.value = dirFilter || "";
    }
    linkMapDraw();
  }

  function renderInternalLinkMap() {
    linkMapBuildGraph();
  }

  function attachLinkMapEventListeners() {
    const canvas = document.getElementById("linkMapCanvas");
    if (!canvas) return;

    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left - linkMapOx) / linkMapScale;
      const my = (e.clientY - rect.top - linkMapOy) / linkMapScale;
      const found = linkMapNodes.find((n) => {
        const dx = n.x - mx;
        const dy = n.y - my;
        return Math.sqrt(dx * dx + dy * dy) < linkMapNodeRadius(n) + 6;
      });
      linkMapHovered = found || null;
      canvas.style.cursor = found ? "pointer" : "default";
      const tip = document.getElementById("linkMapTooltip");
      if (found) {
        document.getElementById("linkMapTipUrl").textContent = decodeUrlForDisplay(found.url || found.id) || (found.url || found.id);
        document.getElementById("linkMapTipPr").textContent = `PageRank: ${(found.pr || 0).toFixed(2)}`;
        document.getElementById("linkMapTipIn").textContent = `被リンク: ${found.inbound ?? 0}件`;
        document.getElementById("linkMapTipOut").textContent = `発リンク: ${found.outbound ?? 0}件`;
        tip.classList.remove("hidden");
        tip.style.left = e.clientX - rect.left + 12 + "px";
        tip.style.top = e.clientY - rect.top - 10 + "px";
      } else {
        tip.classList.add("hidden");
      }
      linkMapDraw();
    });
    canvas.addEventListener("mouseleave", () => {
      linkMapHovered = null;
      document.getElementById("linkMapTooltip")?.classList.add("hidden");
      linkMapDraw();
    });

    let drag = null;
    let dragStart = null;
    canvas.addEventListener("mousedown", (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left - linkMapOx) / linkMapScale;
      const my = (e.clientY - rect.top - linkMapOy) / linkMapScale;
      const found = linkMapNodes.find((n) => {
        const dx = n.x - mx;
        const dy = n.y - my;
        return Math.sqrt(dx * dx + dy * dy) < linkMapNodeRadius(n) + 6;
      });
      if (found) {
        drag = found;
        if (linkMapSim) linkMapSim.alphaTarget(0.3).restart();
      } else {
        dragStart = { x: e.clientX - linkMapOx, y: e.clientY - linkMapOy };
      }
    });
    canvas.addEventListener("mousemove", (e) => {
      if (drag) {
        const rect = canvas.getBoundingClientRect();
        drag.fx = (e.clientX - rect.left - linkMapOx) / linkMapScale;
        drag.fy = (e.clientY - rect.top - linkMapOy) / linkMapScale;
      } else if (dragStart) {
        linkMapOx = e.clientX - dragStart.x;
        linkMapOy = e.clientY - dragStart.y;
        linkMapDraw();
      }
    });
    window.addEventListener("mouseup", () => {
      if (drag) {
        drag.fx = null;
        drag.fy = null;
        if (linkMapSim) linkMapSim.alphaTarget(0);
        drag = null;
      }
      dragStart = null;
    });

    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        linkMapScale = Math.max(0.3, Math.min(3, linkMapScale * delta));
        linkMapDraw();
      },
      { passive: false }
    );

    document.getElementById("linkMapZoomIn")?.addEventListener("click", () => {
      linkMapScale = Math.min(3, linkMapScale * 1.2);
      linkMapDraw();
    });
    document.getElementById("linkMapZoomOut")?.addEventListener("click", () => {
      linkMapScale = Math.max(0.3, linkMapScale / 1.2);
      linkMapDraw();
    });
    document.getElementById("linkMapOrphanOnly")?.addEventListener("change", () => linkMapBuildGraph());
    document.getElementById("linkMapEdgesHoverOnly")?.addEventListener("change", () => linkMapDraw());
    document.getElementById("linkMapDirFilter")?.addEventListener("change", () => linkMapBuildGraph());
    document.getElementById("linkMapLimit")?.addEventListener("input", (e) => {
      document.getElementById("linkMapLimitVal").textContent = e.target.value;
      linkMapBuildGraph();
    });
  }

  let sankeyFlowPaths = [];
  let sankeyHoveredFlow = null;
  let sankeyCtx = null;
  let sankeyW = 0;
  let sankeyH = 0;

  function sankeyPathToLabel(path) {
    if (path === "/" || path === "") return "トップ (/)";
    try {
      const decoded = path.includes("%") ? decodeURIComponent(path) : path;
      return decoded;
    } catch { return path; }
  }

  function sankeyJuiceColor(juice, minJ, maxJ) {
    const range = maxJ - minJ || 1;
    const pct = (juice - minJ) / range;
    if (pct > 0.66) return "#10B981";
    if (pct > 0.33) return "#F59E0B";
    return "#94A3B8";
  }

  function sankeyRoundRect(ctx, x, y, w, h, r, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  function sankeyDraw() {
    const canvas = document.getElementById("sankeyCanvas");
    const wrap = canvas?.parentElement;
    if (!canvas || !wrap) return;
    sankeyW = wrap.clientWidth;
    sankeyH = wrap.clientHeight;
    canvas.width = sankeyW;
    canvas.height = sankeyH;
    sankeyCtx = canvas.getContext("2d");

    const hasData = allPages.length > 0 && linkEdges.length > 0;
    if (!hasData) {
      sankeyCtx.fillStyle = "#94a3b8";
      sankeyCtx.font = "14px sans-serif";
      sankeyCtx.textAlign = "center";
      sankeyCtx.fillText("ジュースデータがありません。再スキャンしてください。", sankeyW / 2, sankeyH / 2);
      return;
    }

    const topN = parseInt(document.getElementById("sankeyCount")?.value || "10", 10);
    let dirFilter = (document.getElementById("sankeyDirFilter")?.value || "").trim();
    try {
      if (dirFilter && dirFilter.includes("%")) dirFilter = decodeURIComponent(dirFilter);
    } catch {}

    const juicePerEdge = buildJuicePerEdge();
    let flows = [];
    juicePerEdge.forEach((juice, key) => {
      const [fromUrl, toUrl] = key.split("\0");
      const fromPath = pathFromUrl(fromUrl);
      const toPath = pathFromUrl(toUrl);
      if (fromPath === toPath) return;
      flows.push({
        from: sankeyPathToLabel(fromPath),
        fromPath,
        to: sankeyPathToLabel(toPath),
        toPath,
        juice,
      });
    });

    if (dirFilter) {
      const dirNorm = dirFilter.replace(/\/+$/, "") || "";
      flows = flows.filter((f) => f.fromPath.startsWith(dirNorm) || f.fromPath === "/" || f.toPath.startsWith(dirNorm) || f.toPath === "/");
    }
    flows.sort((a, b) => b.juice - a.juice);
    flows = flows.slice(0, topN);

    if (flows.length === 0) {
      sankeyCtx.fillStyle = "#94a3b8";
      sankeyCtx.font = "14px sans-serif";
      sankeyCtx.textAlign = "center";
      sankeyCtx.fillText("フローデータがありません", sankeyW / 2, sankeyH / 2);
      return;
    }

    sankeyCtx.clearRect(0, 0, sankeyW, sankeyH);
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const labelColor = isDark ? "#c2c0b6" : "#374151";
    const nodeColor = isDark ? "#3a3a3a" : "#f1f5f9";
    const nodeBorder = isDark ? "#555" : "#cbd5e1";
    const nodeTextColor = isDark ? "#e2e0d6" : "#1e293b";

    const PAD_L = 170;
    const PAD_R = 170;
    const PAD_T = 40;
    const PAD_B = 40;
    const CW = sankeyW - PAD_L - PAD_R;
    const CH = sankeyH - PAD_T - PAD_B;
    const NODE_W = 130;
    const NODE_H = 28;
    const NODE_R = 6;
    const FLOW_X1 = PAD_L + NODE_W;
    const FLOW_X2 = sankeyW - PAD_R - NODE_W;

    const minJ = Math.min(...flows.map((f) => f.juice));
    const maxJ = Math.max(...flows.map((f) => f.juice));
    const maxThick = 28;
    const minThick = 4;

    const lefts = [...new Set(flows.map((f) => f.from))];
    const rights = [...new Set(flows.map((f) => f.to))];

    const leftGap = CH / (lefts.length + 1);
    const rightGap = CH / (rights.length + 1);
    const leftY = Object.fromEntries(lefts.map((n, i) => [n, PAD_T + leftGap * (i + 1)]));
    const rightY = Object.fromEntries(rights.map((n, i) => [n, PAD_T + rightGap * (i + 1)]));

    const leftOffset = Object.fromEntries(lefts.map((n) => [n, 0]));
    const rightOffset = Object.fromEntries(rights.map((n) => [n, 0]));

    sankeyFlowPaths = [];

    flows.forEach((f) => {
      const thick = minThick + ((f.juice - minJ) / (maxJ - minJ + 0.001)) * (maxThick - minThick);
      const col = sankeyJuiceColor(f.juice, minJ, maxJ);
      const ly = leftY[f.from];
      const ry = rightY[f.to];
      const lOff = leftOffset[f.from];
      const rOff = rightOffset[f.to];
      const y1 = ly - thick / 2 + lOff;
      const y2 = ry - thick / 2 + rOff;

      leftOffset[f.from] += thick + 2;
      rightOffset[f.to] += thick + 2;

      const isHov = sankeyHoveredFlow === f;
      sankeyCtx.beginPath();
      sankeyCtx.moveTo(FLOW_X1, y1);
      sankeyCtx.bezierCurveTo(FLOW_X1 + CW * 0.45, y1, FLOW_X2 - CW * 0.45, y2, FLOW_X2, y2);
      sankeyCtx.lineTo(FLOW_X2, y2 + thick);
      sankeyCtx.bezierCurveTo(FLOW_X2 - CW * 0.45, y2 + thick, FLOW_X1 + CW * 0.45, y1 + thick, FLOW_X1, y1 + thick);
      sankeyCtx.closePath();
      sankeyCtx.fillStyle = col;
      sankeyCtx.globalAlpha = isHov ? 0.85 : 0.38;
      sankeyCtx.fill();
      sankeyCtx.globalAlpha = 1;

      sankeyFlowPaths.push({ flow: f, y1, y2, thick, x1: FLOW_X1, x2: FLOW_X2 });
    });

    lefts.forEach((n) => {
      const y = leftY[n];
      const x = PAD_L - NODE_W - 4;
      sankeyRoundRect(sankeyCtx, x, y - NODE_H / 2, NODE_W, NODE_H, NODE_R, nodeColor, nodeBorder);
      sankeyCtx.font = "500 11px sans-serif";
      sankeyCtx.fillStyle = nodeTextColor;
      sankeyCtx.textAlign = "right";
      sankeyCtx.fillText(n.length > 18 ? n.slice(0, 17) + "…" : n, x + NODE_W - 8, y + 4);
    });

    lefts.forEach((n) => {
      const y = leftY[n];
      const total = flows.filter((f) => f.from === n).reduce((s, f) => s + f.juice, 0);
      sankeyCtx.font = "10px sans-serif";
      sankeyCtx.fillStyle = isDark ? "#888" : "#94a3b8";
      sankeyCtx.textAlign = "left";
      sankeyCtx.fillText("→ " + total.toFixed(3), PAD_L + 6, y + 4);
    });

    rights.forEach((n) => {
      const y = rightY[n];
      const x = sankeyW - PAD_R + 4;
      sankeyRoundRect(sankeyCtx, x, y - NODE_H / 2, NODE_W, NODE_H, NODE_R, nodeColor, nodeBorder);
      sankeyCtx.font = "500 11px sans-serif";
      sankeyCtx.fillStyle = nodeTextColor;
      sankeyCtx.textAlign = "left";
      sankeyCtx.fillText(n.length > 18 ? n.slice(0, 17) + "…" : n, x + 8, y + 4);
    });

    rights.forEach((n) => {
      const y = rightY[n];
      const total = flows.filter((f) => f.to === n).reduce((s, f) => s + f.juice, 0);
      sankeyCtx.font = "10px sans-serif";
      sankeyCtx.fillStyle = isDark ? "#888" : "#94a3b8";
      sankeyCtx.textAlign = "right";
      sankeyCtx.fillText("← " + total.toFixed(3), sankeyW - PAD_R - 6, y + 4);
    });

    sankeyCtx.font = "500 12px sans-serif";
    sankeyCtx.fillStyle = isDark ? "#9ca3af" : "#6b7280";
    sankeyCtx.textAlign = "center";
    sankeyCtx.fillText("ジュース送出ページ", PAD_L - NODE_W / 2 - 2, PAD_T - 16);
    sankeyCtx.fillText("ジュース受取ページ", sankeyW - PAD_R + NODE_W / 2 + 2, PAD_T - 16);

    const dirSelect = document.getElementById("sankeyDirFilter");
    if (dirSelect) {
      const dirs = getDirectories().filter(Boolean);
      dirSelect.innerHTML =
        '<option value="">すべて</option>' +
        dirs.map((d) => {
          const v = d || "/";
          const escaped = String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
          return `<option value="${escaped}">${escapeHtml(v)}</option>`;
        }).join("");
      dirSelect.value = dirFilter || "";
    }
  }

  function renderLinkJuiceFlow() {
    sankeyDraw();
  }

  function attachLinkMapListeners() {
    attachLinkMapEventListeners();
  }

  function attachSankeyListeners() {
    document.getElementById("sankeyDirFilter")?.addEventListener("change", () => renderLinkJuiceFlow());
    document.getElementById("sankeyCount")?.addEventListener("change", () => renderLinkJuiceFlow());

    const canvas = document.getElementById("sankeyCanvas");
    if (canvas) {
      canvas.addEventListener("mousemove", (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const tip = document.getElementById("sankeyTooltip");
        let found = null;
        for (const fp of sankeyFlowPaths) {
          const t = (mx - fp.x1) / (fp.x2 - fp.x1);
          if (t < 0 || t > 1) continue;
          const interpY = fp.y1 + (fp.y2 - fp.y1) * t;
          if (my >= interpY - 4 && my <= interpY + fp.thick + 4) {
            found = fp;
            break;
          }
        }
        if (found !== sankeyHoveredFlow) {
          sankeyHoveredFlow = found;
          renderLinkJuiceFlow();
        }
        if (found) {
          document.getElementById("sankeyTipMain").textContent = `${found.flow.from} → ${found.flow.to}`;
          document.getElementById("sankeyTipSub").textContent = `リンクジュース: ${found.flow.juice.toFixed(3)}`;
          tip?.classList.remove("hidden");
          tip.style.left = mx + 14 + "px";
          tip.style.top = my - 10 + "px";
          canvas.style.cursor = "pointer";
        } else {
          tip?.classList.add("hidden");
          canvas.style.cursor = "default";
        }
      });
      canvas.addEventListener("mouseleave", () => {
        sankeyHoveredFlow = null;
        document.getElementById("sankeyTooltip")?.classList.add("hidden");
        renderLinkJuiceFlow();
      });
    }

    window.addEventListener("resize", () => renderLinkJuiceFlow());
  }

  document.addEventListener("DOMContentLoaded", () => {
    attachLinkMapListeners();
    attachSankeyListeners();
    void loadScanData();

    document.getElementById("linkTableSearch")?.addEventListener("input", () => {
      applyFilters();
      renderLinkJuiceTable();
    });

    document.getElementById("linkTableSearch")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        applyFilters();
        renderLinkJuiceTable();
      }
    });

    document.getElementById("filterOrphanBtn")?.addEventListener("click", () => {
      filterOrphan = !filterOrphan;
      document.getElementById("filterOrphanBtn").classList.toggle("bg-red-100", filterOrphan);
      applyFilters();
      renderLinkJuiceTable();
    });

    document.getElementById("filterDepth4Btn")?.addEventListener("click", () => {
      filterDepth4 = !filterDepth4;
      document.getElementById("filterDepth4Btn").classList.toggle("bg-amber-100", filterDepth4);
      applyFilters();
      renderLinkJuiceTable();
    });

    document.getElementById("exportLinkCsvBtn")?.addEventListener("click", exportLinkCsv);

    document.getElementById("linkTablePrev")?.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage--;
        renderLinkJuiceTable();
      }
    });

    document.getElementById("linkTableNext")?.addEventListener("click", () => {
      const totalPages = Math.max(1, Math.ceil(filteredPages.length / PAGE_SIZE));
      if (currentPage < totalPages) {
        currentPage++;
        renderLinkJuiceTable();
      }
    });

    document.getElementById("linkJuiceTable")?.addEventListener("click", (e) => {
      const th = e.target.closest("th[data-sort]");
      if (!th) return;
      const key = th.dataset.sort;
      if (key === sortKey) sortAsc = !sortAsc;
      else {
        sortKey = key;
        sortAsc = key === "url" || key === "title";
      }
      applyFilters();
      renderLinkJuiceTable();
    });
  });
})();
