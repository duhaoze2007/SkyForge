# SkyForge · 天际航线

> 输入两个机场代码，看飞机沿真实大圆航线飞越亚洲的 3D 观看站。
> Pick two airports and watch a plane fly the real great-circle route across Asia in 3D.

一个 CesiumJS 驱动的航线可视化小站：输入起降机场（ICAO 或 IATA 都能认），后端按球面线性插值（SLERP）算出真正的**大圆航线**并给出分段爬升—平飞—下降的高度剖面，前端用一架 Cesium_Air 模型从机外视角把整段航程飞一遍。机场名以中文优先显示，界面中英双语。

A CesiumJS-based flight viewer: give it an origin and destination (ICAO or IATA), the server computes the true **great-circle** path by spherical interpolation and a climb → cruise → descent altitude profile, and the front-end flies a Cesium_Air model along it in a chase-cam view. Chinese airport names are shown first where available; UI is bilingual.

---

## ✨ 功能特性 · Features

- 🌐 **真大圆航线** —— 球面线性插值（SLERP）生成 30 个航路点（含起降），不是平面直线；距离按 haversine 累加，跨海跨境的航线才是实际飞行轨迹。
  **True great-circle route** —— 30 waypoints (incl. takeoff/landing) via SLERP, distance accumulated by haversine — the path an airliner actually flies.
- 📈 **分段高度剖面** —— 起终点高度 0，巡航高度在 3000–6000 m 之间随机，70 km 内爬升/下降，平飞段带 ±5% 波动；中部航路点带随机 5 字母伪航路点码，起终点用机场全称。
  **Climb / cruise / descent profile** —— alt 0 at both ends, cruise 3000–6000 m, 70 km climb and descent legs, ±5% ripple in cruise; mid waypoints get random 5-letter pseudo-fix names.
- 🗺️ **自托管 Cesium，无 CDN 依赖** —— Cesium 1.145 整套放在 `public/vendor/cesium`，站点在国内网络也能正常加载（仅卫星影像与地图瓦片需要外网）。
  **Self-hosted Cesium** —— the whole 1.145 distribution lives in `public/vendor/cesium`; the app itself never depends on a CDN.
- 🛰️ **卫星影像可选** —— 填入自己的 Cesium Ion token 即自动升级为卫星底图；token 无效或加载失败时**自动回落 OSM**，不会白屏。
  **Optional satellite imagery** —— supply your own Cesium Ion token to upgrade to satellite imagery; invalid token / load failure falls back to OSM automatically.
- 🔍 **码名对照输入** —— 机场输入框带 `datalist` 联想（ICAO / IATA / 中英文名都能匹配），另有模糊搜索框显示「代码 ↔ 机场全称」对照，不用记代码。
  **Code ↔ name lookup** —— datalist autocomplete on ICAO / IATA / Chinese or English names, plus a fuzzy search list.
- 👁 **机外跟随视角** —— `trackedEntity` 跟随飞机，可切全览 / 暂停 / 停止，到达目的地弹提示。
  **Chase cam** —— `trackedEntity` follow view with overview / pause / stop chips and an arrival toast.
- ✈️ **航班信息自定义** —— 航空公司（预置 18 家亚太航司）、航班号，起飞按钮与随机航线按钮一键出片。
  **Flight metadata** —— pick from 18 preset Asia-Pacific airlines, set a flight number, or hit random route.
- 📦 **亚洲机场数据集** —— 从 OurAirports 公共数据抓取 `continent = AS`、剔除已关闭机场，保留大/中/小型与水上机场，共 **2802 条**（其中 2690 条有 ICAO 码），覆盖 56 个国家/地区；**140 个枢纽机场**带人工校对的中文全称与城市名。首次抓取后缓存到 `data/asia-airports.json`，离线也能启动。
  **Asia dataset** —— 2802 entries (2690 with ICAO) across 56 countries/territories from OurAirports, excluding closed airports; **140 hubs** carry hand-checked Chinese names. Cached to `data/asia-airports.json` after the first fetch so it boots offline.
- ⚡ **缓存策略分离** —— `vendor/`（Cesium 本体，大且不变）30 天 immutable；自研 js/css/html `maxAge: 0` + etag，改版后不会再有用户拿到旧代码。
  **Split cache policy** —— `vendor/` 30 d immutable; own assets `maxAge: 0` + etag so front-end fixes always take effect.

---

## 🚀 快速开始 · Quick start

```bash
npm install
npm start                 # 默认 8086，可用 PORT=xxxx 覆盖
# → http://127.0.0.1:8086
```

首次启动会从 OurAirports 拉取亚洲机场数据（约 450 KB 缓存到 `data/asia-airports.json`）；之后直接读缓存。

On first start it fetches the Asia airports CSV from OurAirports (~450 KB, cached to `data/asia-airports.json`); later boots read the cache.

### 卫星影像（可选）· Satellite imagery (optional)

`public/js/app.js` 顶部有 `const ION_TOKEN = '...'`，把它换成你自己的 [Cesium Ion](https://ion.cesium.com/) token 即可启用卫星底图；留空或无效会自动使用 OSM。**本仓库中不含可用 token，请自行申请。**

Replace `const ION_TOKEN = '...'` at the top of `public/js/app.js` with your own [Cesium Ion](https://ion.cesium.com/) token to enable satellite basemap; empty or invalid tokens fall back to OSM. **No working token ships with this repository.**

---

## 🔌 API

| 端点 / Endpoint | 说明 / Description |
| --- | --- |
| `GET /api/airport/:code` | 机场查询，ICAO 或 IATA 均可（如 `/api/airport/ZSPD`、`/api/airport/PVG`），中文名优先返回 / look up by ICAO or IATA, Chinese name first |
| `GET /api/route?origin=&dest=&airline=&flight=` | 生成航线：30 个航路点 + `distanceKm` + `cruiseAltM` + 起终点全称 / build a route with 30 waypoints, distance and cruise altitude |
| `GET /api/list?q=` | 机场列表 / 模糊搜索（最多 50 条）/ list or fuzzy-search airports |
| `GET /api/stats` | 数据集状态：来源、ICAO/IATA 数量、总数、更新时间、枢纽数 / dataset stats |

```bash
curl 'http://127.0.0.1:8086/api/route?origin=ZSPD&dest=VHHH&airline=中国东方航空&flight=MU501'
```

---

## 📁 项目结构 · Project layout

```
server.js            Express 后端: 机场数据加载、大圆航线与高度剖面计算、静态前端托管
airports-core.js     140 个枢纽机场的 ICAO/IATA/中文名/城市/经纬度(人工校对)
data/                机场数据缓存(首次启动自动生成)
previews/            截图预览
public/
  index.html         页面结构
  js/app.js          Cesium 场景、航线动画、i18n、Ion token 与回落逻辑
  css/style.css      样式
  models/            Cesium_Air.glb 飞机模型
  vendor/cesium/     自托管 Cesium 1.145(不提交到 CDN)
```

---

## 🚢 部署 · Deployment

线上当时以 systemd + Caddy 反代运行（Node 绑 `127.0.0.1:8086`，Caddy 负责 HTTPS 与域名）。任何 Node 运行环境 + 反向代理都能跑，也可直接用 `node server.js`。

It ran behind systemd + Caddy with Node bound to `127.0.0.1:8086`. Any Node host plus a reverse proxy works; `node server.js` alone is fine too.

---

## 🙏 数据与致谢 · Data & credits

- 机场数据：[OurAirports](https://ourairports.com/data/)（Public Domain）。
- 3D 地球与影像：[CesiumJS](https://cesium.com/platform/cesiumjs/)（Apache-2.0），`Cesium_Air.glb` 模型来自 Cesium 官方示例资源。
- 地图回落底图：OpenStreetMap 贡献者（ODbL）。

---

## 📄 License

MIT © 2026 Du Haoze — 见 [LICENSE](./LICENSE)。
