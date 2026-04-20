/**
 * ページスクリーンショット取得サービス
 * Puppeteer でフルページスクリーンショットを撮影し、ファイルキャッシュする
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CACHE_DIR = path.join(__dirname, "..", "screenshot-cache");
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24時間

// キャッシュディレクトリ作成
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) return browserInstance;

  const puppeteer = require("puppeteer-core");
  browserInstance = await puppeteer.launch({
    headless: "new",
    executablePath: "/usr/bin/chromium-browser",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
      "--no-zygote",
    ],
  });
  return browserInstance;
}

function getCacheKey(url, width) {
  return crypto.createHash("md5").update(url + "|" + width).digest("hex");
}

function getCachePath(key) {
  return path.join(CACHE_DIR, key + ".png");
}

function getCacheMetaPath(key) {
  return path.join(CACHE_DIR, key + ".json");
}

/**
 * スクリーンショットを取得（キャッシュあればそれを返す）
 * @returns {{ imagePath: string, pageHeight: number, pageWidth: number }}
 */
async function captureScreenshot(url, width = 1280) {
  const key = getCacheKey(url, width);
  const imgPath = getCachePath(key);
  const metaPath = getCacheMetaPath(key);

  // キャッシュチェック
  if (fs.existsSync(imgPath) && fs.existsSync(metaPath)) {
    const stat = fs.statSync(imgPath);
    if (Date.now() - stat.mtimeMs < CACHE_TTL) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      return { imagePath: imgPath, ...meta };
    }
  }

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width, height: 800 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    );

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // ページの実際のサイズを取得
    const dimensions = await page.evaluate(() => ({
      pageHeight: Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      ),
      pageWidth: document.documentElement.scrollWidth,
    }));

    await page.screenshot({
      path: imgPath,
      fullPage: true,
      type: "png",
    });

    const meta = {
      pageHeight: dimensions.pageHeight,
      pageWidth: dimensions.pageWidth,
      capturedAt: Date.now(),
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta));

    return { imagePath: imgPath, ...meta };
  } finally {
    await page.close();
  }
}

// 古いキャッシュを定期削除（1時間ごと）
setInterval(() => {
  try {
    const files = fs.readdirSync(CACHE_DIR);
    const now = Date.now();
    for (const f of files) {
      const fp = path.join(CACHE_DIR, f);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > CACHE_TTL * 2) {
        fs.unlinkSync(fp);
      }
    }
  } catch (_) {}
}, 60 * 60 * 1000);

module.exports = { captureScreenshot };
