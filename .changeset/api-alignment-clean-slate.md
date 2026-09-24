---
"bmap-vue": major
---

公开 API 命名对齐官方风格（#135）：组件去掉 `B` 前缀（`BMap`→`Map`、`BMarker`→`Marker`、控件/图层同理），hooks 去掉 `BMap` 前缀（`useBMap*`→`useMap`/`useGeocoder` 等），`Vue3BaiduMapGlResolver` 重命名为 `BMapResolver`。不保留 deprecated 别名；新旧对照见官方对照表 `docs/zh-CN/contributing/official-api-alignment.md`。
