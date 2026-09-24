---
"bmap-vue": major
---

公开 API 命名对齐官方风格（#135）：组件去掉 `B` 前缀（`BMap`→`Map`、`BMarker`→`Marker`、控件/图层同理），hooks 去掉 `BMap` 前缀（`useBMap*`→`useMap`/`useGeocoder` 等）。不保留 deprecated 别名；旧名迁移见 `docs/zh-CN/migration/from-v2.md` 与官方对照表 `docs/zh-CN/contributing/official-api-alignment.md`。
