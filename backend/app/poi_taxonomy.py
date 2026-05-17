from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable

import pandas as pd


@dataclass(frozen=True)
class PoiClassification:
    poi_subtype: str
    service_role: str
    life_circle_tier: int | None
    is_life_service: int
    supply_weight: float
    exclude_reason: str | None = None


def _clean(value: object) -> str:
    return str(value or "").strip().lower()


def _contains_any(text: str, keywords: Iterable[str]) -> bool:
    return any(keyword.lower() in text for keyword in keywords)


def _result(
    poi_subtype: str,
    service_role: str,
    life_circle_tier: int | None,
    is_life_service: bool,
    supply_weight: float,
    exclude_reason: str | None = None,
) -> PoiClassification:
    return PoiClassification(
        poi_subtype=poi_subtype,
        service_role=service_role,
        life_circle_tier=life_circle_tier,
        is_life_service=1 if is_life_service else 0,
        supply_weight=float(supply_weight),
        exclude_reason=exclude_reason,
    )


def _excluded(poi_subtype: str, reason: str) -> PoiClassification:
    return _result(poi_subtype, "excluded", None, False, 0.0, reason)


def classify_poi(category: object, tag: object = "", name: object = "") -> PoiClassification:
    category_text = _clean(category)
    tag_text = _clean(tag)
    name_text = _clean(name)

    if category_text == "购物":
        return _classify_shopping(tag_text, name_text)
    if category_text == "交通":
        return _classify_traffic(tag_text, name_text)
    if category_text == "医疗":
        return _classify_healthcare(tag_text, name_text)
    if category_text == "休闲娱乐":
        return _classify_recreation(tag_text, name_text)
    if category_text == "公司企业":
        return _classify_company(tag_text, name_text)
    if category_text == "住宅":
        return _classify_residence(tag_text, name_text)
    return _excluded("unknown", "unknown_category")


def _classify_shopping(tag: str, name: str) -> PoiClassification:
    if "便利店" in tag or _contains_any(name, ("便利店", "罗森", "全家", "711", "7-eleven", "快客")):
        return _result("convenience_store", "basic_daily", 5, True, 1.0)
    if "超市" in tag or _contains_any(name, ("超市", "联华", "华联", "盒马", "大润发", "家乐福", "沃尔玛")):
        return _result("supermarket", "basic_daily", 5, True, 1.0)
    if "市场" in tag or _contains_any(name, ("菜场", "农贸", "生鲜", "菜市", "市场")):
        return _result("market", "daily_complete", 10, True, 1.0)
    if "购物中心" in tag or "百货商场" in tag or _contains_any(name, ("购物中心", "百货", "商场", "城市广场")):
        return _result("shopping_mall", "city_resource", 15, True, 1.0)
    if "商铺" in tag:
        return _result("general_shop", "basic_daily", 10, True, 0.35)
    if "家居建材" in tag:
        return _result("home_building", "city_resource", 15, True, 0.25)
    if "家电数码" in tag:
        return _result("electronics", "city_resource", 15, True, 0.25)
    if tag.startswith("购物"):
        return _result("other_shopping", "daily_complete", 10, True, 0.2)
    return _excluded("shopping_noise", "shopping_category_non_shopping_tag")


def _classify_traffic(tag: str, name: str) -> PoiClassification:
    if _contains_any(tag, ("停车场", "停车位")):
        return _excluded("parking", "not_walkable_life_service")
    if _contains_any(tag, ("加油加气站", "充电站")):
        return _excluded("fuel_charging", "not_walkable_life_service")
    if _contains_any(tag, ("道路", "路口", "桥", "收费站", "服务区")):
        return _excluded("road_facility", "road_facility_not_service")
    if tag == "公交车站" or "公交车站" in tag:
        return _result("bus_stop", "basic_daily", 5, True, 1.0)
    if "地铁站" in tag or "地铁站" in name:
        return _result("metro_station", "daily_complete", 10, True, 1.3)
    if "火车站" in tag:
        return _result("rail_station", "city_resource", 15, True, 1.0)
    if "长途汽车站" in tag:
        return _result("coach_station", "city_resource", 15, True, 0.8)
    if "飞机场" in tag:
        return _result("airport", "city_resource", 15, True, 0.6)
    if "港口" in tag:
        return _result("port", "city_resource", 15, True, 0.4)
    return _excluded("other_traffic", "traffic_tag_not_life_service")


def _classify_healthcare(tag: str, name: str) -> PoiClassification:
    if "药店" in tag or _contains_any(name, ("药房", "药店", "国药", "雷允上", "益丰", "老百姓")):
        return _result("pharmacy", "basic_daily", 5, True, 1.0)
    if "医疗器械" in tag or "器械" in name:
        return _excluded("medical_device", "medical_device_not_care_service")
    if "急救中心" in tag or "急救" in name:
        return _result("emergency", "city_resource", 15, True, 1.2)
    if "专科医院" in tag or _contains_any(name, ("口腔", "眼科", "妇幼", "精神卫生", "专科")):
        return _result("specialized_hospital", "city_resource", 15, True, 1.0)
    if "综合医院" in tag or ("医院" in name and not _contains_any(name, ("器械", "药房", "药店"))):
        return _result("general_hospital", "city_resource", 15, True, 1.3)
    if "诊所" in tag or _contains_any(name, ("诊所", "门诊", "卫生服务站", "社区卫生")):
        return _result("clinic", "daily_complete", 10, True, 1.0)
    if "体检机构" in tag:
        return _result("physical_exam", "daily_complete", 15, True, 0.5)
    if "疗养院" in tag:
        return _result("nursing_care", "daily_complete", 15, True, 0.4)
    if tag.startswith("医疗"):
        return _result("other_healthcare", "daily_complete", 10, True, 0.25)
    return _excluded("healthcare_noise", "healthcare_category_non_healthcare_tag")


def _classify_recreation(tag: str, name: str) -> PoiClassification:
    if _contains_any(tag, ("旅游景点;公园", "旅游景点;景点", "旅游景点;风景区")) or _contains_any(name, ("公园", "绿地", "滨江", "湿地")):
        return _result("park_scenic", "daily_complete", 10, True, 1.1)
    if "运动健身" in tag or _contains_any(name, ("健身", "体育", "球场")):
        return _result("sports_fitness", "daily_complete", 10, True, 0.9)
    if _contains_any(tag, ("展览馆", "文化宫", "美术馆", "博物馆", "新闻出版")) or _contains_any(name, ("文化馆", "美术馆", "博物馆", "图书馆")):
        return _result("culture_venue", "city_resource", 15, True, 1.0)
    if _contains_any(tag, ("电影院", "剧院")):
        return _result("cinema_theater", "city_resource", 15, True, 0.8)
    if _contains_any(tag, ("咖啡厅", "茶座")):
        return _result("cafe_tea", "daily_complete", 10, True, 0.5)
    if _contains_any(tag, ("酒吧", "ktv", "歌舞厅")):
        return _result("nightlife", "city_resource", 15, True, 0.35)
    if _contains_any(tag, ("网吧", "游戏场所")):
        return _result("internet_game", "city_resource", 15, True, 0.25)
    if "洗浴按摩" in tag:
        return _result("spa_massage", "city_resource", 15, True, 0.2)
    if _contains_any(tag, ("农家院", "度假村")):
        return _result("rural_resort", "city_resource", 15, True, 0.2)
    if tag.startswith("美食"):
        return _result("food_social", "daily_complete", 10, True, 0.5)
    if tag.startswith("休闲娱乐"):
        return _result("other_recreation", "daily_complete", 15, True, 0.2)
    return _excluded("recreation_noise", "recreation_category_non_recreation_tag")


def _classify_company(tag: str, name: str) -> PoiClassification:
    if "公司企业;园区" in tag or _contains_any(name, ("园区", "产业园", "科技园")):
        return _result("business_park", "employment", 15, True, 0.8)
    if "房地产;写字楼" in tag:
        return _result("office_building", "employment", 15, True, 0.6)
    if "公司企业;公司" in tag:
        return _result("office_company", "employment", 15, True, 0.6)
    if "公司企业;厂矿" in tag:
        return _result("factory", "employment", 15, True, 0.25)
    if "生活服务;物流公司" in tag:
        return _result("logistics", "employment", 15, True, 0.2)
    if "文化传媒" in tag:
        return _result("cultural_media_company", "employment", 15, True, 0.4)
    if "公司企业;农林园艺" in tag:
        return _result("agri_company", "employment", 15, True, 0.15)
    if tag.startswith("公司企业"):
        return _result("other_company", "employment", 15, True, 0.2)
    return _excluded("company_noise", "company_category_non_company_tag")


def _classify_residence(tag: str, name: str) -> PoiClassification:
    if "房地产;住宅区" in tag:
        return _result("residential_area", "demand_proxy", None, False, 0.0)
    if "房地产;内部楼栋" in tag:
        return _result("residential_building", "demand_proxy", None, False, 0.0)
    if "房地产;宿舍" in tag or "宿舍" in name:
        return _result("dormitory", "demand_proxy", None, False, 0.0)
    if tag.startswith("房地产"):
        return _result("other_residence", "demand_proxy", None, False, 0.0)
    return _result("other_residence", "demand_proxy", None, False, 0.0)


def add_poi_classification_columns(pois: pd.DataFrame) -> pd.DataFrame:
    if pois.empty:
        result = pois.copy()
        for column in (
            "poi_subtype",
            "service_role",
            "life_circle_tier",
            "is_life_service",
            "supply_weight",
            "exclude_reason",
        ):
            result[column] = None
        return result

    result = pois.copy()
    classifications = [
        asdict(classify_poi(row.category, row.tag, row.name))
        for row in result[["category", "tag", "name"]].itertuples(index=False)
    ]
    classified = pd.DataFrame(classifications, index=result.index)
    for column in classified.columns:
        result[column] = classified[column]
    result["is_life_service"] = result["is_life_service"].fillna(0).astype(int)
    result["supply_weight"] = pd.to_numeric(result["supply_weight"], errors="coerce").fillna(0.0)
    return result


def build_poi_subtype_audit(pois: pd.DataFrame) -> pd.DataFrame:
    columns = [
        "category",
        "tag",
        "poi_subtype",
        "service_role",
        "life_circle_tier",
        "is_life_service",
        "supply_weight",
        "count",
    ]
    if pois.empty:
        return pd.DataFrame(columns=columns)

    classified = pois
    required = {"poi_subtype", "service_role", "life_circle_tier", "is_life_service", "supply_weight"}
    if not required.issubset(classified.columns):
        classified = add_poi_classification_columns(pois)

    grouped = (
        classified.groupby(
            ["category", "tag", "poi_subtype", "service_role", "life_circle_tier", "is_life_service", "supply_weight"],
            dropna=False,
        )
        .size()
        .reset_index(name="count")
        .sort_values(["category", "count"], ascending=[True, False])
    )
    return grouped[columns]
