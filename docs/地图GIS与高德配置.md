# 地图 GIS 与高德配置

## 地图 GIS 功能

地图模块使用高德地图 JS API，当前已支持：

- 上海区级行政区展示
- 本地街道/镇边界展示
- 行政区点击选中
- 区级推荐结果高亮
- 街镇边界叠加与街镇级着色
- POI 和房源热力接口已在后端提供，前端可继续扩展为热力图层
- 主题切换：
  - 校准评分
  - 生活圈
  - 房价
  - POI 总量
  - 商圈活跃度

当街镇边界开启且数据可用时，地图会优先按街镇指标着色；否则退回区级指标展示。

## 坐标约定

高德地图使用 GCJ-02。项目约定：

- 前端地图展示统一使用 GCJ-02
- 房价原始坐标按 WGS84 读取，入库时转换为 GCJ-02
- POI 同时保留 WGS84 与 GCJ-02 字段
- 前端边界、点位和区级中心点统一使用 GCJ-02

## 前端 Web JS API Key

```bash
cp frontend/.env.example frontend/.env
```

```text
VITE_AMAP_KEY=你的高德 Web JS API Key
# 如果启用了安全密钥
VITE_AMAP_SECURITY_CODE=你的安全密钥
```

## 后端 Web 服务 Key

```bash
cp backend/.env.example backend/.env
```

```text
AMAP_WEB_SERVICE_KEY=你的高德 Web 服务 Key
```

后端会在以下场景使用 Web 服务 Key：

- 行政区边界接口无法使用本地边界时，请求高德行政区服务兜底。
- 个性化 Agent 推荐中，对工作地点进行地理编码，并计算公交或驾车通勤时间。
- `sample_walking_routes.py` 中，对抽样房源和 POI 调用步行路线规划，生成真实路网生活圈试算结果。

图表 AI 结论不依赖高德 Key，而依赖 DeepSeek 配置：

```text
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

## 常见排查

如果地图加载失败，优先检查：

1. `VITE_AMAP_KEY` 是否为 Web JS API Key
2. `VITE_AMAP_SECURITY_CODE` 是否与控制台配置一致
3. 当前域名是否在白名单内
4. 后端是否正常提供 `/api/amap/shanghai-districts`
5. 本地街镇边界数据是否完整

如果个性化推荐的通勤结果为空，优先检查：

1. `AMAP_WEB_SERVICE_KEY` 是否为 Web 服务 Key，而不是前端 Web JS Key
2. 工作地点是否能被高德地理编码识别
3. 高德路线服务是否达到调用额度
4. 后端日志中是否出现 `amap_route_failure_count`
