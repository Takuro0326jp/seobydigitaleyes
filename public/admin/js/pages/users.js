/**
 * ユーザー管理（企業紐付け・URLアクセス制御）
 */
import { adminApi } from "../api.js";

export async function render(container) {
  const [users, companies] = await Promise.all([
    adminApi.users.list(),
    adminApi.companies.list(),
  ]);
  const companyMap = Object.fromEntries(companies.map((c) => [c.id, c.name]));
  container.innerHTML = `
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-slate-900">ユーザー管理</h2>
      <button id="btn-add-user" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">新規追加</button>
    </div>
    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table class="w-full text-left">
        <thead class="bg-slate-50 border-b border-slate-200">
          <tr>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">ID</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Email</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Username</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">企業</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Role</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">登録日</th>
            <th class="px-6 py-4 text-xs font-semibold text-slate-500 uppercase w-24"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${users.map((u) => `
            <tr class="hover:bg-slate-50">
              <td class="px-6 py-4 text-sm text-slate-600">${u.id}</td>
              <td class="px-6 py-4 text-sm font-medium text-slate-900">${escapeHtml(u.email || "")}</td>
              <td class="px-6 py-4 text-sm text-slate-600">${escapeHtml(u.username || "—")}</td>
              <td class="px-6 py-4 text-sm text-slate-600">${escapeHtml(companyMap[u.company_id] || "—")}</td>
              <td class="px-6 py-4"><span class="px-2 py-1 text-xs font-medium rounded ${u.role === "admin" || u.role === "master" ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600"}">${escapeHtml(u.role || "user")}</span></td>
              <td class="px-6 py-4 text-sm text-slate-500">${formatDate(u.created_at)}</td>
              <td class="px-6 py-4">
                <button class="btn-edit text-indigo-600 text-sm hover:underline" data-id="${u.id}">編集</button>
                <button class="btn-delete text-red-600 text-sm hover:underline ml-2" data-id="${u.id}" data-email="${escapeHtml(u.email || "")}">削除</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  container.querySelector("#btn-add-user")?.addEventListener("click", () => void openUserModal());
  container.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => void openUserModal(users.find((u) => u.id == btn.dataset.id)));
  });
  container.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => handleDelete(btn.dataset.id, btn.dataset.email));
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

async function openUserModal(user = null) {
  const isEdit = !!user;
  const companies = await adminApi.companies.list();
  const companyOptions = companies.map((c) =>
    `<option value="${c.id}" ${user?.company_id == c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`
  ).join("");
  const html = `
    <div id="user-modal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-white rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h3 class="text-lg font-bold mb-4">${isEdit ? "ユーザー編集" : "ユーザー追加"}</h3>
        <form id="user-form" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input type="email" name="email" value="${escapeHtml(user?.email || "")}" required class="w-full px-4 py-2 border border-slate-200 rounded-lg" ${isEdit ? "readonly" : ""}>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Username</label>
            <input type="text" name="username" value="${escapeHtml(user?.username || "")}" class="w-full px-4 py-2 border border-slate-200 rounded-lg">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">企業</label>
            <select name="company_id" class="w-full px-4 py-2 border border-slate-200 rounded-lg">
              <option value="">— 未設定 —</option>
              ${companyOptions}
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Role</label>
            <select name="role" class="w-full px-4 py-2 border border-slate-200 rounded-lg">
              <option value="user" ${user?.role === "user" ? "selected" : ""}>user</option>
              <option value="admin" ${user?.role === "admin" ? "selected" : ""}>admin</option>
              <option value="master" ${user?.role === "master" ? "selected" : ""}>master</option>
            </select>
          </div>
          <div id="user-url-access-section" class="${user?.company_id ? "" : "hidden"}">
            <label class="block text-sm font-medium text-slate-700 mb-1">閲覧可能URL</label>
            <div id="user-url-access-list" class="border border-slate-200 rounded-lg p-3 max-h-32 overflow-y-auto bg-slate-50"></div>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">パスワード ${isEdit ? "(変更時のみ)" : ""}</label>
            <input type="password" name="password" ${isEdit ? "" : "required"} class="w-full px-4 py-2 border border-slate-200 rounded-lg" placeholder="${isEdit ? "空なら変更しない" : ""}">
          </div>
          <div class="flex gap-2 justify-end pt-4">
            <button type="button" id="user-modal-cancel" class="px-4 py-2 border border-slate-200 rounded-lg">キャンセル</button>
            <button type="submit" class="px-4 py-2 bg-indigo-600 text-white rounded-lg">保存</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", html);
  const modal = document.getElementById("user-modal");
  const form = document.getElementById("user-form");
  const urlSection = document.getElementById("user-url-access-section");
  const urlList = document.getElementById("user-url-access-list");
  const companySelect = form.querySelector('[name="company_id"]');

  document.getElementById("user-modal-cancel").onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  async function loadUrlAccessOptions() {
    const cid = companySelect.value;
    if (!cid) {
      urlSection.classList.add("hidden");
      return;
    }
    urlSection.classList.remove("hidden");
    try {
      const companyUrls = await adminApi.companies.urls(cid);
      const userUrls = isEdit ? await adminApi.users.urlAccess(user.id) : [];
      const userUrlIds = new Set(userUrls.map((u) => u.id));
      urlList.innerHTML = companyUrls.length
        ? companyUrls.map((cu) => `
            <label class="flex items-center gap-2 py-1 cursor-pointer">
              <input type="checkbox" name="url_ids" value="${cu.id}" ${userUrlIds.has(cu.id) ? "checked" : ""}>
              <span class="text-sm truncate" title="${escapeHtml(cu.url)}">${escapeHtml(cu.url)}</span>
            </label>
          `).join("")
        : "<p class='text-sm text-slate-500'>この企業にURLが登録されていません。企業管理でURLを追加してください。</p>";
    } catch {
      urlList.innerHTML = "<p class='text-sm text-slate-500'>読み込みエラー</p>";
    }
  }

  companySelect.addEventListener("change", loadUrlAccessOptions);
  loadUrlAccessOptions();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {
      email: fd.get("email"),
      username: fd.get("username") || null,
      role: fd.get("role"),
      company_id: fd.get("company_id") || null,
    };
    const pw = fd.get("password");
    if (pw) body.password = pw;
    const urlIds = fd.getAll("url_ids").filter(Boolean).map(Number);
    if (urlIds.length) body.url_ids = urlIds;
    try {
      if (isEdit) {
        await adminApi.users.update(user.id, body);
      } else {
        await adminApi.users.create(body);
      }
      modal.remove();
      render(document.getElementById("admin-content"));
    } catch (err) {
      alert(err.message);
    }
  };
}

async function handleDelete(id, email) {
  if (!confirm(`ユーザー「${email}」を削除しますか？`)) return;
  try {
    await adminApi.users.delete(id);
    render(document.getElementById("admin-content"));
  } catch (err) {
    alert(err.message);
  }
}
