/**
 * クロールキュー: 同時実行数制限（最大3件）、超過分は待機
 */
const MAX_CONCURRENT = 3;

let activeCount = 0;
const pending = [];

function processNext() {
  if (activeCount >= MAX_CONCURRENT || pending.length === 0) return;
  const job = pending.shift();
  activeCount++;
  Promise.resolve()
    .then(() => job())
    .catch((err) => console.error("[crawlQueue] job error:", err))
    .finally(() => {
      activeCount--;
      processNext();
    });
}

/**
 * クロールジョブをキューに追加。同時実行数が上限の場合は待機。
 * @param {() => Promise<void>} fn - 実行するクロール関数（runScanCrawl 等）
 */
function enqueueCrawl(fn) {
  if (typeof fn !== "function") return;
  pending.push(fn);
  processNext();
}

module.exports = { enqueueCrawl, MAX_CONCURRENT };
