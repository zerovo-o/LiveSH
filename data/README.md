# LiveSH 数据说明

这个目录只保存项目运行所需的数据入口和本地派生结果。由于 POI shapefile、SQLite 数据库和 17w 房源派生数据体积较大，GitHub 仓库通常不会完整上传这些文件；组员 clone 代码后，需要按下面结构补齐数据或重新生成数据库。

## 必需数据

### 1. 房源数据

默认运行使用：

```text
data/sh_house_dataset_raw.parquet
```

这是当前项目内置的房源点数据，后端入库脚本默认读取它。文件需要包含房源价格、行政区/街镇和经纬度相关字段，入库后会生成房源点、街镇指标和区级指标。

如果要使用 17w 安居客房源，需要先准备或生成：

```text
data/derived/sh_house_dataset_anjuke_geocoded.parquet
```

然后用下面命令指定房源文件重新入库：

```bash
cd backend
.venv/bin/python -m app.process_data --house-path ../data/derived/sh_house_dataset_anjuke_geocoded.parquet
```

说明：17w 房源原始文件和地理编码缓存不建议上传 GitHub，通常线下共享。

### 2. POI 原始数据

完整算法必须有 POI 数据，目录固定为：

```text
data/sh_poi_raw/
```

需要包含 6 类上海 POI shapefile：

```text
data/sh_poi_raw/sh_company/
data/sh_poi_raw/sh_healthcare/
data/sh_poi_raw/sh_recreation/
data/sh_poi_raw/sh_residence/
data/sh_poi_raw/sh_shopping/
data/sh_poi_raw/sh_traffic facility/
```

每个 shapefile 至少需要成套包含：

```text
.shp
.shx
.dbf
.prj
```

常见附属文件如 `.sbn`、`.sbx`、`.shp.xml` 可以保留。POI 会被读取为：

```text
购物、交通、医疗、休闲娱乐、公司企业、住宅
```

其中住宅 POI 不作为服务设施加分，而是作为 E2SFCA 的居住需求密度代理。

### 3. 街镇边界

街镇边界用于给房源和 POI 匹配街镇，路径固定为：

```text
data/sh_street_boundary/shanghai_street_boundary.shp
```

同样需要 shapefile 成套文件：

```text
shanghai_street_boundary.shp
shanghai_street_boundary.shx
shanghai_street_boundary.dbf
shanghai_street_boundary.prj
```

## 自动生成数据

运行入库脚本后会自动生成：

```text
backend/livability.db
data/derived/
```

`backend/livability.db` 是本地 SQLite 数据库，前后端运行时读取它。它是生成结果，不建议上传 GitHub。

`data/derived/` 是本地派生数据目录，包含：

```text
house_features_current.parquet
demand_points_current.parquet
house_features_phase4_current.parquet
house_life_circle_features_current.parquet
poi_subtype_audit.csv
life_circle_street_comparison.csv
```

这些文件用于检查算法中间结果，也不建议上传 GitHub。

## 数据缺失时会怎样

如果缺少 `data/sh_poi_raw/`，后端无法完整计算 POI 细分、E2SFCA 供需可达性和 5/10/15 分钟生活圈。

如果缺少 `backend/livability.db`，需要先运行入库脚本重新生成：

```bash
cd backend
.venv/bin/python -m app.process_data
```

如果使用 17w 房源，则运行：

```bash
cd backend
.venv/bin/python -m app.process_data --house-path ../data/derived/sh_house_dataset_anjuke_geocoded.parquet
```
