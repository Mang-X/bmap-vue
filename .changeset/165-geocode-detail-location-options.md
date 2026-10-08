---
"@mangax/bmap-vue": patch
---

`useGeocodeDetail` 补上官方 `Geocoder#getLocation` 的可选参数 `LocationOptions`（#165 审计项）。

`getLocation(point, options?)` 与 `getBatch(points, options?)` 现在接受并透传：

- `poiRadius`：附近 POI 的最大半径（米，官方默认 100）；
- `numPois`：返回的 POI 个数（官方默认 10）。

Driver 的 `reverseGeocode` **一直支持**这两个字段（负责透传给 SDK），此前只是这个 composable
没有把入口暴露出来 —— 属于 #165 审计记录的「分类层知道有这个能力，composable 面没有出口」。
逐字段透传而不是展开 `...options`：调用方多传的未知键不会顺手塞给 SDK。
