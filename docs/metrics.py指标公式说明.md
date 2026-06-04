# 前端展示指标公式说明

本文只保留前端页面实际展示的数据指标，并使用前端展示名称作为标题。  
核心评分公式来自 `backend/app/metrics.py`；房价、房源数、POI 数量、商圈活跃度等基础统计来自 `backend/app/process_data.py`。

## 0. 通用口径

### 0.1 展示分数

后端评分字段大多以 `0-1` 保存，前端通过 `displayScore` 展示为 `0-10` 分：

```text
前端展示分 = 后端原始分 * 10
```

例如：

```text
calibrated_score_life_circle = 0.73
前端“校准评分” = 7.3
```

### 0.2 MinMax 归一化

```text
minmax(x_i) = (x_i - min(x)) / (max(x) - min(x))
```

特殊情况：

```text
max(x) = min(x)：返回 0.5
缺失值：填充为 0
最终结果：限制在 0-1
```

### 0.3 百分位排名

```text
percentile_rank(x_i) = (rank(x_i) - 1) / (N - 1)
```

其中 `rank` 为从低到高排序后的平均名次。只有 1 个有效值时返回 `0.5`。

### 0.4 距离衰减

```text
decay(distance_m, beta_m) = exp(-distance_m / beta_m)
```

距离越近，贡献越接近 `1`；距离越远，贡献越小。

## 1. 平均房价

前端名称：平均房价、房价  
后端字段：`avg_price`

含义：区域内房源挂牌单价的平均值，前端展示为 `元/㎡`。

```text
avg_price = mean(unit_price)
```

全市汇总卡片中使用房源数量加权平均：

```text
全市平均房价 =
  sum(district_avg_price * district_house_count)
  / sum(district_house_count)
```

## 2. 平均总价

前端名称：平均总价  
后端字段：`avg_total_price`

含义：区域内房源挂牌总价的平均值，前端展示为 `万`。

```text
avg_total_price = mean(price)
```

全市汇总卡片中使用房源数量加权平均：

```text
全市平均总价 =
  sum(district_avg_total_price * district_house_count)
  / sum(district_house_count)
```

## 3. 房源数量

前端名称：房源数量、挂牌样本量  
后端字段：`house_count`

含义：区域内有效房源挂牌数量。

```text
house_count = count(house_listing)
```

街道/镇推荐列表只展示达到推荐门槛的街镇：

```text
house_count >= 50
```

## 4. POI 总数

前端名称：POI总数、POI、设施总量  
后端字段：`poi_total`

含义：区域内六类 POI 数量合计。

```text
poi_total =
  shopping_count
+ traffic_count
+ healthcare_count
+ recreation_count
+ company_count
+ residence_count
```

## 5. 购物

前端名称：购物、购物密度、购物/套  
后端字段：`shopping_count`、`shopping_per_house`

```text
shopping_count = count(category = 购物)

shopping_per_house =
  shopping_count / house_count
```

当 `house_count <= 0` 时，`shopping_per_house = 0`。

## 6. 交通

前端名称：交通、交通密度、交通/套  
后端字段：`traffic_count`、`traffic_per_house`

```text
traffic_count = count(category = 交通)

traffic_per_house =
  traffic_count / house_count
```

## 7. 医疗

前端名称：医疗、医疗密度、医疗/套  
后端字段：`healthcare_count`、`healthcare_per_house`

```text
healthcare_count = count(category = 医疗)

healthcare_per_house =
  healthcare_count / house_count
```

## 8. 休闲

前端名称：休闲、休闲/套  
后端字段：`recreation_count`、`recreation_per_house`

```text
recreation_count = count(category = 休闲娱乐)

recreation_per_house =
  recreation_count / house_count
```

## 9. 企业

前端名称：企业、企业/套  
后端字段：`company_count`、`company_per_house`

```text
company_count = count(category = 公司企业)

company_per_house =
  company_count / house_count
```

## 10. 住宅

前端名称：住宅  
后端字段：`residence_count`

含义：区域内住宅类 POI 数量。

```text
residence_count = count(category = 住宅)
```

## 11. 商圈活跃度指数

前端名称：商圈活跃度指数、商圈活跃度、活跃度  
后端字段：`business_activity`

含义：五类非住宅 POI 的加权规模指数，用来表示区域配套与商业活动强度。

```text
business_activity =
  0.35 * shopping_count
+ 0.25 * traffic_count
+ 0.15 * healthcare_count
+ 0.15 * recreation_count
+ 0.10 * company_count
```

该字段是原始指数，不是 `0-1` 分数。

## 12. 稳健评分

前端名称：稳健评分  
后端字段：`livability_score_v2`

含义：综合服务配套、区域活力和房价负担后的基础宜居评分。地图中可切换展示该指标。

```text
livability_score_v2 =
  0.72 * service_score
+ 0.20 * vitality_score
+ 0.08 * affordability_score
```

其中：

```text
service_score =
  0.25 * minmax(shopping_per_house)
+ 0.25 * minmax(traffic_per_house)
+ 0.20 * minmax(healthcare_per_house)
+ 0.15 * minmax(recreation_per_house)
+ 0.15 * minmax(poi_diversity)
```

```text
vitality_score =
  0.40 * minmax(company_per_house)
+ 0.30 * minmax(poi_total)
+ 0.30 * minmax(business_activity)
```

```text
affordability_score =
  1 - percentile_rank(log(avg_price))
```

## 13. 负担力 / 房价负担分

前端名称：负担力、房价负担分、成本友好  
后端字段：`affordability_score`

含义：房价越低，分数越高。

```text
cost_pressure = percentile_rank(log(avg_price))

affordability_score =
  1 - cost_pressure
```

## 14. 服务强度

前端名称：服务强度  
后端字段：`service_score`

含义：区域每套房源可对应的服务供给强度，以及服务类型均衡程度。

```text
service_score =
  0.25 * minmax(shopping_per_house)
+ 0.25 * minmax(traffic_per_house)
+ 0.20 * minmax(healthcare_per_house)
+ 0.15 * minmax(recreation_per_house)
+ 0.15 * minmax(poi_diversity)
```

`poi_diversity` 为五类服务 POI 的归一化香农熵：

```text
p_i = count_i / sum(count_i)

poi_diversity =
  - sum(p_i * log(p_i)) / log(5)
```

## 15. 区域活力

前端名称：区域活力  
后端字段：`vitality_score`

```text
vitality_score =
  0.40 * minmax(company_per_house)
+ 0.30 * minmax(poi_total)
+ 0.30 * minmax(business_activity)
```

## 16. 可达性分

前端名称：可达性分、可达性  
后端字段：`access_score`

含义：衡量房源到购物、交通、医疗、休闲、企业等服务的距离便利程度。

### 16.1 单套房源的五类可达性

```text
category_access =
  sum(exp(-distance_j / beta_m))
```

参数：

| 类别 | 半径 | beta |
|---|---:|---:|
| 购物 | 1000m | 500m |
| 交通 | 800m | 400m |
| 医疗 | 2000m | 1000m |
| 休闲娱乐 | 1500m | 750m |
| 公司企业 | 2000m | 1000m |

### 16.2 单套房源可达性分

```text
house_access_score =
  0.25 * minmax(shopping_access)
+ 0.25 * minmax(traffic_access)
+ 0.20 * minmax(healthcare_access)
+ 0.15 * minmax(recreation_access)
+ 0.10 * minmax(company_access)
+ 0.05 * minmax(poi_diversity_around_house)
```

### 16.3 区域可达性分

```text
access_score =
  mean(house_access_score)
```

## 17. 最近交通距离

前端名称：最近交通距离  
后端字段：`nearest_traffic_distance`

含义：房源到最近交通 POI 的距离，区域层面展示中位数；图表中用于“通勤距离-房价梯度”。

```text
house_nearest_traffic_distance =
  min(distance(house, traffic_poi_j))

nearest_traffic_distance =
  median(house_nearest_traffic_distance)
```

## 18. 设施供需充足度

前端名称：设施供需充足度、供需可达、供需可达性分  
后端字段：`e2sfca_access_score`

含义：使用 E2SFCA 方法，衡量设施是否既离得近，又不会被过多居住需求挤占。

### 18.1 设施供给比

```text
facility_supply_ratio_j =
  1 / sum(demand_weight_i * exp(-distance_ij / beta_m))
```

### 18.2 房源可获得的单类设施供给

```text
house_category_e2sfca_access =
  sum(facility_supply_ratio_j * exp(-distance_j / beta_m))
```

五类设施沿用“可达性分”的半径和 beta 参数。

### 18.3 房源设施供需充足度

```text
house_e2sfca_access_score =
  0.25 * minmax(shopping_e2sfca_access)
+ 0.25 * minmax(traffic_e2sfca_access)
+ 0.20 * minmax(healthcare_e2sfca_access)
+ 0.15 * minmax(recreation_e2sfca_access)
+ 0.15 * minmax(company_e2sfca_access)
```

### 18.4 区域设施供需充足度

区域先对五类房源 E2SFCA 可达性取均值，再重新归一化加权：

```text
e2sfca_access_score =
  0.25 * minmax(mean(shopping_e2sfca_access))
+ 0.25 * minmax(mean(traffic_e2sfca_access))
+ 0.20 * minmax(mean(healthcare_e2sfca_access))
+ 0.15 * minmax(mean(recreation_e2sfca_access))
+ 0.15 * minmax(mean(company_e2sfca_access))
```

## 19. 性价比分

前端名称：性价比分、性价比  
后端字段：`value_score`

含义：把服务可达性和价格友好度放在一起看。

```text
house_affordability_score =
  1 - percentile_rank(log(unit_price))
```

```text
house_value_score =
  0.80 * house_access_score
+ 0.20 * house_affordability_score
```

区域层面：

```text
value_score =
  mean(house_value_score)
```

## 20. 生活圈总分

前端名称：生活圈总分、生活圈  
后端字段：`life_circle_score`

含义：综合 5、10、15 分钟三个生活圈层级后的总分。

```text
life_circle_score =
  0.40 * life_circle_5min_score
+ 0.35 * life_circle_10min_score
+ 0.25 * life_circle_15min_score
```

区域层面：

```text
life_circle_score =
  mean(house_life_circle_score)
```

## 21. 5分钟基础生活

前端名称：5分钟基础生活  
后端字段：`life_circle_5min_score`

所需服务类型：

```text
convenience_store
supermarket
bus_stop
pharmacy
```

参数：

```text
radius_m = 320
beta_m = 160
coverage_weight = 0.45
access_weight = 0.35
diversity_weight = 0.20
```

公式：

```text
life_circle_5min_score =
  0.45 * life_circle_5min_coverage
+ 0.35 * minmax(life_circle_5min_access)
+ 0.20 * life_circle_5min_diversity
```

## 22. 10分钟日常生活

前端名称：10分钟日常生活  
后端字段：`life_circle_10min_score`

所需服务类型为 5 分钟基础生活 4 类，加上：

```text
market
metro_station
clinic
park_scenic
sports_fitness
food_social
cafe_tea
```

参数：

```text
radius_m = 640
beta_m = 320
coverage_weight = 0.40
access_weight = 0.40
diversity_weight = 0.20
```

公式：

```text
life_circle_10min_score =
  0.40 * life_circle_10min_coverage
+ 0.40 * minmax(life_circle_10min_access)
+ 0.20 * life_circle_10min_diversity
```

## 23. 15分钟城市资源

前端名称：15分钟城市资源  
后端字段：`life_circle_15min_score`

所需服务类型为 10 分钟日常生活 11 类，加上：

```text
shopping_mall
general_hospital
specialized_hospital
emergency
culture_venue
cinema_theater
business_park
office_company
rail_station
coach_station
```

参数：

```text
radius_m = 960
beta_m = 480
coverage_weight = 0.35
access_weight = 0.45
diversity_weight = 0.20
```

公式：

```text
life_circle_15min_score =
  0.35 * life_circle_15min_coverage
+ 0.45 * minmax(life_circle_15min_access)
+ 0.20 * life_circle_15min_diversity
```

## 24. 生活圈覆盖率

前端名称：5分钟生活圈、10分钟生活圈、15分钟生活圈、生活圈覆盖率  
后端字段：`life_circle_5min_coverage`、`life_circle_10min_coverage`、`life_circle_15min_coverage`

含义：对应生活圈所需服务类型中，有多少类能被覆盖。

```text
life_circle_Xmin_coverage =
  covered_subtype_count / required_subtype_count
```

其中：

```text
5分钟 required_subtype_count = 4
10分钟 required_subtype_count = 11
15分钟 required_subtype_count = 21
```

区域层面：

```text
life_circle_Xmin_coverage =
  mean(house_life_circle_Xmin_coverage)
```

## 25. 样本可靠性评分

前端名称：样本可靠性评分、样本可靠性、样本不足  
后端字段：`sample_reliability_score`

含义：样本房源越多，评分越可靠；样本不足时最终评分会被降权。

```text
threshold = max(reliability_house_threshold, 1)

sample_reliability_score =
  clip(house_count / threshold, 0, 1)
```

## 26. 校准评分

前端名称：校准评分、最终得分  
后端字段：`calibrated_score_life_circle`

含义：前端默认推荐和排序使用的最终综合评分，综合基础宜居、设施供需、生活圈、性价比，并乘以样本可靠性和生活圈强化系数。

```text
base_score =
  (
    0.30 * livability_score_v2
  + 0.30 * e2sfca_access_score
  + 0.30 * life_circle_score
  + 0.10 * value_score
  )
  * sample_reliability_score

calibrated_score_life_circle =
  base_score * (0.6 + 0.4 * life_circle_score)
```

## 27. 校准评分2.0

前端名称：校准评分2.0  
后端字段：`calibrated_score_life_circle_route`

含义：街道/镇面板中杨浦区可切换的真实步行网络版本。它不是 `metrics.py` 内的字段，而是由真实步行路线升级流程生成；前端展示时用它替换普通“校准评分”。

公式口径：

```text
calibrated_score_life_circle_route =
  base_score_route
* route_sample_reliability_score
* (0.6 + 0.4 * life_circle_score_route)
```

其中 `base_score_route` 与普通校准评分结构一致，但生活圈部分使用真实步行路网重算后的 `life_circle_score_route`。

## 28. 生活圈总分2.0

前端名称：生活圈总分2.0  
后端字段：`life_circle_score_route`

含义：真实步行路线时间重算后的生活圈总分。街道/镇面板会继续展开展示 5、10、15 分钟三个层级：

```text
life_circle_score_route =
  0.40 * life_circle_5min_score_route
+ 0.35 * life_circle_10min_score_route
+ 0.25 * life_circle_15min_score_route
```

## 29. 前端展示字段速查表

| 前端名称 | 后端字段 |
|---|---|
| 平均房价 / 房价 | `avg_price` |
| 平均总价 | `avg_total_price` |
| 房源数量 / 挂牌样本量 | `house_count` |
| POI总数 / POI / 设施总量 | `poi_total` |
| 购物 / 购物密度 | `shopping_count` |
| 交通 / 交通密度 | `traffic_count` |
| 医疗 / 医疗密度 | `healthcare_count` |
| 休闲 | `recreation_count` |
| 企业 | `company_count` |
| 住宅 | `residence_count` |
| 商圈活跃度指数 / 活跃度 | `business_activity` |
| 购物/套 | `shopping_per_house` |
| 交通/套 | `traffic_per_house` |
| 医疗/套 | `healthcare_per_house` |
| 休闲/套 | `recreation_per_house` |
| 企业/套 | `company_per_house` |
| 稳健评分 | `livability_score_v2` |
| 负担力 / 房价负担分 / 成本友好 | `affordability_score` |
| 服务强度 | `service_score` |
| 区域活力 | `vitality_score` |
| 可达性分 / 可达性 | `access_score` |
| 最近交通距离 | `nearest_traffic_distance` |
| 设施供需充足度 / 供需可达 | `e2sfca_access_score` |
| 性价比分 / 性价比 | `value_score` |
| 生活圈总分 / 生活圈 | `life_circle_score` |
| 5分钟基础生活 | `life_circle_5min_score` |
| 10分钟日常生活 | `life_circle_10min_score` |
| 15分钟城市资源 | `life_circle_15min_score` |
| 5分钟生活圈覆盖率 | `life_circle_5min_coverage` |
| 10分钟生活圈覆盖率 | `life_circle_10min_coverage` |
| 15分钟生活圈覆盖率 | `life_circle_15min_coverage` |
| 样本可靠性评分 | `sample_reliability_score` |
| 校准评分 / 最终得分 | `calibrated_score_life_circle` |
| 校准评分2.0 | `calibrated_score_life_circle_route` |
| 生活圈总分2.0 | `life_circle_score_route` |
