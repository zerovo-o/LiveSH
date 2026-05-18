# LiveSH

LiveSH 是一个面向上海居住选择分析的 WebGIS 可视化系统。项目把二手房挂牌数据、POI 设施数据和街镇边界放到同一套空间分析流程中，从**行政区、街道/镇、房源点周边**三个层次评估“住得是否划算、生活是否方便”。

系统当前关注的不只是 POI 总量，而是进一步结合：

- 房价负担
- 设施供给结构
- 设施可达性
- 供需匹配程度
- 5 / 10 / 15 分钟生活圈覆盖
- 样本数量带来的结果可信度

最终通过地图、指标卡片、图表和街镇明细，把“哪里更值得推荐”以及“为什么值得推荐”一起展示出来。

## 项目现在能做什么

- **首页叙事与 GIS 入口**：用产品化首屏说明项目目标、数据对象和评分逻辑，并可平滑进入地图主视图。
- **区级专题地图**：支持查看校准评分、生活圈、房价、POI 总量、商圈活跃度等专题图层。
- **街道/镇精细分析**：可按行政区筛选、搜索街道/镇，并查看生活圈、供需可达性、最近交通/医疗距离等细粒度指标。
- **推荐区域 Top5**：按当前默认推荐分 `calibrated_score_life_circle` 排序，并对低样本结果做降权处理。
- **多维可视化分析**：展示房价排名、POI 结构、评分分布、相关性、象限关系、雷达对比等图表。
- **联动交互**：点击地图、推荐卡片、区域项后，地图、指标面板和图表会同步更新。
- **AI 居住建议模块**：前后端接口已具备，目前返回规则占位结果，代码中预留了后续接入真实大模型的位置。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | React 18、Vite、TypeScript、Tailwind CSS、shadcn/ui、ECharts |
| 后端 | FastAPI、SQLAlchemy、pandas、SciPy、pyproj、pyshp |
| 数据库 | SQLite（默认），可切换 PostgreSQL |
| GIS | 高德地图 JS API、GCJ-02 / WGS84 坐标转换 |

## 项目结构

```text
LiveSH/
├── backend/                  # FastAPI 接口、评分算法、数据入库脚本
│   └── app/
├── data/                     # 原始数据、边界数据、派生结果
│   ├── sh_house_dataset_raw.parquet
│   ├── sh_street_boundary/
│   └── README.md
├── docs/                     # 课程说明文档
├── frontend/                 # React + Vite 前端
└── README.md
```

## 分析逻辑概览

LiveSH 当前保留了多层评分结果，方便对比不同阶段模型的效果。

### 1. 基础聚合

系统先把房源与 POI 聚合到区级和街镇级，得到：

- 平均挂牌单价、平均总价、房源数量
- 各类 POI 数量
- 商圈活跃度
- POI 多样性

其中商圈活跃度仍保留早期的加权公式：

```text
business_activity =
  购物 * 0.35 +
  交通 * 0.25 +
  医疗 * 0.15 +
  休闲娱乐 * 0.15 +
  公司企业 * 0.10
```

### 2. 稳健评分

在简单“活跃度 - 房价”模型之外，项目进一步加入：

- 每套房对应的服务供给强度
- POI 多样性
- 房价负担分
- 区域活力分

形成更稳健的 `livability_score_v2`。

### 3. 房源点可达性与供需匹配

系统会围绕房源点计算：

- 购物、交通、医疗、休闲、企业的距离衰减可达性
- 最近交通距离、最近医疗距离
- E2SFCA 风格的供需可达性分
- 性价比分与校准评分

### 4. 生活圈评分

项目按 5 / 10 / 15 分钟生活圈分别评估：

- 基础覆盖率
- 加权可达性
- 设施多样性

并合成为 `life_circle_score`。当前前端默认推荐使用的是：

```text
calibrated_score_life_circle
```

它综合了校准评分与生活圈表现，是现在地图默认着色和 Top5 推荐的主要依据。

## 数据说明

项目默认使用以下数据入口：

```text
data/sh_house_dataset_raw.parquet
data/sh_poi_raw/
data/sh_street_boundary/shanghai_street_boundary.shp
```

其中：

- 房源数据用于价格、位置和房源样本分析
- POI 数据用于设施结构、可达性和生活圈计算
- 街镇边界用于把房源和 POI 进一步匹配到街道/镇

运行入库脚本后，会自动生成：

```text
backend/livability.db
data/derived/
```

`data/derived/` 中保存房源级中间结果、供需点、生活圈特征和审计文件，便于复查算法过程。

更完整的数据约定见 [data/README.md](data/README.md)。

## 快速开始

### 1. 配置环境变量

前端地图需要高德 Web JS API Key：

```bash
cp frontend/.env.example frontend/.env
```

```text
VITE_AMAP_KEY=你的高德 Web JS API Key
# 可选
VITE_AMAP_SECURITY_CODE=你的安全密钥
```

后端行政区边界接口可配置高德 Web 服务 Key：

```bash
cp backend/.env.example backend/.env
```

```text
DATABASE_URL=sqlite:///./livability.db
AMAP_WEB_SERVICE_KEY=你的高德 Web 服务 Key
```

如果不配置 `DATABASE_URL`，后端默认使用本地 SQLite 数据库。

### 2. 启动后端

建议使用 Python 3.10+：

```bash
cd backend
python3 -m pip install -e ".[postgres]"
python3 -m app.process_data
python3 -m uvicorn app.main:app --reload
```

默认后端地址：

```text
http://127.0.0.1:8000
```

如果要换用 PostgreSQL，可在 `backend/.env` 中修改：

```text
DATABASE_URL=postgresql+psycopg2://用户名:密码@127.0.0.1:5432/shanghai_livability
```

然后重新执行入库脚本。

### 3. 启动前端

```bash
cd frontend
corepack pnpm install
corepack pnpm run dev
```

默认前端地址：

```text
http://localhost:5173
```

Vite 已把 `/api` 和 `/health` 代理到 `127.0.0.1:8000`，因此本地开发时前后端可直接联调。

## 常用接口

| 接口 | 作用 |
| --- | --- |
| `GET /health` | 健康检查 |
| `GET /api/summary` | 前端主面板汇总数据 |
| `GET /api/districts` | 区级指标列表 |
| `GET /api/districts/{district}` | 单个行政区指标 |
| `GET /api/streets` | 街道/镇指标列表，可按 `district` 过滤 |
| `GET /api/streets/{district}/{street}` | 单个街道/镇指标 |
| `GET /api/amap/shanghai-districts` | 上海区级边界 |
| `GET /api/amap/shanghai-streets` | 上海街镇边界 |
| `POST /api/ai/advice` | AI 居住建议接口 |

## 地图与坐标约定

高德地图前端统一使用 **GCJ-02**：

- 房源原始坐标按 WGS84 读取，入库时会转换为 GCJ-02
- POI 同时保留 WGS84 与 GCJ-02 字段
- 前端地图、行政区边界、街镇边界和推荐点位均使用 GCJ-02

这样可以避免底图、行政区面和点位之间出现明显偏移。

## 当前限制与注意事项

- `AI 居住建议` 模块目前仍是占位实现，真实大模型调用尚未接入。
- 如果缺少 `data/sh_poi_raw/`，系统无法完整计算 POI 细分、供需可达性和生活圈指标。
- 街道/镇推荐列表当前默认只展示房源数不少于 50 的样本，以减少小样本误导。
- 旧文档中的部分说明仍基于早期“区级简单评分”版本，如需课程汇报，建议优先以本 README 和实际代码为准。

## 相关文档

- [数据说明](data/README.md)
- [功能说明入口](docs/功能说明.md)
- [后端接口说明](docs/后端接口说明.md)
- [前端功能说明](docs/前端功能说明.md)
- [地图 GIS 与高德配置](docs/地图GIS与高德配置.md)

