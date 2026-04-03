/**
 * クロール上限・実行タイムアウト（環境別デフォルト）
 * - NODE_ENV=production: 最大 1 万ページ・実行 3 時間（本番想定）
 * - それ以外: 最大 300 ページ・実行 20 分（ローカル・ステージング想定）
 *
 * ステージングで NODE_ENV=production を使う場合は .env に
 *   MAX_CRAWL_PAGES=300
 * を明示してください。
 */
function envPositiveInt(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultValue;
}

const isProduction = process.env.NODE_ENV === "production";

const DEFAULT_MAX_PAGES = isProduction ? 10000 : 300;
const MAX_CRAWL_PAGES = envPositiveInt("MAX_CRAWL_PAGES", DEFAULT_MAX_PAGES);

const DEFAULT_RUN_TIMEOUT_MS = isProduction
  ? 3 * 60 * 60 * 1000
  : 20 * 60 * 1000;
const CRAWL_RUN_TIMEOUT_MS = envPositiveInt(
  "CRAWL_RUN_TIMEOUT_MS",
  DEFAULT_RUN_TIMEOUT_MS
);

module.exports = {
  MAX_CRAWL_PAGES,
  CRAWL_RUN_TIMEOUT_MS,
  isProduction,
};
