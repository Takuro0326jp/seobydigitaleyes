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
  function initials(u) {
    if (u.username && u.username.length >= 2) return (u.username.slice(0, 2)).toUpperCase();
    const e = (u.email || "").split("@")[0] || "";
    return (e.slice(0, 2) || "?").toUpperCase();
  }
  container.innerHTML = `
    <div class="flex justify-between items-end mb-8">
      <div>
        <h2 class="text-3xl font-extrabold text-slate-900 tracking-tight">ユーザー管理</h2>
        <p class="text-slate-500 mt-2 font-medium">権限設定とアクセス制御を行います。</p>
      </div>
      <button id="btn-add-user" class="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl text-sm font-bold shadow-lg shadow-indigo-100 transition-all active:scale-95">新規ユーザー追加</button>
    </div>
    <div class="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-x-auto">
      <table class="w-full min-w-[56rem] text-left border-collapse" style="writing-mode: horizontal-tb;">
        <thead class="bg-slate-50/50 border-b border-slate-200/60">
          <tr>
            <th class="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap min-w-[14rem]">Email / Name</th>
            <th class="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap min-w-[9rem] max-w-[16rem]">所属企業</th>
            <th class="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap w-[6.5rem]">ロール</th>
            <th class="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap min-w-[11rem]">閲覧可能URL</th>
            <th class="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap min-w-[9rem]">登録日</th>
            <th class="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap min-w-[7rem]">初回アクセス</th>
            <th class="px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap min-w-[7rem]">最終アクセス</th>
            <th class="px-4 py-3 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap min-w-[9.5rem] sticky right-0 bg-slate-50/95 backdrop-blur-sm border-l border-slate-200/60 z-[1]">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${users.map((u) => {
            const role = (u.role || "user").toLowerCase();
            const isElevated = role === "admin" || role === "master";
            const roleBadgeClass = isElevated
              ? "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200/80"
              : "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200/90";
            return `
            <tr class="hover:bg-slate-50/80 transition-colors group align-middle">
              <td class="px-4 py-3 align-middle">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="w-10 h-10 shrink-0 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">${escapeHtml(initials(u))}</div>
                  <div class="min-w-0">
                    <p class="text-sm font-bold text-slate-800 truncate">${escapeHtml(u.email || "")}</p>
                    <p class="text-xs text-slate-400 truncate">${escapeHtml(u.username || "—")}</p>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 text-sm font-medium text-slate-600 align-middle min-w-[9rem] max-w-[16rem] whitespace-normal break-words [word-break:normal]" style="writing-mode: horizontal-tb;">${escapeHtml(companyMap[u.company_id] || "—")}</td>
              <td class="px-4 py-3 align-middle w-[6.5rem]">
                <span class="inline-flex items-center justify-center min-w-[4.25rem] px-3 py-1 rounded-full text-[11px] font-semibold leading-none ${roleBadgeClass}">${escapeHtml(u.role || "user")}</span>
              </td>
              <td class="px-4 py-3 text-sm text-slate-600 align-middle min-w-[11rem] max-w-[14rem]">
                ${u.url_list ? u.url_list.split("\n").map((url) => `<span class="block truncate" title="${escapeHtml(url)}">${escapeHtml(url)}</span>`).join("") : "—"}
              </td>
              <td class="px-4 py-3 text-sm text-slate-500 align-middle whitespace-nowrap">${formatDate(u.created_at)}</td>
              <td class="px-4 py-3 text-sm text-slate-500 align-middle whitespace-nowrap">${formatDate(u.first_access_at)}</td>
              <td class="px-4 py-3 text-sm text-slate-500 align-middle whitespace-nowrap">${formatDate(u.last_access_at)}</td>
              <td class="px-4 py-3 text-right align-middle min-w-[9.5rem] sticky right-0 bg-white group-hover:bg-slate-50/95 border-l border-slate-100 z-[1] shadow-[-4px_0_8px_-4px_rgba(15,23,42,0.08)]">
                <div class="flex flex-wrap items-center justify-end gap-1">
                  <button type="button" class="btn-edit shrink-0 text-slate-500 hover:text-indigo-600 font-bold text-[11px] uppercase tracking-wide px-2.5 py-1.5 rounded-lg hover:bg-indigo-50/80 transition-all" data-id="${u.id}">Edit</button>
                  <button type="button" class="btn-delete shrink-0 text-slate-500 hover:text-red-600 font-bold text-[11px] px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-all" data-id="${u.id}" data-email="${escapeHtml(u.email || "")}">削除</button>
                </div>
              </td>
            </tr>
          `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;

  container.querySelector("#btn-add-user")?.addEventListener("click", () => void openUserModal(null, companies));
  container.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => void openUserModal(users.find((u) => u.id == btn.dataset.id), companies));
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

async function openUserModal(user = null, companiesCache = null) {
  const isEdit = !!user;
  const companies = companiesCache || (await adminApi.companies.list());
  const companyOptions = companies.map((c) =>
    `<option value="${c.id}" ${user?.company_id == c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`
  ).join("");
  const html = `
    <div id="user-modal" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-[24rem] max-h-[90vh] overflow-y-auto p-6 sm:p-8 border border-slate-200/60">
        <h3 class="text-lg font-bold mb-4">${isEdit ? "ユーザー編集" : "ユーザー追加"}</h3>
        <form id="user-form" class="space-y-3">
          <div class="flex items-center gap-3">
            <label class="text-sm font-medium text-slate-700 w-40 flex-shrink-0">Email</label>
            <input type="email" name="email" value="${escapeHtml(user?.email || "")}" required class="flex-1 min-w-0 px-4 py-2 border border-slate-200 rounded-lg" ${isEdit ? "readonly" : ""}>
          </div>
          <div class="flex items-center gap-3">
            <label class="text-sm font-medium text-slate-700 w-40 flex-shrink-0">Username</label>
            <input type="text" name="username" value="${escapeHtml(user?.username || "")}" class="flex-1 min-w-0 px-4 py-2 border border-slate-200 rounded-lg">
          </div>
          <div class="flex items-center gap-3">
            <label class="text-sm font-medium text-slate-700 w-40 flex-shrink-0">企業</label>
            <select name="company_id" class="flex-1 min-w-0 px-4 py-2 border border-slate-200 rounded-lg">
              <option value="">— 未設定 —</option>
              ${companyOptions}
            </select>
          </div>
          <div class="flex items-center gap-3">
            <label class="text-sm font-medium text-slate-700 w-40 flex-shrink-0">Role</label>
            <select name="role" class="flex-1 min-w-0 px-4 py-2 border border-slate-200 rounded-lg">
              <option value="user" ${user?.role === "user" ? "selected" : ""}>user</option>
              <option value="admin" ${user?.role === "admin" ? "selected" : ""}>admin</option>
              <option value="master" ${user?.role === "master" ? "selected" : ""}>master</option>
            </select>
          </div>
          <div class="flex items-center gap-3">
            <label class="text-sm font-medium text-slate-700 w-40 flex-shrink-0"></label>
            <div class="flex-1 flex items-center gap-2">
              <input type="checkbox" id="invite-checkbox" name="invite" class="rounded border-slate-300">
              <label for="invite-checkbox" class="text-sm font-medium text-slate-700">${isEdit ? "招待メールを再送" : "招待メールを送信（ユーザーがパスワードを設定）"}</label>
            </div>
          </div>
          <div id="user-url-access-section" class="${user?.company_id ? "" : "hidden"} space-y-1">
            <label class="block text-sm font-medium text-slate-700">閲覧可能URL</label>
            <input type="text" id="url-search-input" placeholder="URLで検索..." class="w-full px-3 py-2 mb-2 text-sm border border-slate-200 rounded-lg bg-white">
            <div id="user-url-access-list" class="border border-slate-200 rounded-lg p-3 overflow-y-auto bg-slate-50 text-sm" style="height: 10.5rem; max-height: 10.5rem;"></div>
          </div>
          <div id="password-section" class="flex items-center gap-3">
            <label class="text-sm font-medium text-slate-700 w-40 flex-shrink-0 whitespace-nowrap">パスワード ${isEdit ? "(変更時のみ)" : ""}</label>
            <input type="password" name="password" id="password-input" class="flex-1 min-w-0 px-4 py-2 border border-slate-200 rounded-lg" placeholder="${isEdit ? "空なら変更しない" : "招待しない場合のみ必須"}" ${isEdit ? "" : "required"}>
          </div>
          <div class="flex gap-2 justify-end pt-4">
            <button type="button" id="user-modal-cancel" class="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">キャンセル</button>
            <button type="submit" class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-100 transition-all">保存</button>
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
  const submitBtn = form.querySelector('button[type="submit"]');
  /** none=企業なし / loading=一覧取得中 / ok=送信してよい / error=送信時は url_ids を付けない（既存権限を維持） */
  let urlListLoadState = companySelect.value ? "loading" : "none";

  document.getElementById("user-modal-cancel").onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  function setSubmitBlocked(blocked, loadingLabel) {
    if (!submitBtn) return;
    submitBtn.disabled = blocked;
    submitBtn.textContent = blocked && loadingLabel ? loadingLabel : "保存";
  }

  async function loadUrlAccessOptions() {
    const cid = companySelect.value;
    const searchInputEl = form.querySelector("#url-search-input");
    if (searchInputEl) searchInputEl.value = "";
    if (!cid) {
      urlSection.classList.add("hidden");
      urlListLoadState = "none";
      setSubmitBlocked(false);
      return;
    }
    urlListLoadState = "loading";
    setSubmitBlocked(true, "URL一覧を読み込み中…");
    urlSection.classList.remove("hidden");
    try {
      const companyUrls = await adminApi.companies.urls(cid, { scannedOnly: true });
      const userUrls = isEdit ? await adminApi.users.urlAccess(user.id, cid) : [];
      const norm = (u) => (u || "").replace(/\/$/, "") || u;
      const userUrlKeys = new Set(userUrls.map((u) => norm(u.url)));
      const isChecked = (cu) => userUrlKeys.has(norm(cu.url)) || userUrls.some((u) => u.id === cu.id);
      const searchInput = form.querySelector("#url-search-input");
      if (searchInput) searchInput.style.display = companyUrls.length ? "block" : "none";
      urlList.innerHTML = companyUrls.length
        ? companyUrls.map((cu) => `
            <label class="flex items-center gap-2 py-1 cursor-pointer url-access-item" data-url="${escapeHtml(cu.url)}">
              <input type="checkbox" name="url_ids" value="${cu.id}" ${isChecked(cu) ? "checked" : ""}>
              <span class="text-sm truncate" title="${escapeHtml(cu.url)}">${escapeHtml(cu.url)}</span>
            </label>
          `).join("")
        : "<p class='text-sm text-slate-500'>この企業でスキャン実行済みのURLがありません。診断を実行するとここに表示されます。</p>";
      urlListLoadState = "ok";
    } catch {
      urlList.innerHTML = "<p class='text-sm text-slate-500'>読み込みエラー</p>";
      urlListLoadState = "error";
    } finally {
      setSubmitBlocked(false);
    }
  }

  companySelect.addEventListener("change", loadUrlAccessOptions);
  loadUrlAccessOptions();

  const searchInput = form.querySelector("#url-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.trim().toLowerCase();
      urlList.querySelectorAll(".url-access-item").forEach((el) => {
        const url = (el.dataset.url || "").toLowerCase();
        el.style.display = !q || url.includes(q) ? "" : "none";
      });
    });
  }

  const inviteCheckbox = form.querySelector("#invite-checkbox");
  const passwordInput = form.querySelector("#password-input");
  if (inviteCheckbox) {
    inviteCheckbox.addEventListener("change", () => {
      if (!isEdit) {
        passwordInput.required = !inviteCheckbox.checked;
        passwordInput.placeholder = inviteCheckbox.checked ? "招待のため不要" : "招待しない場合のみ必須";
      }
    });
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {
      email: fd.get("email"),
      username: fd.get("username") || null,
      role: fd.get("role"),
      company_id: fd.get("company_id") || null,
    };
    const invite = fd.get("invite") === "on";
    if (invite) body.invite = true;
    const pw = fd.get("password");
    if (pw) body.password = pw;
    const companyId = fd.get("company_id");
    if (companyId && urlListLoadState === "loading") {
      alert("閲覧可能URLの一覧を読み込み中です。完了してから保存してください。");
      return;
    }
    // 一覧の読み込みが成功したときだけ url_ids を送る（送らない＝サーバー側で既存の閲覧権限を維持）
    if (companyId && urlListLoadState === "ok") {
      const urlIds = fd.getAll("url_ids").filter(Boolean).map(Number);
      body.url_ids = urlIds;
    }
    if (!isEdit && !invite && !pw) {
      alert("パスワードを入力するか、招待メールを送信にチェックを入れてください。");
      return;
    }
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
