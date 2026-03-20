/**
 * 管理画面 認証チェック
 */
export async function checkAdminAuth() {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  if (!user) return null;
  const role = (user.role || "").toLowerCase();
  if (role !== "admin" && role !== "master") return null;
  return user;
}
