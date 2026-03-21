/**
 * 企業管理（企業紐付け・URL登録）
 */
import { adminApi } from "../api.js";

export async function render(container) {
  const companies = await adminApi.companies.list();
  const urlCounts = await Promise.all(
    companies.map(async (c) => {
      try {
        const urls = await adminApi.companies.urls(c.id);
        return { id: c.id, count: urls.length };
      } catch {
        return { id: c.id, count: 0 };
      }
    })
  );
  const countMap = Object.fromEntries(urlCounts.map((uc) => [uc.id, uc.count]));

  container.innerHTML = `
    <div class="flex justify-between items-end mb-8">
      <div>
        <h2 class="text-3xl font-extrabold text-slate-900 tracking-tight">企業管理</h2>
        <p class="text-slate-500 mt-2 font-medium">クライアント企業とドメインの紐付け。</p>
      </div>
      <button id="btn-add-company" class="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl text-sm font-bold shadow-lg shadow-indigo-100 transition-all active:scale-95">新規追加</button>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6" id="companies-grid">
      ${companies.map((c) => {
        const initial = (c.name || "?").charAt(0).toUpperCase();
        const count = countMap[c.id] ?? 0;
        return `
        <div class="bg-white p-6 rounded-2xl border border-slate-200/60 shadow-sm hover:shadow-md transition-all" data-company-id="${c.id}">
          <div class="flex justify-between items-start mb-6">
            <div class="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-xl font-bold text-slate-400">${escapeHtml(initial)}</div>
            <span class="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-1 rounded border border-emerald-100 uppercase">Active</span>
          </div>
          <h3 class="text-lg font-bold text-slate-800">${escapeHtml(c.name || "")}</h3>
          <p class="text-sm text-slate-400 mt-1 mb-6" id="company-urls-${c.id}">登録URL: ${count}件</p>
          <div class="flex gap-2">
            <button class="btn-urls flex-1 bg-indigo-50 text-indigo-600 py-2.5 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-colors" data-id="${c.id}" data-name="${escapeHtml(c.name || "")}">URL管理</button>
            <button class="btn-edit px-3 bg-slate-50 text-slate-600 py-2.5 rounded-lg text-xs font-bold hover:bg-slate-100 transition-colors" data-id="${c.id}" data-name="${escapeHtml(c.name || "")}">編集</button>
            <button class="btn-delete px-3 bg-slate-50 text-slate-400 py-2.5 rounded-lg hover:bg-red-50 hover:text-red-500 transition-colors" data-id="${c.id}" data-name="${escapeHtml(c.name || "")}">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m4-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
      `;
      }).join("")}
    </div>
  `;

  container.querySelector("#btn-add-company")?.addEventListener("click", () => openModal());
  container.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => openModal({ id: btn.dataset.id, name: btn.dataset.name }));
  });
  container.querySelectorAll(".btn-urls").forEach((btn) => {
    btn.addEventListener("click", () => void openUrlModal(btn.dataset.id, btn.dataset.name));
  });
  container.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => handleDelete(btn.dataset.id, btn.dataset.name));
  });
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function formatDate(v) {
  if (!v) return "—";
  return new Date(v).toLocaleString("ja-JP");
}

function openModal(company = null) {
  const isEdit = !!company;
  const html = `
    <div id="company-modal" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div class="bg-white rounded-2xl p-6 w-full max-w-md border border-slate-200/60 shadow-2xl">
        <h3 class="text-lg font-bold mb-4">${isEdit ? "企業編集" : "企業追加"}</h3>
        <form id="company-form" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">企業名</label>
            <input type="text" name="name" value="${escapeHtml(company?.name || "")}" required class="w-full px-4 py-2 border border-slate-200 rounded-lg">
          </div>
          <div class="flex gap-2 justify-end pt-4">
            <button type="button" id="company-modal-cancel" class="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">キャンセル</button>
            <button type="submit" class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-100 transition-all">保存</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", html);
  const modal = document.getElementById("company-modal");
  const form = document.getElementById("company-form");

  document.getElementById("company-modal-cancel").onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = new FormData(form).get("name");
    try {
      if (isEdit) {
        await adminApi.companies.update(company.id, { name });
      } else {
        await adminApi.companies.create({ name });
      }
      modal.remove();
      render(document.getElementById("admin-content"));
    } catch (err) {
      alert(err.message);
    }
  };
}

async function openUrlModal(companyId, companyName) {
  let urls = [];
  try {
    urls = await adminApi.companies.urls(companyId);
  } catch {
    urls = [];
  }
  const html = `
    <div id="url-modal" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div class="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col border border-slate-200/60 shadow-2xl">
        <h3 class="text-lg font-bold mb-4">URL管理 — ${escapeHtml(companyName)}</h3>
        <div class="flex gap-2 mb-4">
          <input type="url" id="url-input" placeholder="https://example.com" class="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500">
          <button type="button" id="url-add-btn" class="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-100 transition-all">追加</button>
        </div>
        <div class="flex-1 overflow-y-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-sm">
            <thead class="bg-slate-50 sticky top-0">
              <tr>
                <th class="px-4 py-2 font-semibold text-slate-600">URL</th>
                <th class="px-4 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody id="url-list-tbody" class="divide-y divide-slate-100">
              ${urls.map((u) => `
                <tr>
                  <td class="px-4 py-2 text-slate-700 truncate max-w-md" title="${escapeHtml(u.url)}">${escapeHtml(u.url)}</td>
                  <td class="px-4 py-2"></td>
                </tr>
              `).join("")}
              ${urls.length === 0 ? "<tr><td colspan='2' class='px-4 py-6 text-center text-slate-500'>URLが登録されていません</td></tr>" : ""}
            </tbody>
          </table>
        </div>
        <div class="mt-4 flex justify-end">
          <button type="button" id="url-modal-close" class="px-5 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">閉じる</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", html);
  const modal = document.getElementById("url-modal");
  const input = document.getElementById("url-input");
  const addBtn = document.getElementById("url-add-btn");
  const tbody = document.getElementById("url-list-tbody");

  document.getElementById("url-modal-close").onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  addBtn.onclick = async () => {
    const url = (input.value || "").trim();
    if (!url) return;
    try {
      await adminApi.companies.addUrl(companyId, url);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="px-4 py-2 text-slate-700 truncate max-w-md" title="${escapeHtml(url)}">${escapeHtml(url)}</td>
        <td class="px-4 py-2"></td>
      `;
      const emptyRow = tbody.querySelector("td[colspan]");
      if (emptyRow) emptyRow.closest("tr")?.remove();
      tbody.appendChild(tr);
      input.value = "";
      const countEl = document.getElementById(`company-urls-${companyId}`);
      if (countEl) countEl.textContent = `登録URL: ${tbody.querySelectorAll("tr").length}件`;
    } catch (err) {
      alert(err.message);
    }
  };

  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addBtn.click();
    }
  };
}

async function handleDelete(id, name) {
  if (!confirm(`企業「${name}」を削除しますか？`)) return;
  try {
    await adminApi.companies.delete(id);
    render(document.getElementById("admin-content"));
  } catch (err) {
    alert(err.message);
  }
}
