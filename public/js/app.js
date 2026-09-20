/* SkyForge — 前端逻辑: CesiumJS 3D + 机外跟随 + 码名对照 + 双语 */
'use strict';
/* global Cesium */

// ══════════════════════════ i18n ══════════════════════════
const I18N = {
  zh: {
    tagline: '天际航线', lblOrigin: '起点机场', lblDest: '终点机场', lblAirline: '航空公司',
    lblFlight: '航班号', phOrigin: '如 ZSPD / PVG', phDest: '如 VHHH / HKG',
    phAirline: '中国东方航空', phFlight: 'MU501', btnFly: '🚀 起飞', btnRandom: '🎲 随机航线',
    mapBtn: '🗺️ 地图', satBtn: '🛰️ 卫星', note1: '💡 支持 ICAO 四字码 / IATA 三字码',
    note2: '输入框失焦或点击 🔍 即时显示机场全称', btnFollow: '👁 跟随', btnFree: '🛰 自由视角',
    btnOverview: '🌐 全览', btnPause: '⏸ 暂停', btnResume: '▶ 继续', loading: '正在启动 3D 引擎…',
    flying: '飞行中', arrived: '✈️ 已到达目的地', arrivedMsg: '航班已抵达 {d},全程 {km} 公里',
    notFound: '未找到机场代码', startErr: '请先填写起点和终点机场代码', lookupErr: '查询失败',
    routeErr: '无法生成航线', speed: '速度', alt: '高度', remain: '剩余', eta: '预计到达',
    kmh: 'km/h', km: 'km', m: '分', s: '秒', h: '时', atcLocked: '视角已锁定在航班上,拖动可环绕',
    freeHint: '已切换自由视角,可任意旋转缩放', overHint: '已定位到全航线视角',
    dataBad: '数据加载失败,请刷新重试', randomOk: '已随机生成航线,按起飞开始',
    simOnly: '模拟速度', e2e: '按 ESC/双击地球可复位视角',
    gpuNote: '⚠️ 提示:本网站为实时 3D 渲染,较消耗 GPU 性能。低性能设备可能出现卡顿,建议使用高性能电脑访问。',
    btnStop: '⏹ 停止', stopTitle: '停止当前航班?',
    stopBody: '点击「停止」将清除当前航线,页面恢复初始状态。',
    btnCancel: '取消', stopped: '已停止,页面已恢复初始状态'
  },
  en: {
    tagline: 'Asia Flight Routes', lblOrigin: 'Origin', lblDest: 'Destination', lblAirline: 'Airline',
    lblFlight: 'Flight No.', phOrigin: 'e.g. ZSPD / PVG', phDest: 'e.g. VHHH / HKG',
    phAirline: 'China Eastern', phFlight: 'MU501', btnFly: '🚀 Take Off', btnRandom: '🎲 Random',
    mapBtn: '🗺️ Map', satBtn: '🛰️ Satellite', note1: '💡 ICAO 4-letter / IATA 3-letter codes',
    note2: 'Blur the field or click 🔍 to see full airport name', btnFollow: '👁 Follow', btnFree: '🛰 Free cam',
    btnOverview: '🌐 Overview', btnPause: '⏸ Pause', btnResume: '▶ Resume', loading: 'Starting 3D engine…',
    flying: 'en route', arrived: '✈️ Destination reached', arrivedMsg: 'Flight arrived at {d}, {km} km total',
    notFound: 'Airport code not found', startErr: 'Please enter origin and destination codes first',
    lookupErr: 'Lookup failed', routeErr: 'Cannot build route', speed: 'Speed', alt: 'Alt', remain: 'Remaining',
    eta: 'ETA', kmh: 'km/h', km: 'km', m: 'min', s: 's', h: 'h', atcLocked: 'Camera locked to aircraft — drag to orbit',
    freeHint: 'Free camera — orbit & zoom freely', overHint: 'Showing full route overview',
    dataBad: 'Failed to load airport data. Refresh the page.', randomOk: 'Random route ready — press Take Off',
    simOnly: 'Sim speed', e2e: 'Press ESC or double-click globe to reset view',
    gpuNote: '⚠️ Note: this site renders real-time 3D and is GPU-intensive. Low-end devices may lag — a high-performance computer is recommended.',
    btnStop: '⏹ Stop', stopTitle: 'Stop current flight?',
    stopBody: 'Stopping clears the current route and returns the page to its initial state.',
    btnCancel: 'Cancel', stopped: 'Stopped — back to the initial state'
  }
};

function detectLang() {
  try {
    const saved = localStorage.getItem('flightsim_lang');
    if (saved === 'zh' || saved === 'en') return saved;
  } catch (e) { /* ignore */ }
  return (navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
let lang = detectLang();
const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.zh[k] || k;

// ══════════════════════════ DOM ══════════════════════════
const $ = (id) => document.getElementById(id);
const elOrigin = $('origin'), elDest = $('dest'), elAirline = $('airline'), elFlight = $('flight');
const hintOrigin = $('hintOrigin'), hintDest = $('hintDest');
const btnFly = $('btnFly'), btnRandom = $('btnRandom'), btnFollow = $('btnFollow'),
      btnOverview = $('btnOverview'), btnPause = $('btnPause'), langBtn = $('langBtn');
const bar = $('statusBar'), barTitle = $('barTitle'), barMeta = $('barMeta'), barProg = $('barProg');
const panel = $('panel');
const btnStop = $('btnStop'), modal = $('modal'), modalOk = $('modalOk'), modalCancel = $('modalCancel');
const statSpeed = $('statSpeed'), statAlt = $('statAlt'), statRemain = $('statRemain'), statEta = $('statEta');
const loader = $('loader');
const toastsBox = $('toasts');
const apList = $('apList');

const EARTH_R_KM = 6371;

// ══════════════════════════ Cesium ══════════════════════════
let viewer;
function resetToInitialView() {
  // 初始视角: 亚洲区域俯视(默认"太空看地球"会显得地图很小,这里拉近让地表铺满窗口)
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(106, 18, 3300000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-85), roll: 0 }
  });
}
try {
  viewer = new Cesium.Viewer('globe', {
    baseLayer: new Cesium.ImageryLayer(new Cesium.OpenStreetMapImageryProvider({
      url: 'https://tile.openstreetmap.org/', maximumLevel: 19
    })),
    baseLayerPicker: false, geocoder: false, homeButton: false,
    sceneModePicker: false, navigationHelpButton: false, animation: false,
    timeline: false, fullscreenButton: false, infoBox: false,
    selectionIndicator: false, shouldAnimate: true,
    contextOptions: { webgl: { alpha: false } }
  });
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#071426');
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.scene.postProcessStages.fxaa.enabled = true;
  resetToInitialView();
} catch (e) {
  console.error('Cesium init failed', e);
  document.body.innerHTML = '<div style="padding:40px;color:#ff5d7a;font-family:sans-serif">3D 引擎初始化失败(需要 WebGL): ' + e.message + '</div>';
  throw e;
}

// 卫星图层: Cesium Ion 世界影像(用户提供的 token;加载失败自动回落 OSM 地图)
const osmLayer = viewer.imageryLayers.get(0);
// 卫星影像: 填入你自己的 Cesium Ion token (https://ion.cesium.com/)。留空则自动使用 OSM 地图。
// 本仓库不附带可用 token —— 请勿把私有 token 提交进公开仓库。
const ION_TOKEN = '';
let ionLayer = null;
let ionReady = false;

async function initIonImagery() {
  try {
    Cesium.Ion.defaultAccessToken = ION_TOKEN;
    const provider = await Cesium.createWorldImageryAsync();
    ionLayer = viewer.imageryLayers.addImageryProvider(provider);
    ionLayer.show = false;
    ionReady = true;
    // Ion 就绪后默认切到卫星影像(更精美),OSM 地图留作切换项
    osmLayer.show = false;
    const seg = $('mapMode');
    seg.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
    seg.querySelector('[data-mode="sat"]').classList.add('on');
    ionLayer.show = true;
    console.log('[flightsim] Cesium Ion 卫星影像已启用');
  } catch (e) {
    ionReady = false;
    console.warn('[flightsim] Ion 影像不可用,继续使用 OSM 地图:', e.message || e);
  }
}

// ══════════════════════════ 全局状态 ══════════════════════════
const flight = {
  active: false, arrived: false, airline: '', flightNo: '',
  start: null, stop: null, simTotal: 0, durationReal: 0,
  distanceKm: 0, cruiseAlt: 0, speedFactor: 1,
  waypointCartesians: [], routeEntity: null, aircraftEntity: null,
  origin: null, dest: null, oMarker: null, dMarker: null
};
let airportRows = [];      // /api/list 缓存(随机航线/datalist)
const lookupCache = { origin: null, dest: null };
let hintTimer = null;

// ══════════════════════════ 小工具 ══════════════════════════
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const deg2rad = (d) => (d * Math.PI) / 180;
function haversineKm(a, b) {
  const dLat = deg2rad(b.lat - a.lat), dLon = deg2rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 +
            Math.cos(deg2rad(a.lat)) * Math.cos(deg2rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.sqrt(x));
}

// 大圆插值(单位向量 slerp),u∈[0,1]
function gcLerp(a, b, u) {
  const la = deg2rad(a.lat), loA = deg2rad(a.lon);
  const lb = deg2rad(b.lat), loB = deg2rad(b.lon);
  const va = [Math.cos(la) * Math.cos(loA), Math.cos(la) * Math.sin(loA), Math.sin(la)];
  const vb = [Math.cos(lb) * Math.cos(loB), Math.cos(lb) * Math.sin(loB), Math.sin(lb)];
  const dot = clamp(va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2], -1, 1);
  const theta = Math.acos(dot);
  if (theta < 1e-9) return { lat: a.lat, lon: a.lon };
  const s = Math.sin(theta), w1 = Math.sin((1 - u) * theta) / s, w2 = Math.sin(u * theta) / s;
  const x = va[0] * w1 + vb[0] * w2, y = va[1] * w1 + vb[1] * w2, z = va[2] * w1 + vb[2] * w2;
  return { lat: Math.asin(z) * 180 / Math.PI, lon: Math.atan2(y, x) * 180 / Math.PI };
}

const displayName = (a) => lang === 'zh' ? (a.name || a.name_en) : (a.name_en || a.name);
const cityName = (a) => lang === 'zh' ? (a.city || a.city_en) : (a.city_en || a.city);

function fmtKM(km) {
  // 正常数字显示(千分位), 如 4,100 / 4,000
  return Math.round(km).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function toast(msg, kind = '') {
  const d = document.createElement('div');
  d.className = 'toast ' + kind;
  d.textContent = msg;
  toastsBox.appendChild(d);
  setTimeout(() => { d.classList.add('fade'); setTimeout(() => d.remove(), 450); }, 4600);
}

function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return h + t('h') + (m < 10 ? '0' : '') + m + t('m');
  return m + t('m') + (s < 10 ? '0' : '') + s + t('s');
}

// ══════════════════════════ 语言切换 ══════════════════════════
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  langBtn.textContent = lang === 'zh' ? '中 / EN' : 'EN / 中';
  redrawLookupHints();
  if (flight.active) renderBar();
  if (btnPause.dataset.paused) btnPause.textContent = t('btnResume');
  btnFollow.textContent = viewer.trackedEntity ? t('btnFollow') : t('btnFree');
}
langBtn.addEventListener('click', () => {
  lang = lang === 'zh' ? 'en' : 'zh';
  try { localStorage.setItem('flightsim_lang', lang); } catch (e) { /* ignore */ }
  applyLang();
});

// ══════════════════════════ 机场数据 & 码名对照 ══════════════════════════
async function loadAirportList() {
  try {
    const res = await fetch('/api/list');
    const data = await res.json();
    airportRows = data.rows || [];
    const frag = document.createDocumentFragment();
    for (const r of airportRows) {
      const code = r.icao || r.iata;
      if (!code) continue;
      const opt = document.createElement('option');
      opt.value = code;
      opt.label = (r.name ? r.name : '') + (r.city ? ' · ' + r.city : '');
      frag.appendChild(opt);
    }
    apList.appendChild(frag);
  } catch (e) {
    toast(t('dataBad'), 'err');
  }
}

function setHint(el, kind, ok, airport, code) {
  el.classList.toggle('err', !ok);
  if (!ok) { el.textContent = ok === undefined ? '' : `⚠️ ${code ? code + ' ' : ''}${t('notFound')}`; return; }
  const nm = displayName(airport);
  const ct = cityName(airport);
  const parts = [];
  parts.push(`📍 ${nm}${ct ? ' · ' + ct : ''}`);
  if (airport.icao && airport.iata) parts.push(`${airport.icao} / ${airport.iata}`);
  else if (airport.icao) parts.push(airport.icao);
  else if (airport.iata) parts.push(airport.iata);
  el.textContent = parts.join('   ');
  lookupCache[kind] = airport;
}

function redrawLookupHints() {
  for (const kind of ['origin', 'dest']) {
    const el = kind === 'origin' ? hintOrigin : hintDest;
    const air = lookupCache[kind];
    if (!air) { el.textContent = ''; continue; }
    setHint(el, kind, true, air, '');
  }
}

async function lookupAirport(code, kind) {
  const el = kind === 'origin' ? hintOrigin : hintDest;
  const c = (code || '').trim().toUpperCase();
  if (!c) { el.textContent = ''; lookupCache[kind] = null; return; }
  try {
    const res = await fetch('/api/airport/' + encodeURIComponent(c));
    const data = await res.json();
    if (data && data.found) setHint(el, kind, true, data, c);
    else { lookupCache[kind] = null; setHint(el, kind, false, null, c); }
  } catch (e) {
    setHint(el, kind, false, null, c);
  }
}

function bindLookup(input, kind) {
  const qBtn = kind === 'origin' ? $('qOrigin') : $('qDest');
  const doLookup = () => lookupAirport(input.value, kind);
  input.addEventListener('blur', doLookup);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { doLookup(); input.blur(); } });
  qBtn.addEventListener('click', doLookup);
  input.addEventListener('input', () => {
    if (input.value.trim() === '') { lookupCache[kind] = null; (kind === 'origin' ? hintOrigin : hintDest).textContent = ''; }
  });
}

// ══════════════════════════ 图层切换 ══════════════════════════
$('mapMode').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const sat = btn.dataset.mode === 'sat';
  if (sat && !ionReady) {
    toast(t('lookupErr') + ' (Ion)', 'err');
    return;
  }
  $('mapMode').querySelectorAll('button').forEach((b) => b.classList.remove('on'));
  btn.classList.add('on');
  osmLayer.show = !sat;
  if (ionLayer) ionLayer.show = sat;
});

// ══════════════════════════ 航线 & 航班 ══════════════════════════
function clearFlight() {
  viewer.entities.removeAll();
  viewer.trackedEntity = undefined;
  flight.routeEntity = flight.aircraftEntity = flight.oMarker = flight.dMarker = null;
  flight.active = flight.arrived = false;
  statSpeed.textContent = statAlt.textContent = statRemain.textContent = statEta.textContent = '—';
  barProg.style.width = '0%';
}

function airportMarker(airport, colorHex, textColor) {
  const pos = Cesium.Cartesian3.fromDegrees(airport.lon, airport.lat, 0);
  const mk = viewer.entities.add({
    position: pos,
    point: { pixelSize: 11, color: Cesium.Color.fromCssColorString(colorHex),
             outlineColor: Cesium.Color.fromCssColorString('#04060d'), outlineWidth: 2 },
    label: {
      text: '', font: '600 14px "PingFang SC","Noto Sans SC",sans-serif',
      fillColor: Cesium.Color.fromCssColorString(textColor),
      showBackground: true, backgroundColor: Cesium.Color.fromCssColorString('rgba(3,8,18,0.66)'),
      backgroundPadding: new Cesium.Cartesian2(8, 6),
      pixelOffset: new Cesium.Cartesian2(0, -30), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      style: Cesium.LabelStyle.FILL
    }
  });
  return mk;
}

function refreshMarker(mk, airport) {
  if (!mk) return;
  const codeLine = [airport.icao, airport.iata].filter(Boolean).join(' / ');
  mk.label.text = displayName(airport) + (codeLine ? '\n' + codeLine : '');
  mk.position = Cesium.Cartesian3.fromDegrees(airport.lon, airport.lat, 0);
}

function samplePositions(waypoints) {
  // 累计段距(km)
  const segs = [];
  for (let i = 1; i < waypoints.length; i++) {
    segs.push({ a: waypoints[i - 1], b: waypoints[i], d: haversineKm(waypoints[i - 1], waypoints[i]) });
  }
  const totalKm = segs.reduce((s, x) => s + x.d, 0);
  // 巡航速度 ≈ 真实客机地速(820 km/h): 1× 倍速 = 真实飞行时长
  const CRUISE_KMH = 820;
  flight.durationReal = Math.max(20, Math.round((totalKm / CRUISE_KMH) * 3600));  // 真实秒
  flight.simTotal = flight.durationReal;   // 模拟钟与真实时间 1:1(×1 时)
  const simPerKm = flight.simTotal / Math.max(totalKm, 1e-6);

  flight.start = Cesium.JulianDate.now();
  flight.stop = Cesium.JulianDate.addSeconds(flight.start, flight.simTotal, new Cesium.JulianDate());

  const posProp = new Cesium.SampledPositionProperty();
  posProp.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
  posProp.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;

  let cursor = 0, seg = segs[0] || null;
  const N = flight.simTotal;
  for (let s = 0; s <= N; s++) {
    const dist = totalKm * (s / N);               // 匀速: 当前累计距离
    while (seg && dist > cursor + seg.d) { cursor += seg.d; seg = segs[segs.indexOf(seg) + 1]; }
    let lat, lon, alt;
    if (!seg) { const w = waypoints[waypoints.length - 1]; lat = w.lat; lon = w.lon; alt = w.alt; }
    else {
      const u = clamp((dist - cursor) / seg.d, 0, 1);
      const p = gcLerp(seg.a, seg.b, u);
      lat = p.lat; lon = p.lon;
      alt = seg.a.alt + (seg.b.alt - seg.a.alt) * u;
    }
    const when = Cesium.JulianDate.addSeconds(flight.start, s, new Cesium.JulianDate());
    posProp.addSample(when, Cesium.Cartesian3.fromDegrees(lon, lat, alt));
  }
  return posProp;
}

async function startFlight() {
  const oCode = elOrigin.value.trim().toUpperCase();
  const dCode = elDest.value.trim().toUpperCase();
  const airline = elAirline.value.trim();
  const flightNo = elFlight.value.trim();
  if (!oCode || !dCode) { toast(t('startErr'), 'err'); return; }

  btnFly.disabled = true;
  let data;
  try {
    const qs = new URLSearchParams({ origin: oCode, dest: dCode });
    if (airline) qs.set('airline', airline);
    if (flightNo) qs.set('flight', flightNo);
    const res = await fetch('/api/route?' + qs.toString());
    data = await res.json();
    if (!res.ok) { toast((data && data.error) || t('routeErr'), 'err'); btnFly.disabled = false; return; }
  } catch (e) {
    toast(t('routeErr') + ': ' + e.message, 'err');
    btnFly.disabled = false;
    return;
  }

  // ── 清场并重建 ──
  clearFlight();
  panel.classList.add('hidden');    // 飞行中隐藏设置面板,只留底部控制栏
  btnStop.disabled = false;
  flight.active = true;
  flight.arrived = false;
  flight.airline = data.airline;
  flight.flightNo = data.flight;
  flight.distanceKm = data.distanceKm;
  flight.cruiseAlt = data.cruiseAltM;
  flight.origin = data.origin;
  flight.dest = data.dest;
  lookupCache.origin = data.origin;
  lookupCache.dest = data.dest;
  redrawLookupHints();

  // 航路点 → Cartesian(带高度)
  const wps = data.waypoints;
  flight.waypointCartesians = wps.map((w) => Cesium.Cartesian3.fromDegrees(w.lon, w.lat, w.alt));
  const gcs = flight.waypointCartesians.map((c) => Cesium.Cartographic.fromCartesian(c));

  const posProp = samplePositions(wps);

  // ── 底图: 航路双线(霓虹青 + 紫辉光) ──
  const routeEntity = viewer.entities.add({
    polyline: {
      positions: flight.waypointCartesians,
      width: 5,
      material: new Cesium.PolylineGlowMaterialProperty({
        color: Cesium.Color.fromCssColorString('#22d3ee'), glowPower: 0.28
      })
    }
  });
  viewer.entities.add({
    polyline: {
      positions: flight.waypointCartesians,
      width: 11,
      material: Cesium.Color.fromCssColorString('rgba(122, 90, 248, 0.16)')
    }
  });

  // ── 起降机场标记(码名对照标签) ──
  flight.oMarker = airportMarker(data.origin, '#34f5a0', '#d6ffe9');
  flight.dMarker = airportMarker(data.dest, '#ff5d7a', '#ffe3ea');
  refreshMarker(flight.oMarker, data.origin);
  refreshMarker(flight.dMarker, data.dest);

  // ── 飞机(机外视角基础: SampledPosition + 速度定向) ──
  const callsign = (data.airline ? data.airline + ' ' : '') + data.flight;
  const aircraftEntity = viewer.entities.add({
    position: posProp,
    orientation: new Cesium.VelocityOrientationProperty(posProp),
    model: {
      uri: '/models/Cesium_Air.glb',
      minimumPixelSize: 96,
      maximumScale: 40000
    },
    label: {
      text: callsign, font: '600 15px monospace',
      fillColor: Cesium.Color.fromCssColorString('#a5f3ff'),
      showBackground: true, backgroundColor: Cesium.Color.fromCssColorString('rgba(2,10,20,0.7)'),
      backgroundPadding: new Cesium.Cartesian2(8, 5),
      pixelOffset: new Cesium.Cartesian2(0, -74),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 90000)
    }
  });
  flight.aircraftEntity = aircraftEntity;
  flight.routeEntity = routeEntity;

  // ── 时钟: 60× 模拟 ──
  const clock = viewer.clock;
  clock.startTime = flight.start.clone();
  clock.stopTime = flight.stop.clone();
  clock.currentTime = flight.start.clone();
  clock.clockRange = Cesium.ClockRange.CLAMPED;
  clock.multiplier = flight.speedFactor;   // ×1 = 真实时长, ×N = 快进 N 倍
  clock.shouldAnimate = true;
  btnPause.dataset.paused = '';
  btnPause.textContent = t('btnPause');

  bar.classList.remove('hidden');
  renderBar();

  // 开场: 先全览航线 → 再锁定机外跟随
  btnFly.textContent = t('flying') + '…';
  const HPR = Cesium.HeadingPitchRange;
  const overviewRange = Math.max(flight.distanceKm * 1000 * 0.6, 120000);
  viewer.flyTo(routeEntity, {
    duration: 2.2,
    offset: new HPR(0, Cesium.Math.toRadians(-55), overviewRange)
  }).catch(() => { /* 用户可能打断 */ }).then(() => {
    if (!flight.active) return;
    if (btnFollow.dataset.on) {
      viewer.trackedEntity = aircraftEntity;
      const rangeM = clamp(flight.cruiseAlt * 3.4, 8000, 30000);
      viewer.zoomTo(aircraftEntity,
        new HPR(0, Cesium.Math.toRadians(-23), rangeM), 1.6)
        .catch(() => { /* 跟踪中断不致命 */ })
        .then(() => { if (flight.active && btnFollow.dataset.on) viewer.trackedEntity = aircraftEntity; });
    }
  });
}

// ── 底部信息栏 ──
function renderBar() {
  if (!flight.active) return;
  const airlineTxt = flight.airline && flight.airline !== '示例航空' ? flight.airline : (lang === 'zh' ? '航班' : 'Flight');
  barTitle.innerHTML = `✈️ <b>${esc(airlineTxt)} ${esc(flight.flightNo)}</b>`;
  const from = displayName(flight.origin), to = displayName(flight.dest);
  barMeta.textContent = `${from}  →  ${to} · 全程 ${fmtKM(flight.distanceKm)} km · ${t('flying')}`;
}

function esc(s) { return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }

let lastHudAt = 0;
function onClockTick(clock) {
  if (!flight.active) return;
  const tNow = clock.currentTime;
  const elapsed = Cesium.JulianDate.secondsDifference(tNow, flight.start);
  const total = flight.simTotal;
  const frac = clamp(elapsed / total, 0, 1);

  if (tNow >= flight.stop && !flight.arrived) {
    arrive();
    return;
  }
  const nowMs = Date.now();
  if (nowMs - lastHudAt < 200) return;
  lastHudAt = nowMs;

  const carto = flight.aircraftEntity && flight.aircraftEntity.position
    ? Cesium.Cartographic.fromCartesian(flight.aircraftEntity.position.getValue(tNow))
    : null;
  if (carto) {
    const altM = Math.max(0, carto.height);
    statAlt.innerHTML = `${t('alt')} <b>${fmtKM(altM)} m</b>`;
  }
  const groundKmh = flight.simTotal > 0 ? flight.distanceKm * 3600 / flight.simTotal : 0;
  statSpeed.innerHTML = `${t('speed')} <b>${Math.round(groundKmh)}</b> ${t('kmh')}`;
  const remainKm = Math.max(0, flight.distanceKm * (1 - frac));
  statRemain.innerHTML = `${t('remain')} <b>${fmtKM(remainKm)}</b> ${t('km')}`;
  const realLeft = Math.max(0, (total - elapsed)) / viewer.clock.multiplier;
  statEta.innerHTML = `${t('eta')} <b>${fmtClock(realLeft)}</b>`;
  barProg.style.width = (frac * 100).toFixed(2) + '%';
}

function arrive() {
  flight.arrived = true;
  const clock = viewer.clock;
  clock.shouldAnimate = false;
  btnPause.textContent = t('btnPause');
  btnPause.dataset.paused = '';
  viewer.trackedEntity = undefined;
  barTitle.innerHTML = `✈️ <b>${esc(flight.airline)} ${esc(flight.flightNo)}</b> · <span style="color:#34f5a0">${t('arrived')}</span>`;
  barMeta.textContent = t('arrivedMsg').replace('{d}', displayName(flight.dest)).replace('{km}', flight.distanceKm.toLocaleString());
  toast(t('arrivedMsg').replace('{d}', displayName(flight.dest)).replace('{km}', flight.distanceKm.toLocaleString()), 'ok');
  // 收尾: 拉远看整条航迹
  viewer.flyTo(flight.routeEntity, {
    duration: 2.6,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60),
      Math.max(flight.distanceKm * 1000 * 0.6, 150000))
  }).catch(() => {});
  btnFly.disabled = false;
  btnFly.textContent = t('btnFly');
  btnFollow.classList.remove('on');
  btnFollow.dataset.on = '';
  btnFollow.textContent = t('btnFree');
  panel.classList.remove('hidden');   // 到达后恢复设置面板,方便再次起飞
}

// ══════════════════════════ 控件 ══════════════════════════
btnFly.addEventListener('click', startFlight);

btnRandom.addEventListener('click', () => {
  if (!airportRows.length) { toast(t('dataBad'), 'err'); return; }
  const usable = airportRows.filter((r) => r.icao);
  for (let tries = 0; tries < 20; tries++) {
    const a = usable[Math.floor(Math.random() * usable.length)];
    const b = usable[Math.floor(Math.random() * usable.length)];
    if (!a || !b || a.icao === b.icao) continue;
    const dist = haversineKm(a, b);
    if (dist < 350 || dist > 6000) continue;
    elOrigin.value = a.icao; elDest.value = b.icao;
    lookupAirport(elOrigin.value, 'origin');
    lookupAirport(elDest.value, 'dest');
    toast(t('randomOk'), 'ok');
    return;
  }
  toast(t('routeErr'), 'err');
});

btnFollow.addEventListener('click', () => {
  const on = btnFollow.classList.toggle('on');
  btnFollow.dataset.on = on ? '1' : '';
  if (flight.active) {
    if (on) { viewer.trackedEntity = flight.aircraftEntity; toast(t('atcLocked'), 'ok'); }
    else { viewer.trackedEntity = undefined; toast(t('freeHint')); }
  }
  btnFollow.textContent = on ? t('btnFollow') : t('btnFree');
});
btnFollow.dataset.on = '1';
btnFollow.classList.add('on');

btnOverview.addEventListener('click', () => {
  if (!flight.routeEntity) return;
  viewer.trackedEntity = undefined;
  btnFollow.classList.remove('on'); btnFollow.dataset.on = '';
  btnFollow.textContent = t('btnFree');
  viewer.flyTo(flight.routeEntity, {
    duration: 2.6,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60),
      Math.max(flight.distanceKm * 1000 * 0.6, 150000))
  }).catch(() => {});
  toast(t('overHint'));
});

btnPause.addEventListener('click', () => {
  if (!flight.active) return;
  const clock = viewer.clock;
  clock.shouldAnimate = !clock.shouldAnimate;
  const paused = !clock.shouldAnimate;
  btnPause.dataset.paused = paused ? '1' : '';
  btnPause.textContent = paused ? t('btnResume') : t('btnPause');
});

// ── 停止航班(确认弹窗 → 恢复初始状态) ──
function closeModal() { modal.classList.add('hidden'); }
function openModal() { if (flight.active) modal.classList.remove('hidden'); }
function stopFlight() {
  clearFlight();
  bar.classList.add('hidden');
  panel.classList.remove('hidden');
  const clock = viewer.clock;
  clock.shouldAnimate = false;
  clock.multiplier = 1;
  flight.speedFactor = 1;
  // 复位底部控制条 UI
  document.querySelectorAll('.spd').forEach((x) => x.classList.remove('on'));
  const one = document.querySelector('.spd[data-spd="1"]');
  if (one) one.classList.add('on');
  btnPause.dataset.paused = '';
  btnPause.textContent = t('btnPause');
  btnFollow.dataset.on = '1';
  btnFollow.classList.add('on');
  btnFollow.textContent = t('btnFollow');
  btnStop.disabled = true;
  btnFly.disabled = false;
  btnFly.textContent = t('btnFly');
  // 清空输入与提示,回到初始状态
  elOrigin.value = elDest.value = elAirline.value = elFlight.value = '';
  lookupCache.origin = lookupCache.dest = null;
  hintOrigin.textContent = '';
  hintDest.textContent = '';
  resetToInitialView();
  toast(t('stopped'), 'ok');
}
btnStop.addEventListener('click', openModal);
modalOk.addEventListener('click', () => { closeModal(); stopFlight(); });
modalCancel.addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

document.querySelectorAll('.spd').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.spd').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    flight.speedFactor = parseFloat(b.dataset.spd);
    if (flight.active) viewer.clock.multiplier = flight.speedFactor;
  });
});

// 双击地球/ESC → 复位到全览(弹窗打开时 ESC 先关弹窗)
const resetView = () => { if (flight.active && flight.routeEntity) btnOverview.click(); };
const globeEl = $('globe');
globeEl.addEventListener('dblclick', resetView);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!modal.classList.contains('hidden')) { closeModal(); return; }
    resetView();
  }
});

// ══════════════════════════ 启动 ══════════════════════════
bindLookup(elOrigin, 'origin');
bindLookup(elDest, 'dest');
viewer.clock.onTick.addEventListener(onClockTick);
// 看门狗: 若 onTick 因渲染停顿漏掉终点帧(后台标签页/低帧率),也能准时触发到达
setInterval(() => {
  if (flight.active && !flight.arrived) {
    try {
      if (viewer.clock.currentTime >= flight.stop) arrive();
    } catch (e) { /* ignore */ }
  }
}, 500);
loadAirportList();
initIonImagery();      // 异步升级为 Ion 卫星影像(失败自动用 OSM)
applyLang();

// 首帧渲染完成后隐藏 loader
let hideDone = false;
const tryHide = () => {
  if (hideDone) return;
  if (viewer.scene.globe.tilesLoaded || viewer.scene.globe._surface.tileProvider.ready) {
    hideDone = true;
    setTimeout(() => loader.classList.add('hidden'), 250);
  }
};
tryHide();
viewer.scene.postRender.addEventListener(() => { if (!hideDone) tryHide(); });
setTimeout(() => { if (!hideDone) { hideDone = true; loader.classList.add('hidden'); } }, 8000); // 兜底

window.__skyforge = { viewer, flight, state: () => ({
  active: flight.active, arrived: flight.arrived,
  t: viewer.clock.currentTime.toString(), multiplier: viewer.clock.multiplier,
  tracked: !!viewer.trackedEntity, entities: viewer.entities.values.length,
  originName: flight.origin ? displayName(flight.origin) : null,
  destName: flight.dest ? displayName(flight.dest) : null
}) }; // 供自动化验证
