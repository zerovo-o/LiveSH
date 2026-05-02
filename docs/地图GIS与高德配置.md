# 地图 GIS 与高德配置

本文档说明 LiveSH 的地图 GIS 功能、坐标约定和高德 Key 配置。

## 地图 GIS 功能

地图模块使用高德地图 JS API。

已实现能力：

- 上海区级行政区展示。
- 行政区点击选中。
- 当前选中区高亮。
- 推荐区域 Top5 显示在地图左侧。
- 支持切换专题指标：
  - 综合评分
  - 房价
  - POI 总量
  - 商圈活跃度

地图展示的目的不是只显示底图，而是让用户直观看到各区在成本和便利性上的空间差异。

## 坐标约定

高德地图使用 GCJ-02 坐标。项目约定：

- 前端地图展示统一使用 GCJ-02。
- 房价原始坐标按 WGS84 读取，入库时转换为 GCJ-02。
- POI 数据同时保留 WGS84 与 GCJ-02 字段，前端和区级中心点使用 GCJ-02。

## 前端 Web JS API Key

前端地图加载需要高德 Web JS API Key：

```bash
cp frontend/.env.example frontend/.env
```

在 `frontend/.env` 中填写：

```text
VITE_AMAP_KEY=你的高德 Web JS API Key
```

如果高德应用启用了安全密钥：

```text
VITE_AMAP_SECURITY_CODE=你的安全密钥
```

## 后端 Web 服务 Key

后端行政区边界代理使用高德 Web 服务 Key：

```bash
cp backend/.env.example backend/.env
```

在 `backend/.env` 中填写：

```text
AMAP_WEB_SERVICE_KEY=你的高德 Web服务 Key
```

## Key 类型说明

- Web JS API Key 用于浏览器中的高德地图 JS API。
- Web 服务 Key 用于后端请求行政区边界接口。
- 两类 Key 的平台类型不同，不能混用。

如果前端出现地图或行政区边界加载失败，优先检查：

1. `VITE_AMAP_KEY` 是否为 Web JS API Key。
2. 高德控制台是否开启 Web JS API 服务。
3. 如果启用安全密钥，`VITE_AMAP_SECURITY_CODE` 是否填写正确。
4. 域名白名单是否包含当前开发地址，例如 `localhost:5173`。
5. 后端行政区边界代理是否配置了 `AMAP_WEB_SERVICE_KEY`。
