# shanghai-livability-analysis

本项目基于上海房价与 POI 数据，通过空间分析与多维指标建模，构建城市宜居性评估系统，并以地图与多图表联动的方式进行可视化展示。

## 技术栈

- 后端：FastAPI、SQLAlchemy、pandas、pyshp
- 数据库：默认 SQLite；可通过 `DATABASE_URL` 切换 PostgreSQL
- 前端：React、Vite、TypeScript、Tailwind CSS、官方 shadcn/ui 组件、ECharts
- GIS：高德地图 JS API，前端统一使用 GCJ-02 坐标

## 坐标约定

- 房价 parquet 的 `longitude/latitude` 按 WGS84 读取，入库时转换生成 `gcj02_lng/gcj02_lat`。
- POI shapefile 原始字段同时包含 `wgs84_lng/wgs84_lat`、`gcj02_lng/gcj02_lat`，后端全部保留。
- 前端高德地图、行政区面、推荐标记只使用 GCJ-02，避免高德底图偏移。

## POI 分类与评分模型

本项目按原始 POI 包类别建模：

- 购物
- 医疗
- 交通
- 休闲娱乐
- 公司企业
- 住宅

商圈活跃度：

```text
business_activity =
  购物 * 0.35 +
  交通 * 0.25 +
  医疗 * 0.15 +
  休闲娱乐 * 0.15 +
  公司企业 * 0.10
```

标准化：

```text
X' = (X - min) / (max - min)
```

宜居性评分：

```text
livability_score = 标准化(商圈活跃度) - 标准化(平均单价)
```

## 高德 Key 填写位置

复制前端环境文件：

```bash
cp frontend/.env.example frontend/.env
```

在 `frontend/.env` 中填写：

```text
VITE_AMAP_KEY=你的高德Web JS API Key
```

如果高德控制台启用了安全密钥，也填写：

```text
VITE_AMAP_SECURITY_CODE=你的安全密钥
```

## 启动后端

推荐使用本机 Anaconda Python：

```bash
cd backend
/opt/anaconda3/bin/python3 -m pip install -e ".[postgres]"
/opt/anaconda3/bin/python3 -m app.process_data
/opt/anaconda3/bin/python3 -m uvicorn app.main:app --reload
```

默认会生成 `backend/livability.db`。如果要使用 PostgreSQL，复制并修改：

```bash
cp backend/.env.example backend/.env
```

将 `backend/.env` 改为：

```text
DATABASE_URL=postgresql+psycopg2://用户名:密码@127.0.0.1:5432/shanghai_livability
```

然后重新执行：

```bash
cd backend
/opt/anaconda3/bin/python3 -m app.process_data
```

## 启动前端

```bash
cd frontend
corepack pnpm install
corepack pnpm run dev
```

Vite 默认地址为：

```text
http://localhost:5173
```

## Dashboard 功能

- 左侧 70%：高德地图行政区 Choropleth，颜色代表宜居性评分
- 右侧 30%：区域详情和多图表分析
- 地图点击行政区后高亮选中区，并更新详情与图表标记
- 图表点击区名后反向联动地图
- Top 3 推荐区在地图上显示推荐标记

图表包括：

- 房价 Top10 区域柱状图
- POI 类别占比饼图
- 购物数量 Top5 区域柱状图
- 房价 vs 商圈活跃度散点图
- 宜居性评分排名条形图
