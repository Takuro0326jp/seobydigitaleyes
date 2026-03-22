/**
 * strategy.js - SEO Strategy 4タブ構成
 * ① キーワード選別 ② 順位モニタリング ③ 対策レコメンド ④ 記事案・記事生成
 */
(function () {
  "use strict";

  let strategyData = [];
  let watchlistData = [];
  let ranksData = [];
  let recsData = [];
  let pendingArticleKeyword = null; // 対策レコメンド等から記事タブに遷移時のデフォルト選択
  let currentArticleId = null;
  let currentArticleRawBody = "";

  const params = new URLSearchParams(window.location.search);
  const scanId = params.get("scan") || params.get("scanId");

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function intentLabel(intent) {
    const map = { Informational: "情報収集", Comparative: "比較検討", Transactional: "購入・CV" };
    return map[intent || "Informational"] || intent;
  }

  function competitionLabel(c) {
    const map = { low: "低", medium: "中", high: "高" };
    return map[c] || "-";
  }

  function competitionClass(c) {
    const map = { low: "bg-emerald-100 text-emerald-700", medium: "bg-amber-100 text-amber-700", high: "bg-red-100 text-red-700" };
    return map[c] || "bg-slate-100 text-slate-500";
  }

  function getRankStatus(current, previous) {
    if (current == null) return "out";
    if (previous == null) return "new";
    const delta = previous - current;
    if (delta >= 5) return "up";
    if (delta <= -5) return "drop";
    if (Math.abs(delta) < 2) return "flat";
    return "move";
  }

  function statusLabel(s) {
    const map = { up: "急上昇", drop: "急落", flat: "変動なし", move: "小幅変動", out: "圏外", new: "初回計測" };
    return map[s] || s;
  }

  function statusClass(s) {
    const map = { up: "bg-emerald-100 text-emerald-700", drop: "bg-red-100 text-red-700", flat: "bg-slate-100 text-slate-600", move: "bg-amber-100 text-amber-700", out: "bg-red-100 text-red-700", new: "bg-blue-100 text-blue-700" };
    return map[s] || "bg-slate-100";
  }

  function updateMetrics() {
    const active = strategyData.filter((d) => d.accepted || d.status === "active");
    const pending = strategyData.filter((d) => !d.accepted && d.status !== "excluded");
    const excluded = strategyData.filter((d) => d.status === "excluded");
    const outCount = strategyData.filter((d) => (d.rank === 0 || d.rank > 50) && d.accepted).length;

    const intents = new Set(strategyData.map((d) => d.intent || "Informational"));
    const intentCoverage = intents.size >= 3 ? 100 : intents.size >= 2 ? 66 : intents.size >= 1 ? 33 : 0;

    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    el("metricAccepted", `${active.length} / ${strategyData.length}`);
    el("metricOutOfRank", outCount);
    el("metricIntentCoverage", `${intentCoverage}%`);
    el("metricExcluded", excluded.length);

    const bulkBtn = document.getElementById("btnBulkAccept");
    if (bulkBtn) bulkBtn.classList.toggle("hidden", pending.length === 0);
  }

  function renderVolumeBar(vol) {
    if (vol == null) return "-";
    const max = 10000;
    const pct = Math.min(100, Math.round((vol / max) * 100));
    return `<div class="flex items-center gap-2"><div class="w-12 h-2 bg-slate-100 rounded overflow-hidden"><div class="h-full bg-indigo-500 rounded" style="width:${pct}%"></div></div><span class="text-xs">${vol.toLocaleString()}</span></div>`;
  }

  function renderTable() {
    const body = document.getElementById("strategyTableBody");
    if (!body) return;

    const filtered = strategyData.filter((d) => d.status !== "excluded");
    const sorted = [...filtered].sort((a, b) => (a.accepted ? 0 : 1) - (b.accepted ? 0 : 1));

    if (sorted.length === 0) {
      body.innerHTML = `<tr><td colspan="7" class="p-12 text-center text-slate-400">キーワードがありません。「手動で追加」または「AI提案を取得」から登録してください。</td></tr>`;
      return;
    }

    body.innerHTML = sorted
      .map((item) => {
        const isPending = !item.accepted && item.status !== "excluded";
        return `
          <tr class="hover:bg-slate-50/50 transition-colors ${isPending ? "bg-slate-50/30" : ""}">
            <td class="p-4">
              <div class="flex items-center gap-2">
                <span class="font-bold ${isPending ? "text-slate-400" : "text-slate-800"}">${escapeHtml(item.keyword)}</span>
                ${item.is_ai ? `<span class="text-[8px] font-black ${isPending ? "bg-slate-100 text-slate-400" : "bg-indigo-50 text-indigo-500"} px-1.5 py-0.5 rounded uppercase">AI</span>` : ""}
              </div>
            </td>
            <td class="p-4"><span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">${escapeHtml(intentLabel(item.intent))}</span></td>
            <td class="p-4">${renderVolumeBar(item.search_volume)}</td>
            <td class="p-4"><span class="text-[10px] font-bold px-2 py-0.5 rounded ${competitionClass(item.competition)}">${competitionLabel(item.competition)}</span></td>
            <td class="p-4 text-[11px] text-slate-600 max-w-[200px] truncate">${escapeHtml(item.ai_reason || "-")}</td>
            <td class="p-4 text-center font-bold">${item.rank === 0 || item.rank == null ? "圏外" : item.rank}</td>
            <td class="p-4">
              <div class="flex items-center justify-center gap-2">
                ${isPending ? `
                  <button data-action="accept" data-id="${item.id}" class="p-1.5 bg-emerald-500 text-white rounded-md hover:bg-emerald-600 transition" title="承認">✓</button>
                  <button data-action="reject" data-id="${item.id}" class="p-1.5 bg-white border border-slate-200 text-slate-400 rounded-md hover:text-red-500 hover:border-red-200 transition" title="却下">✕</button>
                ` : `<span class="text-[10px] font-bold text-emerald-600">監視中</span>`}
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    body.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        const id = parseInt(btn.dataset.id, 10);
        if (action === "accept") acceptKeyword(id);
        else if (action === "reject") rejectKeyword(id);
      });
    });
  }

  async function acceptKeyword(id) {
    try {
      const res = await fetch("/api/strategy/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id, scanId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "承認に失敗しました");
      const item = strategyData.find((d) => d.id === id);
      if (item) item.accepted = true;
      updateMetrics();
      renderTable();
      fetchWatchlist();
    } catch (e) {
      alert(e.message);
    }
  }

  async function rejectKeyword(id) {
    if (!confirm("この提案を却下しますか？次回のAI提案から除外されます。")) return;
    try {
      const res = await fetch(`/api/strategy/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "却下に失敗しました");
      strategyData = strategyData.filter((d) => d.id !== id);
      updateMetrics();
      renderTable();
    } catch (e) {
      alert(e.message);
    }
  }

  async function bulkAccept() {
    const pending = strategyData.filter((d) => !d.accepted && d.status !== "excluded").map((d) => d.id);
    if (pending.length === 0) return;
    try {
      const res = await fetch("/api/strategy/accept-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids: pending, scanId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "一括承認に失敗しました");
      strategyData.forEach((d) => { if (!d.accepted && d.status !== "excluded") d.accepted = true; });
      updateMetrics();
      renderTable();
      fetchWatchlist();
    } catch (e) {
      alert(e.message);
    }
  }

  function switchTab(tab) {
    document.querySelectorAll(".tab-nav").forEach((b) => {
      b.classList.toggle("border-indigo-600", b.dataset.tab === tab);
      b.classList.toggle("text-indigo-600", b.dataset.tab === tab);
      b.classList.toggle("border-transparent", b.dataset.tab !== tab);
    });
    document.querySelectorAll(".strategy-panel").forEach((p) => p.classList.add("hidden"));
    const panel = document.getElementById("panel-" + tab);
    if (panel) panel.classList.remove("hidden");

    if (tab === "ranks") fetchRanks();
    else if (tab === "recommendations") fetchRecommendations();
    else if (tab === "articles") renderArticlePanel();
  }

  function renderRankTable() {
    const body = document.getElementById("rankTableBody");
    if (!body) return;

    const watchCount = ranksData.length;
    const top10 = ranksData.filter((r) => r.current_rank != null && r.current_rank <= 10).length;
    const dropCount = ranksData.filter((r) => r.status === "drop").length;
    const outCount = ranksData.filter((r) => r.status === "out").length;

    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    el("metricWatchCount", watchCount);
    el("metricTop10", top10);
    el("metricDropCount", dropCount);
    el("metricRankOut", outCount);

    const alertBanner = document.getElementById("rankAlertBanner");
    if (alertBanner) alertBanner.classList.toggle("hidden", dropCount === 0);

    if (ranksData.length === 0) {
      body.innerHTML = `<tr><td colspan="6" class="p-12 text-center text-slate-400">監視中のキーワードがありません。① キーワード選別でAI提案を承認してください。</td></tr>`;
      return;
    }

    body.innerHTML = ranksData
      .map((r) => {
        const deltaStr = r.delta != null ? (r.delta >= 0 ? `▲+${r.delta}` : `▼${r.delta}`) : "—";
        const deltaColor = r.delta != null ? (r.delta >= 0 ? "text-emerald-600" : "text-red-600") : "text-slate-400";
        const recs = (r.records || []).slice(0, 4).reverse();
        const spark = recs.length > 0
          ? `<div class="flex items-end gap-0.5 h-6" title="${recs.map((x) => x.rank ?? "圏外").join("→")}">
              ${recs.map((x, i) => {
                const v = x.rank != null ? Math.max(0, 50 - x.rank) : 0;
                return `<div class="w-2 bg-slate-300 rounded-sm" style="height:${Math.max(4, v)}px"></div>`;
              }).join("")}
            </div>`
          : "-";
        return `
          <tr class="hover:bg-slate-50/50">
            <td class="p-4"><span class="font-bold">${escapeHtml(r.keyword)}</span>${r.search_volume ? `<span class="text-[10px] text-slate-400 ml-1">${r.search_volume}</span>` : ""}</td>
            <td class="p-4 font-bold ${r.current_rank == null ? "text-red-500" : ""}">${r.current_rank == null ? "圏外" : r.current_rank}</td>
            <td class="p-4 ${deltaColor}">${deltaStr}</td>
            <td class="p-4">${spark}</td>
            <td class="p-4"><span class="text-[10px] font-bold px-2 py-0.5 rounded ${statusClass(r.status)}">${statusLabel(r.status)}</span></td>
            <td class="p-4 text-xs">
              ${r.current_rank == null || r.current_rank > 20 ? `<button type="button" class="text-indigo-600 hover:underline bg-transparent border-none cursor-pointer p-0 text-left" data-goto-tab="articles" data-keyword="${escapeHtml(r.keyword)}" data-keyword-id="${r.id || ""}">記事作成を提案→</button>` : ""}
              ${r.current_rank != null && r.current_rank <= 20 ? `<button type="button" class="text-amber-600 hover:underline bg-transparent border-none cursor-pointer p-0 text-left" data-goto-tab="recommendations">対策を見る→</button>` : ""}
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function renderRecommendations() {
    const list = document.getElementById("recommendationsList");
    const empty = document.getElementById("recEmpty");
    if (!list) return;

    if (recsData.length === 0) {
      list.innerHTML = "";
      if (empty) empty.classList.remove("hidden");
      return;
    }
    if (empty) empty.classList.add("hidden");

    const typeConfig = {
      create_article: { border: "#6366F1", icon: "📝", label: "記事作成" },
      enhance_content: { border: "#6366F1", icon: "📖", label: "コンテンツ強化" },
      add_internal_link: { border: "#F59E0B", icon: "🔗", label: "内部リンク" },
      improve_title: { border: "#F59E0B", icon: "✏️", label: "タイトル改善" },
    };

    list.innerHTML = recsData
      .map((r) => {
        const cfg = typeConfig[r.type] || { border: "#6366F1", icon: "📌", label: r.type };
        const articleLink = r.type === "create_article"
          ? (r.has_article
            ? `<a href="#" class="text-indigo-600 text-sm font-bold hover:underline shrink-0" data-goto-tab="articles" data-keyword="${escapeHtml(r.keyword)}" data-keyword-id="${r.keyword_id || ""}" data-load-article="1">生成した記事を見る</a>`
            : `<a href="#" class="text-indigo-600 text-sm font-bold hover:underline shrink-0" data-goto-tab="articles" data-keyword="${escapeHtml(r.keyword)}" data-keyword-id="${r.keyword_id || ""}">記事生成→</a>`)
          : "";
        return `
          <div class="flex gap-4 p-4 bg-white rounded-xl border border-slate-200" style="border-left: 4px solid ${cfg.border}">
            <span class="text-xl">${cfg.icon}</span>
            <div class="flex-1 min-w-0">
              <div class="font-bold text-slate-800">${cfg.label}: ${escapeHtml(r.keyword)}</div>
              <div class="text-xs text-slate-500 mt-1">${r.type === "create_article" ? (r.has_article ? "保存済みの記事を確認・編集できます" : "④ 記事生成タブで構成案を生成してください") : "対策ページを確認し、改善を実施してください"}</div>
            </div>
            ${articleLink}
          </div>
        `;
      })
      .join("");
  }

  function renderArticlePanel() {
    const selectEl = document.getElementById("articleKeywordSelect");
    const outlinesEl = document.getElementById("articleOutlines");
    if (!selectEl || !outlinesEl) return;

    const watch = watchlistData.length > 0 ? watchlistData : strategyData.filter((d) => d.accepted);
    if (watch.length === 0) {
      selectEl.innerHTML = "<p class='text-slate-500 text-sm'>承認済みキーワードがありません。① キーワード選別で承認してください。</p>";
      outlinesEl.innerHTML = "";
      return;
    }

    selectEl.innerHTML = `
      <label class="text-xs font-bold text-slate-600 block mb-2">キーワードを選択</label>
      <select id="articleKeywordPicker" class="w-full max-w-md border border-slate-200 rounded-lg px-4 py-2 text-sm">
        <option value="">-- 選択 --</option>
        ${watch.map((w) => `<option value="${escapeHtml(w.keyword)}" data-id="${w.id || ""}" data-intent="${escapeHtml(w.intent || "Informational")}">${escapeHtml(w.keyword)}</option>`).join("")}
      </select>
      <button id="btnGenOutlines" class="mt-3 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700">構成案を生成</button>
    `;

    const picker = document.getElementById("articleKeywordPicker");
    const toLoadArticle = pendingArticleKeyword?.loadArticle && pendingArticleKeyword?.id ? pendingArticleKeyword.id : null;
    if (picker && pendingArticleKeyword && pendingArticleKeyword.keyword) {
      const opt = Array.from(picker.options).find((o) => o.value === pendingArticleKeyword.keyword);
      if (opt) {
        picker.value = opt.value;
      }
      pendingArticleKeyword = null;
    }

    outlinesEl.innerHTML = "";
    document.getElementById("articleBodyPreview")?.classList.add("hidden");

    document.getElementById("btnGenOutlines")?.addEventListener("click", generateOutlines);
    if (toLoadArticle) loadSavedArticle(toLoadArticle);
  }

  async function loadSavedArticle(keywordId) {
    const titleEl = document.getElementById("articleBodyTitle");
    const contentEl = document.getElementById("articleBodyContent");
    const editEl = document.getElementById("articleBodyEdit");
    const previewEl = document.getElementById("articleBodyPreview");
    const btnEdit = document.getElementById("btnEditArticle");
    const btnSave = document.getElementById("btnSaveArticle");
    if (!contentEl || !previewEl) return;

    try {
      const res = await fetch(`/api/strategy/article?keyword_id=${keywordId}`, { credentials: "include" });
      if (!res.ok) throw new Error("記事の取得に失敗しました");
      const data = await res.json();
      currentArticleId = data.id;
      currentArticleRawBody = data.body || "";
      if (titleEl) titleEl.textContent = data.outline?.title || data.keyword || "";
      contentEl.innerHTML = formatArticleBody(currentArticleRawBody);
      if (editEl) editEl.value = currentArticleRawBody;
      previewEl.classList.remove("hidden");
      exitEditMode();
    } catch (e) {
      alert(e.message);
    }
  }

  function exitEditMode() {
    const contentEl = document.getElementById("articleBodyContent");
    const editEl = document.getElementById("articleBodyEdit");
    const btnEdit = document.getElementById("btnEditArticle");
    const btnSave = document.getElementById("btnSaveArticle");
    const btnCancel = document.getElementById("btnCancelEdit");
    if (contentEl) contentEl.classList.remove("hidden");
    if (editEl) {
      editEl.classList.add("hidden");
      editEl.value = currentArticleRawBody;
    }
    if (btnEdit) btnEdit.classList.remove("hidden");
    if (btnSave) btnSave.classList.add("hidden");
    if (btnCancel) btnCancel.classList.add("hidden");
  }

  function enterEditMode() {
    const contentEl = document.getElementById("articleBodyContent");
    const editEl = document.getElementById("articleBodyEdit");
    const btnEdit = document.getElementById("btnEditArticle");
    const btnSave = document.getElementById("btnSaveArticle");
    const btnCancel = document.getElementById("btnCancelEdit");
    if (contentEl) contentEl.classList.add("hidden");
    if (editEl) {
      editEl.value = currentArticleRawBody;
      editEl.classList.remove("hidden");
    }
    if (btnEdit) btnEdit.classList.add("hidden");
    if (btnSave) btnSave.classList.remove("hidden");
    if (btnCancel) btnCancel.classList.remove("hidden");
  }

  async function saveArticle() {
    if (!currentArticleId) return;
    const editEl = document.getElementById("articleBodyEdit");
    const contentEl = document.getElementById("articleBodyContent");
    const btnSave = document.getElementById("btnSaveArticle");
    const body = editEl?.value ?? "";
    if (!editEl) return;
    btnSave.disabled = true;
    btnSave.textContent = "保存中...";
    try {
      const res = await fetch(`/api/strategy/article/${currentArticleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error("保存に失敗しました");
      currentArticleRawBody = body;
      contentEl.innerHTML = formatArticleBody(body);
      exitEditMode();
    } catch (e) {
      alert(e.message);
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = "保存";
    }
  }

  async function generateOutlines() {
    const picker = document.getElementById("articleKeywordPicker");
    const opt = picker?.selectedOptions?.[0];
    const keyword = opt?.value?.trim();
    if (!keyword) {
      alert("キーワードを選択してください");
      return;
    }
    const keywordId = opt?.dataset?.id ? parseInt(opt.dataset.id, 10) : null;
    const intent = opt?.dataset?.intent || "Informational";

    const btn = document.getElementById("btnGenOutlines");
    const originalText = btn?.textContent || "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "作成中...";
    }

    try {
      const res = await fetch("/api/strategy/article-outlines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ keyword, keyword_id: keywordId, intent }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "構成案の生成に失敗しました");
      }
      const data = await res.json();
      renderOutlines(data.keyword, data.keyword_id, data.outlines || []);
    } catch (e) {
      alert(e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText || "構成案を生成";
      }
    }
  }

  function renderOutlines(keyword, keywordId, outlines) {
    const el = document.getElementById("articleOutlines");
    const preview = document.getElementById("articleBodyPreview");
    if (!el) return;

    if (outlines.length === 0) {
      el.innerHTML = "<p class='text-slate-500 col-span-3'>構成案を生成できませんでした。</p>";
      return;
    }

    el.innerHTML = outlines
      .map((o, i) => `
        <div class="p-4 bg-slate-50 rounded-xl border border-slate-200">
          <div class="text-xs font-bold text-indigo-600 mb-2">案${String.fromCharCode(65 + i)}: ${escapeHtml(o.type || "")}</div>
          <div class="font-bold text-slate-800 mb-2">${escapeHtml(o.title || "")}</div>
          <div class="text-[11px] text-slate-600 mb-3">
            ${(o.headings || []).map((h) => `<div class="ml-2">${escapeHtml(h)}</div>`).join("")}
          </div>
          <div class="text-[10px] text-slate-400 mb-3">${o.wordCount || 0}字・${o.readingMinutes || 0}分</div>
          <button data-outline='${escapeHtml(JSON.stringify(o))}' data-keyword="${escapeHtml(keyword)}" data-id="${keywordId || ""}" class="btnGenBody w-full px-3 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700">この構成で本文を生成</button>
        </div>
      `)
      .join("");

    if (preview) preview.classList.add("hidden");

    el.querySelectorAll(".btnGenBody").forEach((b) => {
      b.addEventListener("click", (ev) => {
        const outline = JSON.parse(b.dataset.outline);
        generateBody(b.dataset.keyword, outline, b.dataset.id ? parseInt(b.dataset.id, 10) : null, ev.currentTarget);
      });
    });

  }

  function formatArticleBody(text) {
    if (!text || typeof text !== "string") return "";
    const esc = (s) =>
      String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    let t = esc(text.trim());
    t = t.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    t = t.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const blocks = t.split(/\n\n+/);
    const html = blocks
      .map((b) => {
        const line = b.trim();
        if (!line) return "";
        if (line.startsWith("<h2>") || line.startsWith("<h3>")) return line;
        if (/^[-*]\s/.test(line) || /^\d+\.\s/.test(line)) {
          const items = line.split(/\n(?=\s*[-*]\s|\d+\.\s)/).map((it) => it.replace(/^\s*[-*]\s+|\d+\.\s+/, "").trim()).filter(Boolean);
          const tag = /^\d+\.\s/.test(line) ? "ol" : "ul";
          const lis = items.map((i) => `<li>${i.replace(/\n/g, "<br>")}</li>`).join("");
          return `<${tag}>${lis}</${tag}>`;
        }
        return `<p>${line.replace(/\n/g, "<br>")}</p>`;
      })
      .filter(Boolean)
      .join("");
    return html || "<p></p>";
  }

  async function generateBody(keyword, outline, keywordId, clickedBtn) {
    const titleEl = document.getElementById("articleBodyTitle");
    const contentEl = document.getElementById("articleBodyContent");
    const previewEl = document.getElementById("articleBodyPreview");
    if (!contentEl || !previewEl) return;

    previewEl.classList.remove("hidden");
    if (titleEl) titleEl.textContent = outline?.title || "";
    contentEl.innerHTML = "<p class='text-slate-500'>作成中...</p>";

    if (clickedBtn) {
      clickedBtn.disabled = true;
      clickedBtn.textContent = "作成中...";
    }

    try {
      const res = await fetch("/api/strategy/article-body", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ keyword, outline, keyword_id: keywordId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "本文の生成に失敗しました");
      }
      const data = await res.json();
      if (titleEl && outline?.title) titleEl.textContent = outline.title;
      currentArticleRawBody = data.body || "";
      currentArticleId = data.article_id || null;
      contentEl.innerHTML = formatArticleBody(currentArticleRawBody);
      document.getElementById("articleBodyEdit").value = currentArticleRawBody;
    } catch (e) {
      contentEl.innerHTML = `<p class="text-red-600">エラー: ${escapeHtml(e.message)}</p>`;
    } finally {
      if (clickedBtn) {
        clickedBtn.disabled = false;
        clickedBtn.textContent = "この構成で本文を生成";
      }
    }
  }

  async function fetchStrategy() {
    try {
      const res = await fetch("/api/strategy", { credentials: "include" });
      if (res.status === 401) { window.location.replace("/"); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      strategyData = Array.isArray(data) ? data : [];
      updateMetrics();
      renderTable();
    } catch (e) {
      console.error(e);
      const body = document.getElementById("strategyTableBody");
      if (body) body.innerHTML = `<tr><td colspan="7" class="p-12 text-center text-red-500">${escapeHtml(e.message)}</td></tr>`;
    }
  }

  async function fetchWatchlist() {
    try {
      const url = scanId ? `/api/strategy/watchlist?scanId=${encodeURIComponent(scanId)}` : "/api/strategy/watchlist";
      const res = await fetch(url, { credentials: "include" });
      if (res.ok) watchlistData = await res.json().catch(() => []);
    } catch (_) {}
  }

  async function fetchRanks() {
    try {
      const res = await fetch("/api/strategy/ranks", { credentials: "include" });
      ranksData = res.ok ? (await res.json().catch(() => [])) : [];
      if (!Array.isArray(ranksData)) ranksData = [];
      renderRankTable();
    } catch (_) {
      ranksData = [];
      renderRankTable();
    }
  }

  async function fetchRecommendations() {
    try {
      const res = await fetch("/api/strategy/recommendations", { credentials: "include" });
      if (res.ok) recsData = await res.json().catch(() => []);
      renderRecommendations();
    } catch (_) {
      recsData = [];
      renderRecommendations();
    }
  }

  function openAddKeywordModal() {
    const body = document.getElementById("modalBody");
    const overlay = document.getElementById("modalOverlay");
    if (!body || !overlay) return;

    body.innerHTML = `
      <div class="space-y-6">
        <h2 class="text-xl font-black text-slate-900">戦略キーワードの手動追加</h2>
        <div class="space-y-4">
          <div><label class="text-[10px] font-black text-slate-400 uppercase">キーワード</label>
            <input id="newKw" type="text" class="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm mt-1" placeholder="例: 彦根 ホテル">
          </div>
          <div><label class="text-[10px] font-black text-slate-400 uppercase">検索意図</label>
            <select id="newIntent" class="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm mt-1 bg-white">
              <option value="Informational">情報収集</option>
              <option value="Comparative">比較検討</option>
              <option value="Transactional">購入・CV</option>
            </select>
          </div>
        </div>
        <button id="btnAddConfirm" class="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-sm">登録して分析を開始</button>
      </div>
    `;
    overlay.classList.remove("hidden");
    document.getElementById("btnAddConfirm")?.addEventListener("click", addNewKeyword);
  }

  async function addNewKeyword() {
    const kw = (document.getElementById("newKw")?.value || "").trim();
    if (!kw) { alert("キーワードを入力してください"); return; }
    const intent = document.getElementById("newIntent")?.value || "Informational";

    try {
      const res = await fetch("/api/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ keyword: kw, intent, accepted: true }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "追加に失敗しました");
      const created = await res.json();
      strategyData.push(created);
      closeModal();
      updateMetrics();
      renderTable();
      fetchWatchlist();
    } catch (e) {
      alert(e.message);
    }
  }

  async function fetchAiProposals() {
    const mappings = JSON.parse(localStorage.getItem("gsc_mappings") || "{}");
    const propertyUrl = (scanId && mappings[scanId]) || "";
    if (!propertyUrl) {
      alert("GSC プロパティが紐づけられていません。seo.html のサイト設定から GSC プロパティを選択・保存してください。");
      return;
    }

    const btn = document.getElementById("btnAiProposals");
    if (btn) btn.disabled = true;
    try {
      const res = await fetch("/api/strategy/ai-proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ propertyUrl, scanId }),
      });
      if (res.status === 403) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Google 連携が必要です");
        return;
      }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "AI提案の取得に失敗しました");
      const data = await res.json();
      await fetchStrategy();
      if (data.added > 0) alert(`${data.added} 件のキーワードを AI 提案として登録しました。`);
    } catch (e) {
      alert(e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function closeModal() {
    document.getElementById("modalOverlay")?.classList.add("hidden");
  }

  document.getElementById("btnCopyArticle")?.addEventListener("click", () => {
    const editEl = document.getElementById("articleBodyEdit");
    const contentEl = document.getElementById("articleBodyContent");
    const text = editEl && !editEl.classList.contains("hidden")
      ? editEl.value
      : (contentEl?.textContent || "");
    navigator.clipboard.writeText(text).then(() => alert("コピーしました"));
  });
  document.getElementById("btnEditArticle")?.addEventListener("click", () => {
    if (currentArticleId) enterEditMode();
  });
  document.getElementById("btnSaveArticle")?.addEventListener("click", saveArticle);
  document.getElementById("btnCancelEdit")?.addEventListener("click", exitEditMode);

  document.addEventListener("DOMContentLoaded", () => {
    fetchStrategy();
    fetchWatchlist();

    document.getElementById("btnAddKeyword")?.addEventListener("click", openAddKeywordModal);
    document.getElementById("btnAiProposals")?.addEventListener("click", fetchAiProposals);
    document.getElementById("btnBulkAccept")?.addEventListener("click", bulkAccept);
    document.getElementById("modalCloseBtn")?.addEventListener("click", closeModal);
    document.getElementById("modalOverlay")?.addEventListener("click", (e) => {
      if (e.target.id === "modalOverlay") closeModal();
    });

    document.querySelectorAll(".tab-nav").forEach((b) => {
      b.addEventListener("click", () => switchTab(b.dataset.tab));
    });

    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-goto-tab]");
      if (btn) {
        e.preventDefault();
        const tab = btn.dataset.gotoTab;
        if (tab === "articles" && btn.dataset.keyword) {
          pendingArticleKeyword = {
            keyword: btn.dataset.keyword,
            id: btn.dataset.keywordId ? parseInt(btn.dataset.keywordId, 10) : null,
            loadArticle: !!btn.dataset.loadArticle,
          };
        }
        const nav = document.querySelector(`.tab-nav[data-tab="${tab}"]`);
        if (nav) nav.click();
      }
    });

    switchTab("keywords");
  });
})();
