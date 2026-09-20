// ═══════════════════════════════════════════════════════════════════
// SkyForge — flightsim.jackdu.cloud
// 亚洲机场大圆航线 3D 飞行观看站 (Node.js + Express,零 AI API)
//
// 机场数据:
//   主源   https://davidmegginson.github.io/ourairports-data/airports.csv
//          (启动后异步拉取亚洲机场,解析结果缓存到 data/asia-airports.json)
//   兜底   airports-core.js (139 个亚洲枢纽,硬编码,含中文名)
// 接口:
//   GET /api/airport/:code   ICAO 四字码或 IATA 三字码 → 机场详情(含中文名)
//   GET /api/route           起点/终点/航司/航班号 → 大圆航路点 JSON
//   GET /api/list            全部机场精简列表(前端 datalist 码名对照用)
//   GET /api/stats           数据源状态
// ═══════════════════════════════════════════════════════════════════
'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const CORE_AIRPORTS = require('./airports-core.js');

const PORT = process.env.PORT || 8086;
const HOST = process.env.HOST || '127.0.0.1';
const CSV_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const CACHE_DIR = path.join(__dirname, 'data');
const CACHE_FILE = path.join(CACHE_DIR, 'asia-airports.json');
const CACHE_MAX_AGE_MS = 14 * 24 * 3600 * 1000; // 缓存 14 天

const ROUTE_POINTS = 30;          // 航路点数(含起降)
const EARTH_R = 6371000;          // 地球平均半径(米)
const ALT_MIN = 3000;             // 巡航高度下限(米)
const ALT_MAX = 6000;             // 巡航高度上限(米)
const WAYPOINT_CODE_LEN = 5;      // 中间航路点伪码长度

// ───────────────────────────────────────────────────────────────────
// 机场数据存储
//   airportByIcao: Map<'ZSSS', record>
//   airportByIata: Map<'SHA', record>
//   list: 全量数组(/api/list 用)
//   record = { icao, iata, name_en, name_zh, city, city_zh, lat, lon, country }
// ───────────────────────────────────────────────────────────────────
let airportByIcao = new Map();
let airportByIata = new Map();
let airportList = [];
let dataSource = 'core-only';       // 'core-only' | 'cache' | 'online'
let dataUpdatedAt = null;
let loadCount = 0;

const DISPLAY = (r) => r.name_zh || r.name_en;
const CITY_DISPLAY = (r) => r.city_zh || r.city || '';

function setAirportData(records, source) {
  const byIcao = new Map();
  const byIata = new Map();
  for (const r of records) {
    if (r.icao) byIcao.set(r.icao, r);
    if (r.iata) byIata.set(r.iata, r);
  }
  airportByIcao = byIcao;
  airportByIata = byIata;
  airportList = records;
  dataSource = source;
  dataUpdatedAt = new Date();
  loadCount = byIcao.size;
  console.log(`[flightsim] 机场数据就绪: ICAO ${byIcao.size} 条 / IATA ${byIata.size} 条, 来源=${source}`);
}

// ── 从硬编码核心表构建基础数据(永远可用) ──
function buildFromCore() {
  const records = [];
  for (const [icao, iata, nameZh, cityZh, lat, lon] of CORE_AIRPORTS) {
    records.push({
      icao,
      iata: iata || null,
      name_en: '',                       // 英文名等 CSV 在线覆盖
      name_zh: nameZh,
      city: '',
      city_zh: cityZh,
      lat,
      lon,
      country: '',
      _core: true
    });
  }
  return records;
}

// ── 解析 CSV(支持引号包裹的逗号/换行) ──
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 && !(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ── 下载并解析全球机场 CSV → 亚洲机场记录 ──
async function fetchOurairportsCsv() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  const res = await fetch(CSV_URL, { signal: ctrl.signal });
  clearTimeout(timer);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const rows = parseCSV(text);
  if (rows.length < 100) throw new Error('CSV 行数异常: ' + rows.length);

  const header = rows[0].map((h) => h.trim());
  const idx = (name) => header.indexOf(name);

  const byCore = new Map(CORE_AIRPORTS.map((c) => [c[0].toUpperCase(), c]));
  const records = [];
  const seenIcao = new Set();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (name) => {
      const k = idx(name);
      return k >= 0 && k < r.length ? r[k].trim() : '';
    };
    const continent = get('continent');
    const type = get('type');
    if (continent !== 'AS') continue;                                   // 只要亚洲
    if (type.endsWith('closed')) continue;                              // 不要已关闭机场
    if (!['large_airport', 'medium_airport', 'small_airport', 'seaplane_base'].includes(type)) continue;

    const ident = get('ident').toUpperCase();
    let icao = (get('icao_code') || '').toUpperCase();
    if (!icao && /^[A-Z0-9]{4}$/.test(ident) && /^[A-Z]/.test(ident)) icao = ident; // ident 兜底
    const iata = (get('iata_code') || '').toUpperCase();
    if (!icao && !iata) continue;

    const lat = parseFloat(get('latitude_deg'));
    const lon = parseFloat(get('longitude_deg'));
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;

    const key = icao || iata;
    if (seenIcao.has(key)) continue;                                    // 去重(含 icao/iata 重名行)
    seenIcao.add(key);

    const core = icao ? byCore.get(icao) : null;
    records.push({
      icao: icao || null,
      iata: iata || null,
      name_en: get('name') || '',
      name_zh: core ? core[2] : null,                                   // 核心表中文名优先
      city: get('municipality') || '',
      city_zh: core ? core[3] : null,
      lat,
      lon,
      country: get('iso_country') || ''
    });
  }

  if (records.length < 100) throw new Error('筛选后机场数异常: ' + records.length);

  // 核心表里的机场若 CSV 没出现(如刚关闭/缺行),补回,保证永远可飞
  const have = new Set(records.map((x) => x.icao).filter(Boolean));
  for (const [icao, iata, zh, cityZh, lat, lon] of CORE_AIRPORTS) {
    if (!have.has(icao)) {
      records.push({ icao, iata: iata || null, name_en: '', name_zh: zh, city: '', city_zh: cityZh, lat, lon, country: '', _core: true });
    }
  }
  records.sort((a, b) => (a.icao || a.iata || '').localeCompare(b.icao || b.iata || ''));
  return records;
}

// ── 持久化缓存(只存精简后的亚洲数据,下次启动秒加载) ──
function saveCache(records) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(records));
  } catch (e) { console.warn('[flightsim] 缓存写入失败:', e.message); }
}

async function refreshData(force = false) {
  try {
    const records = await fetchOurairportsCsv();
    setAirportData(records, 'online');
    saveCache(records);
    return true;
  } catch (e) {
    console.warn(`[flightsim] 在线拉取失败(${e.message}),尝试缓存…`);
    try {
      const raw = fs.readFileSync(CACHE_FILE, 'utf8');
      const records = JSON.parse(raw);
      if (Array.isArray(records) && records.length > 100) {
        setAirportData(records, 'cache');
        return true;
      }
    } catch (e2) { /* 无缓存 */ }
    if (!force) console.warn('[flightsim] 在线数据不可用,运行于核心备用表模式(139 个亚洲枢纽)');
    return false;
  }
}

// ───────────────────────────────────────────────────────────────────
// 地理工具
// ───────────────────────────────────────────────────────────────────
const deg2rad = (d) => (d * Math.PI) / 180;
const rad2deg = (r) => (r * 180) / Math.PI;

function toVec3(latDeg, lonDeg) {
  const lat = deg2rad(latDeg), lon = deg2rad(lonDeg);
  return [
    Math.cos(lat) * Math.cos(lon),
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat)
  ];
}
function fromVec3(v) {
  const lat = rad2deg(Math.asin(v[2]));
  const lon = rad2deg(Math.atan2(v[1], v[0]));
  return { lat, lon };
}
function slerpVec(a, b, t) {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const theta = Math.acos(dot);
  if (theta < 1e-9) return a.slice();
  const sa = Math.sin(theta);
  const w1 = Math.sin((1 - t) * theta) / sa;
  const w2 = Math.sin(t * theta) / sa;
  return [a[0] * w1 + b[0] * w2, a[1] * w1 + b[1] * w2, a[2] * w1 + b[2] * w2];
}

function haversineKm(aLat, aLon, bLat, bLon) {
  const dLat = deg2rad(bLat - aLat), dLon = deg2rad(bLon - aLon);
  const x = Math.sin(dLat / 2) ** 2 +
            Math.cos(deg2rad(aLat)) * Math.cos(deg2rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(x)) / 1000;
}

// 巡航高度剖面已改为 buildRoute 内的分段爬升/平飞/下降(见 CLIMB_KM),此函数已废弃
// (altProfile 历史实现曾用 sin^0.45 把爬升摊满全程,显得爬升很慢)

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function randomWaypointCode() {
  let s = 'W';
  for (let i = 0; i < WAYPOINT_CODE_LEN - 1; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

// ── 生成大圆航路: ROUTE_POINTS 个点,起终点高度 0,中部 3000~6000m ±5% ──
// 高度剖面: 离起降点 70km 内完成爬升/下降(≈5分钟@巡航速度 820km/h),中间平飞巡航
const CLIMB_KM = 70;
function buildRoute(origin, dest) {
  const n = ROUTE_POINTS;
  const o = toVec3(origin.lat, origin.lon);
  const d = toVec3(dest.lat, dest.lon);
  const amax = ALT_MIN + Math.random() * (ALT_MAX - ALT_MIN);

  // 先求航路点经纬度与累计距离
  const wpts = [];
  const cum = [0];
  for (let i = 0; i < n; i++) {
    const p = fromVec3(slerpVec(o, d, i / (n - 1)));
    wpts.push({ lat: round(p.lat, 5), lon: round(p.lon, 5) });
    if (i > 0) cum.push(cum[i - 1] + haversineKm(wpts[i - 1].lat, wpts[i - 1].lon, wpts[i].lat, wpts[i].lon));
  }
  const totalKm = cum[n - 1];

  const waypoints = wpts.map((w, i) => {
    let alt = amax * Math.min(1, cum[i] / CLIMB_KM, (totalKm - cum[i]) / CLIMB_KM);
    if (i > 0 && i < n - 1 && alt > 0.92 * amax) alt *= 0.95 + Math.random() * 0.1;   // 平飞段 ±5% 波动
    return { ...w, alt: Math.round(alt), name: '' };
  });

  // 名称: 起/终点 = 机场全称; 中部 = 随机 5 字母伪航路点码
  waypoints[0].name = origin.name;
  waypoints[n - 1].name = dest.name;
  for (let i = 1; i < n - 1; i++) waypoints[i].name = randomWaypointCode();

  return {
    waypoints,
    distanceKm: Math.round(totalKm),
    cruiseAltM: Math.round(amax)
  };
}

const round = (x, p) => Math.round(x * 10 ** p) / 10 ** p;

// ───────────────────────────────────────────────────────────────────
// 查询
// ───────────────────────────────────────────────────────────────────
function findAirport(code) {
  if (!code) return null;
  const c = String(code).trim().toUpperCase();
  if (!c) return null;
  let r = airportByIcao.get(c) || airportByIata.get(c);
  if (!r) return null;
  return {
    icao: r.icao, iata: r.iata,
    name: DISPLAY(r), name_en: r.name_en || null, name_zh: r.name_zh || null,
    city: CITY_DISPLAY(r), city_en: r.city || null,
    lat: r.lat, lon: r.lon, country: r.country
  };
}

// ───────────────────────────────────────────────────────────────────
// Express 应用
// ───────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.disable('x-powered-by');

app.get('/api/airport/:code', (req, res) => {
  const a = findAirport(req.params.code);
  if (!a) return res.json({ found: false, code: String(req.params.code || '').toUpperCase() });
  res.json({ found: true, ...a });
});

app.get('/api/route', (req, res) => {
  const origin = findAirport(req.query.origin);
  const dest = findAirport(req.query.dest);
  if (!origin || !dest) {
    const miss = [];
    if (!origin) miss.push(`起点 ${(req.query.origin || '').toUpperCase()} 未找到`);
    if (!dest) miss.push(`终点 ${(req.query.dest || '').toUpperCase()} 未找到`);
    return res.status(404).json({ error: miss.join('; ') });
  }
  if (origin.icao && dest.icao && origin.icao === dest.icao) {
    return res.status(400).json({ error: '起点和终点不能是同一个机场' });
  }
  const airline = String(req.query.airline || '').trim() || '示例航空';
  const flight = String(req.query.flight || '').trim() || '0001';
  const route = buildRoute(origin, dest);

  res.json({
    origin,
    dest,
    origin_name: origin.name,          // 机场全称(中文优先)
    dest_name: dest.name,
    airline,
    flight,
    distanceKm: route.distanceKm,
    cruiseAltM: route.cruiseAltM,
    waypointCount: route.waypoints.length,
    waypoints: route.waypoints,
    generatedAt: new Date().toISOString()
  });
});

app.get('/api/list', (req, res) => {
  const q = String(req.query.q || '').toUpperCase();
  let rows = airportList;
  if (q) {
    rows = rows.filter((r) =>
      (r.icao || '').startsWith(q) || (r.iata || '').startsWith(q) ||
      (r.name_zh || '').toUpperCase().includes(q) || (r.name_en || '').toUpperCase().includes(q)
    ).slice(0, 50);
  }
  res.json({
    total: airportList.length,
    rows: rows.map((r) => ({ icao: r.icao, iata: r.iata, name: DISPLAY(r), city: CITY_DISPLAY(r) }))
  });
});

app.get('/api/stats', (req, res) => {
  res.json({
    source: dataSource,
    icaoCount: airportByIcao.size,
    iataCount: airportByIata.size,
    total: airportList.length,
    updatedAt: dataUpdatedAt,
    coreCount: CORE_AIRPORTS.length
  });
});

// 静态前端
const PUBLIC_DIR = path.join(__dirname, 'public');
// 经验教训: Cesium 1.14x 里 ArcGisMapServerImageryProvider 的同步构造(new ...)不会初始化 _resource,
// 首个瓦片请求即崩 (TypeError: Cannot read properties of undefined (reading 'getDerivedResource')),
// 必须走 .fromUrl 异步工厂。OSM 的同步构造是安全的,可继续用。
// vendor(Cesium 本体, 体积大且不变)长缓存; 自研 js/css/html 不缓存, 避免改版后用户拿到旧代码
app.use('/vendor', express.static(path.join(PUBLIC_DIR, 'vendor'), { maxAge: '30d', immutable: true }));
app.use(express.static(PUBLIC_DIR, { maxAge: 0, etag: true, index: 'index.html' }));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// ───────────────────────────────────────────────────────────────────
// 启动
// ───────────────────────────────────────────────────────────────────
async function main() {
  // 1. 核心表立即就位 → 秒启动
  setAirportData(buildFromCore(), 'core-only');

  // 2. 有新鲜缓存就先加载(读盘快),再异步刷新在线数据
  let usedCache = false;
  try {
    const st = fs.statSync(CACHE_FILE);
    if (Date.now() - st.mtimeMs < CACHE_MAX_AGE_MS) {
      const records = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (Array.isArray(records) && records.length > 100) {
        setAirportData(records, 'cache');
        usedCache = true;
      }
    }
  } catch (e) { /* 无缓存 */ }

  // 3. 监听端口(核心表/缓存已可用)
  app.listen(PORT, HOST, () => {
    console.log(`[flightsim] SkyForge 已启动 → http://${HOST}:${PORT} (${dataSource} 模式)`);
  });

  // 4. 后台拉取在线数据升级机场库
  setTimeout(async () => {
    if (!(await refreshData(false)) && usedCache) {
      console.warn('[flightsim] 在线刷新失败,保留缓存数据运行');
    }
  }, 800);
  setInterval(() => refreshData(false), 24 * 3600 * 1000); // 每日静默刷新
}

main().catch((e) => {
  console.error('[flightsim] 启动失败:', e);
  process.exit(1);
});
