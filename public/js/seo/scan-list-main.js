/**
 * プロジェクト一覧（seo.html）
 * - GET /api/scans で一覧取得・テーブル描画
 * - 検索・並び替えはフロントのみ（拡張しやすいよう分割）
 */
import { fetchMe, fetchScansList, createScan, deleteScan, fetchGscStatus, fetchGscSites, disconnectGsc, fetchCompanies, patchScanSettings } from "./api.js";

let rawList = [];
let newScanPollStop = null;
let scanPollInterval = null;
let userRole = "user"; // master | admin | user。user は閲覧のみ

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || url;
  } catch {
    return url;
  }
}

function hasScanningScans() {
  return rawList.some((r) => r.status === "running" || r.status === "queued");
}

function startScanPolling() {
  if (scanPollInterval) return;
  scanPollInterval = setInterval(async () => {
    if (!hasScanningScans()) {
      clearInterval(scanPollInterval);
      scanPollInterval = null;
      return;
    }
    try {
      const list = await fetchScansList();
      rawList = Array.isArray(list) ? list : rawList;
      updateView();
    } catch {
      /* ignore */
    }
  }, 3000);
}

function stopScanPolling() {
  if (scanPollInterval) {
    clearInterval(scanPollInterval);
    scanPollInterval = null;
  }
}

function resetNewScanModalUi() {
  const btn = document.getElementById("modal-submit-btn");
  const btnText = document.getElementById("modal-submit-text");
  if (btn) btn.disabled = false;
  if (btnText) btnText.textContent = "解析を実行する →";
  if (typeof newScanPollStop === "function") {
    newScanPollStop();
    newScanPollStop = null;
  }
}

function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function formatDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? esc(v) : d.toLocaleString("ja-JP");
}

function applySort(items, mode) {
  const copy = [...items];
  if (mode === "name") {
    copy.sort((a, b) => (a.domain || "").localeCompare(b.domain || ""));
  } else if (mode === "score") {
    copy.sort(
      (a, b) =>
        (b.avg_score ?? -1) - (a.avg_score ?? -1) ||
        new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );
  } else if (mode === "newest") {
    copy.sort(
      (a, b) =>
        new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );
  } else {
    copy.sort(
      (a, b) =>
        new Date(b.updated_at || b.created_at || 0) -
        new Date(a.updated_at || a.created_at || 0)
    );
  }
  return copy;
}

function normalizeGscUrlForCompare(url) {
  if (!url || typeof url !== "string") return "";
  const s = url.trim();
  if (s.startsWith("sc-domain:")) return s;
  try {
    const u = new URL(s);
    let p = u.pathname || "/";
    if (!p.endsWith("/")) p += "/";
    return u.origin + p;
  } catch {
    return s;
  }
}

function getGscLabel(row) {
  const mappings = JSON.parse(localStorage.getItem("gsc_mappings") || "{}");
  const saved = row.gsc_property_url || mappings[row.domain] || mappings[row.id];
  return saved ? "連携済み" : "—";
}

function filterBySearch(items, q) {
  if (!q.trim()) return items;
  const lower = q.trim().toLowerCase();
  return items.filter(
    (row) =>
      (row.domain || "").toLowerCase().includes(lower) ||
      (row.id || "").toLowerCase().includes(lower)
  );
}

/** 同一ドメインは1件だけ（最終更新が新しい行を残す）— API が古くても表示を防ぐ */
function dedupeScansByDomain(items) {
  const sorted = [...items].sort(
    (a, b) =>
      new Date(b.updated_at || b.created_at || 0) -
      new Date(a.updated_at || a.created_at || 0)
  );
  const seen = new Set();
  const out = [];
  for (const row of sorted) {
    let k = String(row.domain || "").trim().toLowerCase();
    if (k.startsWith("www.")) k = k.slice(4);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(row);
  }
  return out;
}

function renderTable(tbody, items) {
  if (!tbody) return;
  tbody.innerHTML = "";
  const canWrite = userRole === "admin" || userRole === "master";

  items.forEach((row, i) => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50/80 transition-colors";
    const actionsHtml = canWrite
      ? `
        <button type="button" class="action-btn p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-indigo-600 transition-colors" data-action="gsc" data-scan-id="${esc(row.id)}" data-domain="${esc(row.domain || "")}" title="GSC設定">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
        </button>
        <button type="button" class="action-btn p-2 rounded-lg hover:bg-red-50 text-slate-500 hover:text-red-600 transition-colors" data-action="delete" data-scan-id="${esc(row.id)}" data-domain="${esc(row.domain || "")}" title="削除">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      `
      : `
        <button type="button" class="action-btn p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-indigo-600 transition-colors" data-action="gsc" data-scan-id="${esc(row.id)}" data-domain="${esc(row.domain || "")}" title="GSC設定">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
        </button>
      `;
    const isScanning = row.status === "running" || row.status === "queued";
    const isFailed = row.status === "failed";
    const statusLabel = isScanning ? "診断中" : esc(row.status || "");
    const statusClass = isScanning ? "text-amber-600" : isFailed ? "text-red-600" : "text-indigo-600";
    const errorHint = isFailed && row.error_message ? `<div class="text-[10px] text-red-500 mt-1 truncate max-w-[200px]" title="${esc(row.error_message)}">${esc(row.error_message)}</div>` : "";
    const domainCell = isScanning
      ? `<span class="font-black text-sm text-slate-900">${esc(row.domain)}</span><div class="text-[10px] text-amber-600 font-bold mt-1">診断中 — 完了までお待ちください</div>`
      : `<a href="/result.html?scan=${encodeURIComponent(row.id)}" class="font-black text-sm text-slate-900 hover:text-indigo-600 hover:underline">${esc(row.domain)}</a><div class="text-[10px] text-slate-400 font-mono mt-1">${esc(row.id)}</div>`;
    tr.innerHTML = `
      <td class="px-8 py-5 text-xs font-mono text-slate-400">${i + 1}</td>
      <td class="px-8 py-5">
        ${domainCell}
      </td>
      <td class="px-8 py-5 text-center text-xs text-slate-600">${esc(row.company_name || "—")}</td>
      <td class="px-8 py-5 text-center text-xs text-slate-400">${getGscLabel(row)}</td>
      <td class="px-8 py-5 text-center text-xs font-bold text-slate-600">${formatDate(row.created_at)}</td>
      <td class="px-8 py-5 text-center text-xs font-bold text-slate-600">${formatDate(row.updated_at || row.created_at)}</td>
      <td class="px-8 py-5 text-center text-xs font-black ${
        row.avg_score != null
          ? row.avg_score >= 70
            ? "text-emerald-600"
            : row.avg_score >= 50
              ? "text-amber-600"
              : "text-red-600"
          : "text-slate-400"
      }">${row.avg_score != null ? esc(String(row.avg_score)) : isScanning ? "…" : "—"}</td>
      <td class="px-8 py-5 text-right">
        <div class="flex items-center justify-end gap-2">
          <div class="text-right">
            <span class="text-[10px] font-black uppercase ${statusClass}">${statusLabel}</span>
            ${errorHint}
          </div>
          ${actionsHtml}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function setupActionDelegation() {
  const tbody = document.getElementById("siteListTable");
  if (!tbody) return;
  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest(".action-btn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const scanId = btn.dataset.scanId;
    const domain = btn.dataset.domain;
    if (btn.dataset.action === "gsc") openGscModal(scanId, domain);
    else if (btn.dataset.action === "delete") handleDelete(scanId, domain);
  });
}

let currentSettingsScanId = null;

async function openGscModal(scanId, domain, options = {}) {
  const { justLinked = false } = options;
  currentSettingsScanId = scanId;
  const modal = document.getElementById("siteSettingsModal");
  const domainEl = document.getElementById("siteSettingsDomain");
  const gscNotLinked = document.getElementById("gscNotLinked");
  const gscLinked = document.getElementById("gscLinked");
  const gscPropertySelect = document.getElementById("gscPropertySelect");
  const gscUrlStatus = document.getElementById("gscUrlStatus");
  const gscUrlStatusDot = document.getElementById("gscUrlStatusDot");
  const gscUrlStatusText = document.getElementById("gscUrlStatusText");
  const gscUnlinkUrlBtn = document.getElementById("gscUnlinkUrlBtn");
  const clientSelect = document.getElementById("clientSelect");

  if (domainEl) domainEl.textContent = domain || scanId;
  modal?.classList.remove("hidden");

  gscNotLinked?.classList.remove("hidden");
  gscLinked?.classList.add("hidden");

  const gscLinkBtn = document.getElementById("gscLinkBtn");
  if (gscLinkBtn) gscLinkBtn.href = `/api/auth/google?link_for=${encodeURIComponent(scanId)}`;

  const currentCompanyId = rawList.find((r) => r.id === scanId)?.company_id ?? null;

  try {
    const companies = await fetchCompanies();
    if (clientSelect) {
      clientSelect.innerHTML =
        '<option value="">未設定</option>' +
        (companies || []).map((c) =>
          `<option value="${c.id}" ${c.id == currentCompanyId ? "selected" : ""}>${esc(c.name || "")}</option>`
        ).join("");
    }
  } catch (e) {
    if (clientSelect) {
      clientSelect.innerHTML = '<option value="">未設定</option>';
    }
  }

  try {
    const actuallyLinked = justLinked || (await fetchGscStatus(scanId))?.linked;
    if (!actuallyLinked) {
      gscNotLinked?.classList.remove("hidden");
      gscLinked?.classList.add("hidden");
      return;
    }
    let sites = [];
    try {
      const res = await fetchGscSites(scanId);
      sites = res?.sites || [];
    } catch (e) {
      gscNotLinked?.classList.remove("hidden");
      gscLinked?.classList.add("hidden");
      return;
    }
    gscNotLinked?.classList.add("hidden");
    gscLinked?.classList.remove("hidden");
    const row = rawList.find((r) => r.id === scanId);
    const domain = row?.domain || "";
    const mappings = JSON.parse(localStorage.getItem("gsc_mappings") || "{}");
    const saved = row?.gsc_property_url || mappings[domain] || mappings[scanId] || "";
    const hasUrlMapping = !!saved;

    if (gscUrlStatus) gscUrlStatus.className = `text-xs font-bold flex items-center gap-2 ${hasUrlMapping ? "text-emerald-600" : "text-slate-500"}`;
    if (gscUrlStatusDot) {
      gscUrlStatusDot.className = `w-2 h-2 rounded-full ${hasUrlMapping ? "bg-emerald-500" : "bg-slate-300"}`;
    }
    if (gscUrlStatusText) gscUrlStatusText.textContent = hasUrlMapping ? "連携済み（このURL）" : "未連携";
    if (gscUnlinkUrlBtn) {
      gscUnlinkUrlBtn.classList.toggle("hidden", !hasUrlMapping);
    }

    if (gscPropertySelect) {
      const siteUrls = new Set((sites || []).map((s) => normalizeGscUrlForCompare(s.siteUrl)));
      const savedNorm = normalizeGscUrlForCompare(saved);
      const savedNotInList = saved && !siteUrls.has(savedNorm);
      let opts = '<option value="">プロパティを選択</option>';
      if (savedNotInList) {
        opts += `<option value="${esc(saved)}" selected>${esc(saved)}</option>`;
      }
      (sites || []).forEach((s) => {
        const isSelected = !savedNotInList && normalizeGscUrlForCompare(s.siteUrl) === savedNorm;
        opts += `<option value="${esc(s.siteUrl)}" ${isSelected ? "selected" : ""}>${esc(s.siteUrl)}</option>`;
      });
      gscPropertySelect.innerHTML = opts;
    }
  } catch (e) {
    gscNotLinked?.classList.remove("hidden");
    gscLinked?.classList.add("hidden");
  }
}

function handleDelete(scanId, domain) {
  if (!confirm(`「${domain || scanId}」を削除しますか？`)) return;
  deleteScan(scanId)
    .then(() => {
      rawList = rawList.filter((r) => r.id !== scanId);
      updateView();
    })
    .catch((err) => {
      alert(err.message || "削除に失敗しました");
    });
}

function updateView() {
  const tbody = document.getElementById("siteListTable");
  const countEl = document.getElementById("project-count");
  const emptyState = document.getElementById("emptyState");
  const tableWrap = tbody?.closest(".overflow-x-auto");
  const sortMode =
    document.getElementById("sortOrder")?.value || "updated";
  const search = document.getElementById("siteSearchInput")?.value || "";

  const sorted = applySort(dedupeScansByDomain(rawList), sortMode);
  const filtered = filterBySearch(sorted, search);

  if (countEl) {
    countEl.textContent =
      filtered.length === 0
        ? "0 件のサイト"
        : `${filtered.length} 件のサイト`;
  }

  const progHeader = document.getElementById("scan-progress-header");
  if (progHeader) {
    progHeader.textContent = hasScanningScans()
      ? "診断中… 完了までお待ちください（自動更新）"
      : "";
  }

  if (filtered.length === 0) {
    if (tableWrap) tableWrap.classList.add("hidden");
    emptyState?.classList.remove("hidden");
  } else {
    if (tableWrap) tableWrap.classList.remove("hidden");
    emptyState?.classList.add("hidden");
    renderTable(tbody, filtered);
  }
}

function wireModals() {
  const modal = document.getElementById("newScanModal");
  document.getElementById("openScanBtn")?.addEventListener("click", () => {
    modal?.classList.remove("hidden");
  });
  document.getElementById("closeScanBtn")?.addEventListener("click", () => {
    resetNewScanModalUi();
    modal?.classList.add("hidden");
  });
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) {
      resetNewScanModalUi();
      modal.classList.add("hidden");
    }
  });

  document.getElementById("new-scan-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("targetUrlInput");
    const errEl = document.getElementById("scanError");
    const btn = document.getElementById("modal-submit-btn");
    const btnText = document.getElementById("modal-submit-text");
    const progEl = document.getElementById("scan-progress-modal");
    const url = input?.value?.trim() || "";

    errEl?.classList.add("hidden");
    if (!url) return;
    if (!confirm("診断を開始します。よろしいですか？")) return;

    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = "送信中…";
    if (progEl) progEl.textContent = "";

    try {
      const { scanId, status } = await createScan(url);
      if (scanId) {
        const domain = domainFromUrl(url);
        const newRow = {
          id: scanId,
          domain,
          status: status || "queued",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          avg_score: null,
          company_id: null,
          company_name: null,
          gsc_property_url: null,
        };
        rawList = [newRow, ...rawList.filter((r) => r.id !== scanId)];
        updateView();
        startScanPolling();
        resetNewScanModalUi();
        modal?.classList.add("hidden");
        try {
          const list = await fetchScansList();
          rawList = Array.isArray(list) ? list : rawList;
          updateView();
        } catch {
          /* ignore */
        }
        return;
      }
    } catch (err) {
      if (btn) btn.disabled = false;
      if (btnText) btnText.textContent = "解析を実行する →";
      if (errEl) {
        errEl.textContent =
          err.message ||
          (err.status === 401
            ? "ログインが切れました。"
            : "診断の開始に失敗しました。");
        errEl.classList.remove("hidden");
      }
    }
  });

  const settingsModal = document.getElementById("siteSettingsModal");
  const closeSettings = () => {
    settingsModal?.classList.add("hidden");
    currentSettingsScanId = null;
  };
  document.getElementById("closeSiteSettingsBtn")?.addEventListener("click", closeSettings);
  document.getElementById("cancelSiteSettingsBtn")?.addEventListener("click", closeSettings);
  document.getElementById("saveSiteSettingsBtn")?.addEventListener("click", async () => {
    if (!currentSettingsScanId) {
      closeSettings();
      return;
    }
    const gscPropertySelect = document.getElementById("gscPropertySelect");
    const clientSelect = document.getElementById("clientSelect");
    const propertyUrl = (gscPropertySelect?.value || "").trim();
    const companyId = (clientSelect?.value || "").trim() ? parseInt(clientSelect.value, 10) : null;
    const row = rawList.find((r) => r.id === currentSettingsScanId);
    const domain = row?.domain || "";

    const mappings = JSON.parse(localStorage.getItem("gsc_mappings") || "{}");
    if (propertyUrl) {
      if (domain) mappings[domain] = propertyUrl;
      mappings[currentSettingsScanId] = propertyUrl;
      localStorage.setItem("gsc_mappings", JSON.stringify(mappings));
    } else {
      if (domain) delete mappings[domain];
      delete mappings[currentSettingsScanId];
      localStorage.setItem("gsc_mappings", JSON.stringify(mappings));
    }

    try {
      const patchBody = { gsc_property_url: propertyUrl || null };
      if (companyId != null && !isNaN(companyId)) patchBody.company_id = companyId;
      await patchScanSettings(currentSettingsScanId, patchBody);
      const row = rawList.find((r) => r.id === currentSettingsScanId);
      if (row) {
        if (companyId != null) {
          row.company_id = companyId;
          const sel = clientSelect?.options[clientSelect.selectedIndex];
          row.company_name = sel?.textContent?.trim() || null;
        }
        row.gsc_property_url = propertyUrl || null;
      }
      updateView();
    } catch (e) {
      alert(e.message || "設定の保存に失敗しました");
    }

    alert(propertyUrl ? "GSC プロパティを保存しました。gsc.html でデータを確認できます。" : "GSC プロパティの紐づけを解除しました。");
    closeSettings();
  });

  document.getElementById("gscUnlinkUrlBtn")?.addEventListener("click", async () => {
    if (!currentSettingsScanId) return;
    if (!confirm("このURLとGSCプロパティの紐づけを解除しますか？")) return;
    const row = rawList.find((r) => r.id === currentSettingsScanId);
    const domain = row?.domain || "";
    try {
      await patchScanSettings(currentSettingsScanId, { gsc_property_url: null });
      const mappings = JSON.parse(localStorage.getItem("gsc_mappings") || "{}");
      if (domain) delete mappings[domain];
      delete mappings[currentSettingsScanId];
      localStorage.setItem("gsc_mappings", JSON.stringify(mappings));
      const row = rawList.find((r) => r.id === currentSettingsScanId);
      if (row) row.gsc_property_url = null;
      updateView();
      openGscModal(currentSettingsScanId, row?.domain || currentSettingsScanId);
    } catch (e) {
      alert(e.message || "紐づけ解除に失敗しました");
    }
  });

  document.getElementById("gscDisconnectAccountBtn")?.addEventListener("click", async () => {
    if (!currentSettingsScanId) return;
    if (!confirm("このURLのGoogleアカウント連携を解除しますか？")) return;
    try {
      await disconnectGsc(currentSettingsScanId);
      const gscNotLinked = document.getElementById("gscNotLinked");
      const gscLinked = document.getElementById("gscLinked");
      gscNotLinked?.classList.remove("hidden");
      gscLinked?.classList.add("hidden");
    } catch (e) {
      alert(e.message || "連携解除に失敗しました");
    }
  });
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const linkedScanId = params.get("gsc") === "linked" ? params.get("scan") : null;
  if (params.get("gsc") === "linked") {
    history.replaceState(null, "", "/seo.html");
    alert("Google Search Console と連携しました。プロパティを選択して保存してください。");
  }
  if (params.get("gsc_error")) {
    history.replaceState(null, "", "/seo.html");
    alert("Google 連携に失敗しました: " + params.get("gsc_error"));
  }

  const me = await fetchMe();
  if (!me || !me.id) {
    window.location.replace("/");
    return;
  }
  userRole = (me.role || "user").toLowerCase();

  wireModals();
  setupActionDelegation();

  document.getElementById("openScanBtn")?.toggleAttribute("hidden", userRole === "user");

  document.getElementById("siteSearchInput")?.addEventListener("input", updateView);
  document.getElementById("sortOrder")?.addEventListener("change", updateView);

  try {
    const list = await fetchScansList();
    rawList = Array.isArray(list) ? list : [];
  } catch (e) {
    if (e.status === 401) {
      window.location.replace("/");
      return;
    }
    rawList = [];
    document.getElementById("project-count").textContent =
      "一覧の取得に失敗しました";
  }

  updateView();

  if (hasScanningScans()) {
    startScanPolling();
  }

  if (linkedScanId) {
    const row = rawList.find((r) => r.id === linkedScanId);
    setTimeout(() => openGscModal(linkedScanId, row?.domain || linkedScanId, { justLinked: true }), 100);
  }
}

document.addEventListener("DOMContentLoaded", init);
