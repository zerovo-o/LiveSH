# 地图 GIS 与高德配置

## 地图 GIS 功能

地图模块使用高德地图 JS API，当前已支持：

- 上海区级行政区展示
- 本地街道/镇边界展示
- 行政区点击选中
- 区级推荐结果高亮
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

## 常见排查

如果地图加载失败，优先检查：

1. `VITE_AMAP_KEY` 是否为 Web JS API Key
2. `VITE_AMAP_SECURITY_CODE` 是否与控制台配置一致
3. 当前域名是否在白名单内
4. 后端是否正常提供 `/api/amap/shanghai-districts`
5. 本地街镇边界数据是否完整
