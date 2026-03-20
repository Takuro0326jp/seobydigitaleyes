/**
 * 企業管理（企業紐付け・URL登録）
 */
import { adminApi } from "../api.js";

export async function render(container) {
  const companies = await adminApi.companies.list();
  container.innerHTML = `
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-slate-900">企業管理</h2>
      <button id="btn-add-company" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">新規追加</button>
    </div>
    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table class="w-full text-left">
        <thead class="bg-slate-50 border-b border-slate-200">
          <tr>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">ID</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">企業名</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">登録URL</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">登録日</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase w-48"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100" id="companies-tbody">
          ${companies.map((c) => `
            <tr class="hover:bg-slate-50" data-company-id="${c.id}">
              <td class="px-6 py-4 text-sm text-slate-600">${c.id}</td>
              <td class="px-6 py-4 text-sm font-medium text-slate-900">${escapeHtml(c.name || "")}</td>
              <td class="px-6 py-4 text-sm text-slate-600" id="company-urls-${c.id}">—</td>
              <td class="px-6 py-4 text-sm text-slate-500">${formatDate(c.created_at)}</td>
              <td class="px-6 py-4">
                <button class="btn-edit text-indigo-600 text-sm hover:underline" data-id="${c.id}" data-name="${escapeHtml(c.name || "")}">編集</button>
                <button class="btn-urls text-indigo-600 text-sm hover:underline ml-2" data-id="${c.id}" data-name="${escapeHtml(c.name || "")}">URL管理</button>
                <button class="btn-delete text-red-600 text-sm hover:underline ml-2" data-id="${c.id}" data-name="${escapeHtml(c.name || "")}">削除</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  for (const c of companies) {
    try {
      const urls = await adminApi.companies.urls(c.id);
      const el = document.getElementById(`company-urls-${c.id}`);
      if (el) el.textContent = urls.length ? `${urls.length}件` : "0件";
    } catch {
      const el = document.getElementById(`company-urls-${c.id}`);
      if (el) el.textContent = "—";
    }
  }

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
    <div id="company-modal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-white rounded-xl p-6 w-full max-w-md">
        <h3 class="text-lg font-bold mb-4">${isEdit ? "企業編集" : "企業追加"}</h3>
        <form id="company-form" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">企業名</label>
            <input type="text" name="name" value="${escapeHtml(company?.name || "")}" required class="w-full px-4 py-2 border border-slate-200 rounded-lg">
          </div>
          <div class="flex gap-2 justify-end pt-4">
            <button type="button" id="company-modal-cancel" class="px-4 py-2 border border-slate-200 rounded-lg">キャンセル</button>
            <button type="submit" class="px-4 py-2 bg-indigo-600 text-white rounded-lg">保存</button>
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
    <div id="url-modal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <h3 class="text-lg font-bold mb-4">URL管理 — ${escapeHtml(companyName)}</h3>
        <div class="flex gap-2 mb-4">
          <input type="url" id="url-input" placeholder="https://example.com" class="flex-1 px-4 py-2 border border-slate-200 rounded-lg">
          <button type="button" id="url-add-btn" class="px-4 py-2 bg-indigo-600 text-white rounded-lg">追加</button>
        </div>
        <div class="flex-1 overflow-y-auto border border-slate-200 rounded-lg">
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
          <button type="button" id="url-modal-close" class="px-4 py-2 border border-slate-200 rounded-lg">閉じる</button>
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
      if (countEl) countEl.textContent = `${tbody.querySelectorAll("tr").length}件`;
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
