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
    <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:24px;">
      <div>
        <h2 style="font-size:22px; font-weight:700; color:#0f172a; letter-spacing:-0.02em; margin:0 0 4px;">企業管理</h2>
        <p style="font-size:13px; color:#64748b; margin:0;">クライアント企業とドメインの紐付けを管理します。</p>
      </div>
      <button id="btn-add-company" style="background:#4f46e5; color:#fff; border:none; padding:9px 20px; border-radius:10px; font-size:13px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:6px; transition:background .15s;" onmouseover="this.style.background='#4338ca'" onmouseout="this.style.background='#4f46e5'">
        <svg style="width:15px;height:15px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
        新規追加
      </button>
    </div>

    <!-- サマリー -->
    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:24px;">
      <div style="background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:20px 24px; display:flex; align-items:center; gap:16px;">
        <div style="width:40px;height:40px;border-radius:10px;background:#eff6ff;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg style="width:18px;height:18px;color:#3b82f6;" fill="none" stroke="#3b82f6" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
        </div>
        <div>
          <p style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;margin:0 0 2px;">総企業数</p>
          <p style="font-size:26px;font-weight:700;color:#0f172a;margin:0;">${companies.length}</p>
        </div>
      </div>
      <div style="background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:20px 24px; display:flex; align-items:center; gap:16px;">
        <div style="width:40px;height:40px;border-radius:10px;background:#f0fdf4;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg style="width:18px;height:18px;" fill="none" stroke="#22c55e" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
        </div>
        <div>
          <p style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;margin:0 0 2px;">総登録URL</p>
          <p style="font-size:26px;font-weight:700;color:#0f172a;margin:0;">${Object.values(countMap).reduce((a, b) => a + b, 0)}</p>
        </div>
      </div>
      <div style="background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:20px 24px; display:flex; align-items:center; gap:16px;">
        <div style="width:40px;height:40px;border-radius:10px;background:#fef9c3;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg style="width:18px;height:18px;" fill="none" stroke="#ca8a04" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </div>
        <div>
          <p style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;margin:0 0 2px;">アクティブ</p>
          <p style="font-size:26px;font-weight:700;color:#0f172a;margin:0;">${companies.length}</p>
        </div>
      </div>
    </div>

    <!-- テーブル -->
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:16px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.04);">
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead>
          <tr style="background:#f8fafc; border-bottom:1px solid #e2e8f0;">
            <th style="padding:12px 20px; text-align:left; font-size:11px; font-weight:600; color:#64748b; text-transform:uppercase; letter-spacing:.08em; width:48px;">#</th>
            <th style="padding:12px 20px; text-align:left; font-size:11px; font-weight:600; color:#64748b; text-transform:uppercase; letter-spacing:.08em;">企業名</th>
            <th style="padding:12px 20px; text-align:center; font-size:11px; font-weight:600; color:#64748b; text-transform:uppercase; letter-spacing:.08em; width:120px;">登録URL</th>
            <th style="padding:12px 20px; text-align:center; font-size:11px; font-weight:600; color:#64748b; text-transform:uppercase; letter-spacing:.08em; width:100px;">ステータス</th>
            <th style="padding:12px 20px; text-align:right; font-size:11px; font-weight:600; color:#64748b; text-transform:uppercase; letter-spacing:.08em; width:160px;">操作</th>
          </tr>
        </thead>
        <tbody>
          ${companies.length === 0 ? `
            <tr>
              <td colspan="5" style="padding:48px; text-align:center; color:#94a3b8; font-size:13px;">
                企業が登録されていません
              </td>
            </tr>
          ` : companies.map((c, i) => {
            const initial = (c.name || "?").charAt(0).toUpperCase();
            const count = countMap[c.id] ?? 0;
            // アバター背景色をハッシュで決定
            const colors = ["#e0e7ff","#fce7f3","#d1fae5","#fef3c7","#dbeafe","#f3e8ff"];
            const textColors = ["#4338ca","#be185d","#065f46","#92400e","#1e40af","#7e22ce"];
            const ci = (c.name || "").charCodeAt(0) % colors.length;
            return `
            <tr style="border-bottom:1px solid #f1f5f9; transition:background .1s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
              <td style="padding:14px 20px; color:#94a3b8; font-size:12px;">${i + 1}</td>
              <td style="padding:14px 20px;">
                <div style="display:flex; align-items:center; gap:12px;">
                  <div style="width:34px;height:34px;border-radius:9px;background:${colors[ci]};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:${textColors[ci]};flex-shrink:0;">${escapeHtml(initial)}</div>
                  <div>
                    <p style="font-weight:600; color:#0f172a; margin:0;">${escapeHtml(c.name || "")}</p>
                    <p style="font-size:11px; color:#94a3b8; margin:0;">ID: ${c.id}</p>
                  </div>
                </div>
              </td>
              <td style="padding:14px 20px; text-align:center;">
                <button class="btn-urls" data-id="${c.id}" data-name="${escapeHtml(c.name || "")}" style="display:inline-flex;align-items:center;gap:5px;background:#eff6ff;color:#3b82f6;border:none;padding:5px 12px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;transition:background .1s;" onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='#eff6ff'">
                  <svg style="width:12px;height:12px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
                  ${count}件
                </button>
              </td>
              <td style="padding:14px 20px; text-align:center;">
                <span style="display:inline-flex;align-items:center;gap:5px;background:#f0fdf4;color:#16a34a;font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;border:1px solid #bbf7d0;">
                  <span style="width:5px;height:5px;border-radius:50%;background:#22c55e;display:inline-block;"></span>
                  Active
                </span>
              </td>
              <td style="padding:14px 20px; text-align:right;">
                <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;">
                  <button class="btn-edit" data-id="${c.id}" data-name="${escapeHtml(c.name || "")}" style="border:1px solid #e2e8f0;background:#fff;color:#475569;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;transition:all .1s;" onmouseover="this.style.borderColor='#818cf8';this.style.color='#4f46e5'" onmouseout="this.style.borderColor='#e2e8f0';this.style.color='#475569'">編集</button>
                  <button class="btn-delete" data-id="${c.id}" data-name="${escapeHtml(c.name || "")}" style="border:1px solid #e2e8f0;background:#fff;color:#94a3b8;padding:6px 10px;border-radius:8px;cursor:pointer;transition:all .1s;display:flex;align-items:center;" onmouseover="this.style.borderColor='#fca5a5';this.style.color='#ef4444';this.style.background='#fef2f2'" onmouseout="this.style.borderColor='#e2e8f0';this.style.color='#94a3b8';this.style.background='#fff'">
                    <svg style="width:14px;height:14px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m4-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                  </button>
                </div>
              </td>
            </tr>
          `}).join("")}
        </tbody>
      </table>
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

function openModal(company = null) {
  const isEdit = !!company;
  const html = `
    <div id="company-modal" style="position:fixed;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px;">
      <div style="background:#fff;border-radius:18px;padding:28px;width:100%;max-width:420px;border:1px solid #e2e8f0;box-shadow:0 20px 60px rgba(0,0,0,.15);">
        <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 20px;">${isEdit ? "企業を編集" : "企業を追加"}</h3>
        <form id="company-form">
          <label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:6px;">企業名</label>
          <input type="text" name="name" value="${escapeHtml(company?.name || "")}" required placeholder="株式会社〇〇" style="width:100%;box-sizing:border-box;padding:10px 14px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;color:#0f172a;outline:none;transition:border-color .15s;" onfocus="this.style.borderColor='#818cf8'" onblur="this.style.borderColor='#e2e8f0'">
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:24px;">
            <button type="button" id="company-modal-cancel" style="padding:9px 18px;border:1px solid #e2e8f0;background:#fff;border-radius:10px;font-size:13px;font-weight:500;color:#475569;cursor:pointer;">キャンセル</button>
            <button type="submit" style="padding:9px 22px;background:#4f46e5;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;">保存</button>
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

  const renderRow = (u) => `
    <tr style="border-bottom:1px solid #f1f5f9;" class="url-row" data-id="${u.id || ""}">
      <td style="padding:10px 16px; font-size:13px; color:#334155; word-break:break-all;">${escapeHtml(u.url)}</td>
      <td style="padding:10px 16px; text-align:right; width:60px;">
        <button class="btn-delete-url" data-id="${u.id || ""}" data-url="${escapeHtml(u.url)}" style="background:none;border:none;color:#cbd5e1;cursor:pointer;padding:4px;border-radius:6px;display:inline-flex;align-items:center;transition:color .1s;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#cbd5e1'">
          <svg style="width:14px;height:14px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </td>
    </tr>
  `;

  const html = `
    <div id="url-modal" style="position:fixed;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px;">
      <div style="background:#fff;border-radius:18px;padding:28px;width:100%;max-width:640px;max-height:85vh;display:flex;flex-direction:column;border:1px solid #e2e8f0;box-shadow:0 20px 60px rgba(0,0,0,.15);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <div>
            <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 2px;">URL管理</h3>
            <p style="font-size:12px;color:#94a3b8;margin:0;">${escapeHtml(companyName)}</p>
          </div>
          <button id="url-modal-close" style="background:none;border:none;color:#94a3b8;cursor:pointer;padding:6px;border-radius:8px;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='none'">
            <svg style="width:18px;height:18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <input type="url" id="url-input" placeholder="https://example.com" style="flex:1;padding:10px 14px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;color:#0f172a;outline:none;" onfocus="this.style.borderColor='#818cf8'" onblur="this.style.borderColor='#e2e8f0'">
          <button type="button" id="url-add-btn" style="padding:10px 20px;background:#4f46e5;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;">追加</button>
        </div>

        <div style="flex:1;overflow-y:auto;border:1px solid #e2e8f0;border-radius:12px;">
          <table style="width:100%;border-collapse:collapse;">
            <thead style="position:sticky;top:0;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
              <tr>
                <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">URL</th>
                <th style="width:60px;"></th>
              </tr>
            </thead>
            <tbody id="url-list-tbody">
              ${urls.length > 0 ? urls.map((u) => renderRow(u)).join("") : "<tr><td colspan='2' style='padding:40px;text-align:center;color:#94a3b8;font-size:13px;'>URLが登録されていません</td></tr>"}
            </tbody>
          </table>
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
      const created = await adminApi.companies.addUrl(companyId, url);
      const emptyRow = tbody.querySelector("td[colspan]");
      if (emptyRow) emptyRow.closest("tr")?.remove();
      tbody.insertAdjacentHTML("beforeend", renderRow(created || { id: "", url }));
      input.value = "";
      // カード内URLカウント更新
      const countEl = document.getElementById(`company-urls-${companyId}`);
      if (countEl) {
        const current = parseInt(countEl.textContent) || 0;
        countEl.textContent = current + 1;
      }
      // 削除ボタンに再バインド
      bindDeleteButtons();
    } catch (err) {
      alert(err.message);
    }
  };

  input.onkeydown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); addBtn.click(); }
  };

  function bindDeleteButtons() {
    tbody.querySelectorAll(".btn-delete-url").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const url = btn.dataset.url;
        if (!confirm(`URL「${url}」を削除しますか？`)) return;
        try {
          if (id) await adminApi.companies.deleteUrl(companyId, id);
          btn.closest("tr")?.remove();
          if (tbody.querySelectorAll("tr").length === 0) {
            tbody.innerHTML = "<tr><td colspan='2' style='padding:40px;text-align:center;color:#94a3b8;font-size:13px;'>URLが登録されていません</td></tr>";
          }
        } catch (err) {
          alert(err.message);
        }
      };
    });
  }

  bindDeleteButtons();
}

async function handleDelete(id, name) {
  if (!confirm(`企業「${name}」を削除しますか？\n\nこの操作は取り消せません。`)) return;
  try {
    await adminApi.companies.delete(id);
    render(document.getElementById("admin-content"));
  } catch (err) {
    alert(err.message);
  }
}
