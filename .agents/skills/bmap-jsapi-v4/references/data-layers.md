# GeoJSON 与 DOM 图层

## 何时读取

需要混合 GeoJSON、把 GeoJSON 转成普通覆盖物、批量 DOM 或底图文字标签时读取。大量同类点线面见 [批量可视化图层](visualization-layers.md)，矢量瓦片见 [MVT 图层](mvt-layer.md)，行政区边界与填色见 [行政区边界与区域填色](administrative-district.md)，低频能力见 [扩展 API](runtime-extended-apis.md)。

## 本页导航

[快速选择](#快速选择) · [最小示例](#最小可运行示例) · [核心 API](#核心-api) · [资源清理](#资源清理) · [常见错误](#常见错误)

## 快速选择

| 需求 | 选择 |
|---|---|
| 混合 Point/LineString/Polygon 的 GeoJSON | `BMap.GeoJSONLayer` |
| GeoJSON 转普通 Marker/Polyline/Polygon | `BMap.GeoJSONParse`，业务持有结果并逐个移除 |
| 一组业务 DOM | `BMap.DOMLayer`，只建议与 Map 同生命周期 |
| 行政区 | 进入 [行政区边界与区域填色](administrative-district.md) |
| 大批量同类点线面 | 四种具体批量图层，进入可视化专页 |
| 底图文字标签 | `map.addMapLabels/removeMapLabels`，持有返回 uid |

JSAPI 4.0 提供可继承的 `BMap.NormalLayer` 图层基类，但不提供 `BMap.FeatureLayer`。常规业务优先直接使用 PointIconLayer、PointShapeLayer、LineLayer、FillLayer；只有实现自定义普通图层时才继承 NormalLayer。

## 最小可运行示例

```javascript
const map = new BMap.Map('map');
const center = new BMap.Point(116.404, 39.915);
map.centerAndZoom(center, 13);

const geoJSONLayer = new BMap.GeoJSONLayer('business-data', {
  reference: 'BD09LL',
  minZoom: 5,
  maxZoom: 19,
  level: -50,
  markerStyle: (properties) => ({ title: String(properties.name || '') }),
  polylineStyle: { strokeColor: '#1677ff', strokeWeight: 4 },
  polygonStyle: { strokeColor: '#13a8a8', fillColor: '#13a8a8', fillOpacity: 0.25 },
});

const onFeatureClick = (event) => {
  const picked = geoJSONLayer.pickOverlays(event);
  console.log(event.latLng, event.features, picked);
};
geoJSONLayer.addEventListener('click', onFeatureClick);
map.addLayer(geoJSONLayer);

geoJSONLayer.setData({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [116.404, 39.915] },
      properties: { id: 'poi-1', name: '示例点' },
    },
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[116.395, 39.910], [116.415, 39.920]],
      },
      properties: { id: 'line-1' },
    },
  ],
});

console.log(geoJSONLayer.getData());
geoJSONLayer.setLevel(-40);
console.log(geoJSONLayer.getLevel());
geoJSONLayer.setVisible(false);
console.log(geoJSONLayer.getVisible());
geoJSONLayer.setVisible(true);
geoJSONLayer.resetStyle();

function dispose() {
  geoJSONLayer.removeEventListener('click', onFeatureClick);
  geoJSONLayer.clearData();
  map.removeLayer(geoJSONLayer);
  geoJSONLayer.destroy();
  map.destroy();
}
```

`getData()` 返回解析生成的普通 Overlay 数组，不是原始 GeoJSON。`clearData()` 先从 Map 移除这些覆盖物并清空集合；组件退出时先清数据，再走统一 `removeLayer`，最后释放自己拥有的 Map。

## 核心 API

### GeoJSONLayer

常用 options 是 `dataSource`、`reference`、`markerStyle`、`polylineStyle`、`polygonStyle`、`minZoom`、`maxZoom`、`level` 和 `visible`。样式可直接传 options，也可按 feature properties 返回 options。

常用方法：

- 数据：`setData/getData/clearData`。
- 样式与命中：`resetStyle/pickOverlays`。
- 层级：`setLevel/getLevel`；层级值原样透传给每个解析出的覆盖物的 `setZIndex`，未设置时默认 `-99`。
- 显隐：`setVisible/getVisible`。
- 生命周期：`destroy` 与 Map 的 `addLayer/removeLayer`。

`map.removeLayer(geoJSONLayer)` 已经摘掉覆盖物、解绑监听并清空图层持有的 Map 引用，之后再调用 `destroy()` 不起作用。要真正清空 `getData()` 集合，得在 `removeLayer` 之前调用 `clearData()`，或者先 `destroy()` 再 `removeLayer()`。

> **⚠️ 运行时实测更正（4.0 / `BMap.version === "gl"`，2026-09-17 取证，issue #98）**
>
> 上面那半句「**得在 `removeLayer` 之前**调用 `clearData()`」与运行时不符。实测（`scripts/probe-layer-detached.mts`）：
>
> | 时刻 | `getData()` 长度 |
> | --- | --- |
> | `addLayer` + `setData` 之后 | 2 |
> | `map.removeLayer(layer)` 之后 | **2**（集合**没有**被清） |
> | 此时再调 `layer.clearData()` 之后 | **0**（**清空了**，且未抛错） |
>
> 结论：`clearData()` 在 `removeLayer` **之后**调用**仍然有效**，因此它**不是** `removeLayer` 之前
> 才能用的入口。仍然成立的那半句是：`removeLayer` 自己已经把覆盖物摘掉、并清空了图层的 Map 引用。

GeoJSONLayer 的 click 事件对象赋值 `latLng`、`pixel` 和 `features`，没有 `point`。业务代码读取 `event.latLng`。

### GeoJSONParse

`BMap.GeoJSONParse` 明确分派 Point、LineString、Polygon、MultiPoint、MultiLineString、MultiPolygon，并构造 Marker、Polyline、Polygon 等普通覆盖物。业务必须持有返回数组并逐个 `map.removeOverlay`。

`reference` 转换与覆盖物构造链存在二次坐标转换冲突；GeometryCollection 不受 `readGeometry` 支持。使用 GeoJSONParse 时优先在全局 BD09 下处理受支持的几何类型。

```javascript
if (map.getCoordType() !== BMAP_COORD_BD09) {
  throw new Error('GeoJSONParse 示例要求全局坐标类型为 BD09');
}

const parser = new BMap.GeoJSONParse({ reference: 'WGS84' });
const parsedOverlays = parser.readFeaturesFromObject({
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [116.404, 39.915] },
    properties: { name: '示例点' },
  }],
});
for (const overlay of parsedOverlays) map.addOverlay(overlay);

function removeParsedData() {
  for (const overlay of parsedOverlays) map.removeOverlay(overlay);
  parsedOverlays.length = 0;
}
```

### Map Labels

`map.addMapLabels(labels)` 返回实际 uid；精确移除时把保存的 uid 原样传给 `removeMapLabels`。`clearLabels()` 会清空当前 Map 的全部自定义底图标签，不适合共享 Map 的模块所有权管理。

```javascript
const mapLabelUids = map.addMapLabels([{
  text: '业务标签',
  position: new BMap.Point(116.404, 39.915),
}]);

function removeBusinessLabels() {
  map.removeMapLabels(mapLabelUids);
}
```

### DOMLayer

DOMLayer 发布 `setData`、`show/hide`、`getCustomOverlays`、`removeOverlay`、`removeAllOverlays`、`setStyleOptions` 和 `addEventListener`。但它没有对应的 `removeEventListener`，注册的业务事件解绑不掉，因此只建议用在与整张 Map 同生命周期的页面壳层，不要在短生命周期路由组件里给它注册事件。

```javascript
const domLayer = new BMap.DOMLayer(
  (properties) => {
    const element = document.createElement('div');
    element.textContent = String(properties.name || '业务点');
    element.style.cssText = 'padding:4px 8px;background:#fff;border-radius:4px;';
    return element;
  },
  { minZoom: 8, maxZoom: 18, anchors: [0.5, 1] },
);
domLayer.setData({
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [116.404, 39.915] },
    properties: { name: '门店 A' },
  }],
});
map.addLayer(domLayer);

domLayer.hide();
domLayer.show();
domLayer.setStyleOptions({ minZoom: 9, maxZoom: 17 });
const currentDOMOverlays = domLayer.getCustomOverlays();
if (currentDOMOverlays[0]) domLayer.removeOverlay(currentDOMOverlays[0]);

function removeDOMLayerWithMap() {
  domLayer.removeAllOverlays();
  map.removeLayer(domLayer);
}
```

`setData(null)` 只清空数据引用，不会移除已经渲染出来的 overlays；清空时必须显式调用 `removeAllOverlays()`。

## 事件或回调

- GeoJSONLayer：`click`、`mousemove`、`mouseout`，使用具名 handler 成对解绑。
- DOMLayer：同样发布 click/mouseover/mouseout，但没有公开 removeEventListener，短生命周期模块不注册。

## 资源清理

1. GeoJSONLayer：解绑事件 → `clearData()` → `map.removeLayer()` → `destroy()`。
2. GeoJSONParse：持有返回覆盖物，逐个 `map.removeOverlay()`。
3. Map labels：持有 add 返回的 uid，用 `removeMapLabels(uidList)`。
4. DOMLayer：先 `removeAllOverlays()` 再 `removeLayer()`；由于事件无法解绑，让它与最终销毁的 Map 同生命周期。
5. 只有组件拥有 Map 时才调用 `map.destroy()`。

### 实测补充（4.0 / 2026-09-17，issue #98）

- **两个清空入口都不要求图层仍在图上**：`GeoJSONLayer.clearData()` 与 `DOMLayer.removeAllOverlays()`
  在 `map.removeLayer()` **之后**调用都不抛错；前者仍能把 `getData()` 集合清空。
  因此上面的顺序是**推荐顺序**（先在图上清、再摘），不是「摘掉之后就来不及」的硬约束。
- **`DOMLayer` 渲染出来的 DOM 节点由 `removeLayer` 自己摘掉**：实测 `map.removeLayer(domLayer)`
  之后 `isConnected` 由 2 变 0、`getCustomOverlays()` 也归零。所以「只调 `setData(null)` 会残留」
  说的是 `setData(null)`；`removeLayer` 不会残留节点。
- **被 `removeLayer` 摘掉的实例不可复用（实测，2026-09-17 / issue #98）**：严格按内核的
  `addLayer → setData` 顺序把**同一个** `DOMLayer` 再挂一次，节点仍是 **0** —— 内容不会自己回来；
  再补一次 `setData` 不但无效，**调用本身还会抛错**
  （`Cannot read properties of null (reading 'coordinate')`）。对照「换一个**新**实例」= 2 个节点、
  正常渲染。也就是说 `removeLayer` 清空了图层持有的 Map 引用，该实例再也渲染不了。
  ⇒ **「隐藏之后重新显示」必须换新实例**，不能把旧实例挂回去（本库内核据此改成重建，
  见 ADR `2026-09-17-layer-spec-and-registry` 决策 8）。
  ⚠️ 本条曾在本文件里写成「重新 `addLayer` 会按保留的数据重新渲染」——那是**未取证的推断**，
  已被上面的读数推翻（保留记录是为了不再让后续读者依赖它）。
- **`GeoJSONLayer` 的 `getData()` 集合在同样路径下还在（2 条），但「集合在」≠「覆盖物回到图上」**：
  覆盖物是否真的渲染回图上**没有公开手段可观测**（`Map` 上没有列出覆盖物的方法），因此那
  **不构成**「GeoJSON 可以复用实例」的证据。
- **对已经摘掉的图层再调一次 `map.removeLayer()` 是安全的**：GeoJSONLayer / DOMLayer / TileLayer
  三个家族实测均未抛错（这是本库三态挂载收敛的前提，见 ADR `2026-09-17-layer-spec-and-registry`
  决策 12b）。

## 常见错误

- 把 GeoJSONLayer `getData()` 当作原始 GeoJSON；它返回 Overlay 数组。
- 把 GeometryCollection 直接交给 GeoJSONParse 正式流程。
- 丢弃 GeoJSONParse 返回数组，导致无法精确移除覆盖物。
- 用 `clearLabels()` 清理某个模块，误删其他模块标签。
- 对 DOMLayer 只调用 `setData(null)`，旧 DOM 覆盖物仍在。
- 在短生命周期组件注册 DOMLayer 事件。
- 读取 GeoJSONLayer click 的 `event.point`，它不会被赋值。
