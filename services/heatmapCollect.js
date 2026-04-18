"use strict";

const crypto = require("crypto");
const pool = require("../db");

const IP_SALT = process.env.HEATMAP_IP_SALT || "seoscan-heatmap-default-salt";

function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash("sha256").update(IP_SALT + ip).digest("hex");
}

function detectDeviceType(ua) {
  if (!ua) return "unknown";
  if (/Mobile|Android.*Mobile|iPhone|iPod/i.test(ua)) return "mobile";
  if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) return "tablet";
  return "desktop";
}

/**
 * site_key からサイトを検索（アクティブなもののみ）
 */
async function findSiteByKey(siteKey) {
  const [rows] = await pool.query(
    "SELECT id, company_id, site_url FROM heatmap_sites WHERE site_key = ? AND is_active = 1 LIMIT 1",
    [siteKey]
  );
  return rows.length ? rows[0] : null;
}

/**
 * セッション取得 or 作成
 */
async function resolveSession(siteId, token, pageUrl, viewportW, viewportH, pageH, req) {
  const ua = req.headers["user-agent"] || null;
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || null;
  const ipHash = hashIp(ip);
  const deviceType = detectDeviceType(ua);

  // UPSERT: 既存セッションがあればそのIDを返す
  const [existing] = await pool.query(
    "SELECT id FROM heatmap_sessions WHERE site_id = ? AND session_token = ? AND page_url = ? LIMIT 1",
    [siteId, token, pageUrl]
  );

  if (existing.length) {
    // page_h が更新されていれば反映
    if (pageH && pageH > 0) {
      await pool.query("UPDATE heatmap_sessions SET page_h = ? WHERE id = ?", [pageH, existing[0].id]);
    }
    return existing[0].id;
  }

  const [result] = await pool.query(
    `INSERT INTO heatmap_sessions (site_id, session_token, page_url, viewport_w, viewport_h, page_h, user_agent, ip_hash, device_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [siteId, token, pageUrl, viewportW, viewportH, pageH || null, ua, ipHash, deviceType]
  );
  return result.insertId;
}

/**
 * イベントをバルクINSERT
 */
async function insertEvents(sessionId, events) {
  if (!events || events.length === 0) return 0;

  const values = [];
  const placeholders = [];

  for (const e of events) {
    placeholders.push("(?, ?, ?, ?, ?, ?, ?, ?, ?)");
    values.push(
      sessionId,
      e.type || "click",
      Number(e.x_pct) || 0,
      Number(e.y_pct) || 0,
      Number(e.x_px) || 0,
      Number(e.y_px) || 0,
      (e.tag || "").slice(0, 32) || null,
      (e.text || "").slice(0, 255) || null,
      e.scroll_depth != null ? Number(e.scroll_depth) : null
    );
  }

  await pool.query(
    `INSERT INTO heatmap_events (session_id, event_type, x_pct, y_pct, x_px, y_px, element_tag, element_text, scroll_depth_pct)
     VALUES ${placeholders.join(", ")}`,
    values
  );
  return events.length;
}

module.exports = { findSiteByKey, resolveSession, insertEvents };
