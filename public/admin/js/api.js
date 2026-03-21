/**
 * 管理API呼び出し
 */
const base = "/api/admin";

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { credentials: "include", ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const adminApi = {
  dashboard: () => fetchJson(`${base}/dashboard`),
  users: {
    list: () => fetchJson(`${base}/users`),
    create: (body) => fetchJson(`${base}/users`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    update: (id, body) => fetchJson(`${base}/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    delete: (id) => fetchJson(`${base}/users/${id}`, { method: "DELETE" }),
    urlAccess: (userId, companyId) =>
      fetchJson(`${base}/users/${userId}/url-access${companyId ? `?company_id=${encodeURIComponent(companyId)}` : ""}`),
  },
  companies: {
    list: () => fetchJson(`${base}/companies`),
    create: (body) => fetchJson(`${base}/companies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    update: (id, body) => fetchJson(`${base}/companies/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    delete: (id) => fetchJson(`${base}/companies/${id}`, { method: "DELETE" }),
    urls: (companyId, opts = {}) => {
        const qs = opts.scannedOnly ? "?scanned_only=1" : "";
        return fetchJson(`${base}/companies/${companyId}/urls${qs}`);
      },
    addUrl: (companyId, url) => fetchJson(`${base}/companies/${companyId}/urls`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }),
  },
  scans: {
    list: () => fetchJson(`${base}/scans`),
    scanList: () => fetchJson(`${base}/scans/list`),
  },
  linkAnalysis: (scanId) => fetchJson(`${base}/link-analysis?scan_id=${encodeURIComponent(scanId)}`),
};
