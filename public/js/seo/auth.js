/**
 * スキャン一覧 — 認証ガード
 */

export async function requireLogin(fetchMeFn) {
  const me = await fetchMeFn();
  if (!me || !me.id) {
    window.location.replace("/");
    return null;
  }
  return me;
}
