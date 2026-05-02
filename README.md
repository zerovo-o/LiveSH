# LiveSH

LiveSH 是一个面向上海居住成本与生活便利性分析的 WebGIS 可视化系统。项目把二手房挂牌价格与购物、交通、医疗、休闲、企业等 POI 数据放到同一张城市空间底图上，以区级尺度衡量“生活便利”与“居住成本”的相对关系，并通过地图、区域详情和多图表分析展示结果。

## 当前功能

- 产品化首屏：展示项目主题、分析目标、评分逻辑，并支持点击双箭头平滑进入地图 GIS。
- GIS 地图：基于高德地图 JS API 展示上海区级空间分布，支持按综合评分、房价、POI 总量、商圈活跃度切换专题图层。
- 推荐区域 Top5：地图左侧展示综合评分排名前 5 的区域，点击后联动地图和详情。
- 区域选择与详情：支持选择全部区域或单个行政区，展示房价、房源、POI、购物、交通、医疗、休闲、企业、住宅、活跃度和评分等指标。
- 可视化分析：提供城市概览、设施结构、关系洞察、评分模型四个模块，包含柱状图、饼图、堆叠柱状图、气泡散点图、相关性热力图、雷达图、评分分布图和平行坐标图。
- 地图与图表联动：点击地图行政区、推荐区域或图表中的区域项，会同步更新当前选中区域。

更完整的功能说明见 [docs/功能说明.md](docs/功能说明.md)。

## 技术栈

- 后端：FastAPI、SQLAlchemy、pandas、pyshp
- 数据库：默认 SQLite；可通过 `DATABASE_URL` 切换 PostgreSQL
- 前端：React、Vite、TypeScript、Tailwind CSS、官方 shadcn/ui、ECharts
- GIS：高德地图 JS API；前端地图统一使用 GCJ-02 坐标

## 项目结构

```text
LiveSH/
├── backend/              # FastAPI、数据处理、数据库模型
├── data/                 # 原始房价数据与 POI shapefile 数据
├── docs/                 # 项目功能说明文档
├── frontend/             # React + Vite 前端
└── README.md
```

## 数据与坐标约定

房价数据来自 `data/sh_house_dataset_raw.parquet`，后端读取 `longitude/latitude` 后按 WGS84 处理，并转换生成 GCJ-02 坐标。

POI 数据来自 `data/sh_poi_raw/` 下的 shapefile，类别包括：

- 购物
- 医疗
- 交通
- 休闲娱乐
- 公司企业
- 住宅

项目会保留 POI 原始 `wgs84_lng/wgs84_lat` 与 `gcj02_lng/gcj02_lat` 字段。前端高德地图、行政区边界、点位和推荐标记统一使用 GCJ-02，避免底图偏移。

## 指标模型

商圈活跃度：

```text
business_activity =
  购物 * 0.35 +
  交通 * 0.25 +
  医疗 * 0.15 +
  休闲娱乐 * 0.15 +
  公司企业 * 0.10
```

Min-Max 标准化：

```text
X' = (X - min) / (max - min)
```

宜居性评分：

```text
livability_score = 标准化(商圈活跃度) - 标准化(平均单价)
```

分数越高，表示该区域在当前模型下生活便利性相对更强，同时居住成本压力相对更低。

## 高德 Key 配置

前端需要高德 Web JS API Key：

```bash
cp frontend/.env.example frontend/.env
```

在 `frontend/.env` 中填写：

```text
VITE_AMAP_KEY=你的高德 Web JS API Key
```

如果高德控制台启用了安全密钥校验，也填写：

```text
VITE_AMAP_SECURITY_CODE=你的安全密钥
```

后端行政区边界代理可使用高德 Web 服务 Key：

```bash
cp backend/.env.example backend/.env
```

在 `backend/.env` 中填写：

```text
AMAP_WEB_SERVICE_KEY=你的高德 Web服务 Key
```

说明：Web JS API Key 和 Web 服务 Key 是两类不同 Key。前端地图加载必须使用 Web JS API Key。

## 后端启动

推荐使用本机 Anaconda Python：

```bash
cd backend
/opt/anaconda3/bin/python3 -m pip install -e ".[postgres]"
/opt/anaconda3/bin/python3 -m app.process_data
/opt/anaconda3/bin/python3 -m uvicorn app.main:app --reload
```

默认会生成 `backend/livability.db`。如果要使用 PostgreSQL，修改 `backend/.env`：

```text
DATABASE_URL=postgresql+psycopg2://用户名:密码@127.0.0.1:5432/shanghai_livability
```

然后重新入库：

```bash
cd backend
/opt/anaconda3/bin/python3 -m app.process_data
```

主要 API：

- `GET /health`
- `GET /api/districts`
- `GET /api/districts/{district}`
- `GET /api/summary`
- `GET /api/amap/shanghai-districts`

## 前端启动

```bash
cd frontend
corepack pnpm install
corepack pnpm run dev
```

Vite 默认地址：

```text
http://localhost:5173
```

生产构建：

```bash
cd frontend
corepack pnpm run build
```

## shadcn/ui 说明

本项目使用官方 shadcn/ui 组件，组件配置位于 `frontend/components.json`。新增组件请使用官方 CLI，例如：

```bash
cd frontend
corepack pnpm dlx shadcn@latest add badge
```

## 展示重点

本项目的展示逻辑不是单纯列出数据，而是回答三个问题：

1. 上海哪些区域房价压力更高？
2. 哪些区域 POI 配套更丰富、商圈活跃度更高？
3. 哪些区域在“低成本 + 高便利”的综合模型下更值得推荐？

地图负责提供空间直觉，可视化分析模块负责解释指标关系、结构差异和评分来源。
