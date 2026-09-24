---
"bmap-vue": minor
---

新增 `BMVTLayer`（MVT 矢量瓦片，issue #109）：官方 `BMap.MVTLayer` 的 Vue 封装——直接
`map.addLayer` 挂载、`[z]/[x]/[y]` 占位符、源图层名过滤与样式、事件拾取，以及要素状态命令面
（`featureState` / `mvtFeatureStateKey`，键域 string-only、键形 `layerName_id`）。能力面
`layer.mvt` 按 #104 审计时的无消费者删除**重新加入**（本票是它的消费者）。
