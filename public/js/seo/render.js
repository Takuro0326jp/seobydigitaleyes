/**
 * スキャン一覧 — 表示のみ（DOM操作）
 * データ形状が変わったらここだけ修正
 */

const STATUS_CLASS = {
  completed: "status--completed",
  running: "status--running",
  failed: "status--failed"
};

function formatDate(isoOrDate) {
  if (!isoOrDate) return "—";
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return String(isoOrDate);
  return d.toLocaleString("ja-JP");
}

export function renderUserBar(container, user) {
  if (!container) return;
  container.textContent = user?.email || user?.username || "User";
}

export function renderScanTable(container, items) {
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML =
      '<div class="seo-empty">スキャン履歴がありません。<br /><small>DBの <code>scans</code> にデータを登録すると表示されます。</small></div>';
    return;
  }

  const rows = items
    .map(
      (row) => `
    <tr>
      <td><code style="font-size:12px;">${escapeHtml(row.id)}</code></td>
      <td><strong>${escapeHtml(row.domain)}</strong></td>
      <td><span class="status ${STATUS_CLASS[row.status] || ""}">${escapeHtml(row.status)}</span></td>
      <td>${escapeHtml(formatDate(row.created_at))}</td>
    </tr>
  `
    )
    .join("");

  container.innerHTML = `
    <div class="seo-table-wrap">
      <table class="seo-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Domain</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

export function renderError(container, message) {
  if (!container) return;
  container.innerHTML = `<div class="seo-error">${escapeHtml(message)}</div>`;
}

export function renderLoading(container) {
  if (!container) return;
  container.innerHTML = '<div class="seo-loading">読み込み中…</div>';
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
