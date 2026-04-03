/**
 * クロールキュー: 同時実行数制限（最大3件）、超過分は待機
 * ジョブがハングしてもスロットを解放（6分で強制タイムアウト）
 */
const MAX_CONCURRENT = Number(process.env.CRAWL_MAX_CONCURRENT || 1); // 同時実行数（DB負荷軽減のため1推奨）
const { CRAWL_RUN_TIMEOUT_MS } = require("./crawlLimits");
const JOB_TIMEOUT_MS = Number(
  process.env.CRAWL_JOB_TIMEOUT_MS || CRAWL_RUN_TIMEOUT_MS + 120000
); // キューは本体クロールより2分長め（runWithTimeout との整合）

let activeCount = 0;
const pending = [];

/** 診断開始時刻（メモリ上・DB不要）。scanId → 開始 timestamp */
const scanStartTimes = new Map();

function setScanStartTime(scanId, ms = Date.now()) {
  if (scanId) scanStartTimes.set(scanId, ms);
}

function getScanStartTime(scanId) {
  return scanId ? scanStartTimes.get(scanId) : undefined;
}

function clearScanStartTime(scanId) {
  if (scanId) scanStartTimes.delete(scanId);
}

function processNext() {
  if (activeCount >= MAX_CONCURRENT || pending.length === 0) return;
  const job = pending.shift();
  activeCount++;
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("ジョブタイムアウト")), JOB_TIMEOUT_MS)
  );
  Promise.race([Promise.resolve().then(() => job()), timeoutPromise])
    .catch((err) => {
      console.error("[crawlQueue] job error or timeout:", err?.message || err);
    })
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

function getQueueStatus() {
  return { activeCount, pendingLength: pending.length };
}

module.exports = { enqueueCrawl, MAX_CONCURRENT, setScanStartTime, getScanStartTime, clearScanStartTime, getQueueStatus };
