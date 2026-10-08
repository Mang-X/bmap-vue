---
"@mangax/bmap-vue": patch
---

`useAreaBoundary` 补上官方 `Boundary#parsebdStr`（#165 审计项）。

`Boundary` 有两个动作成员，此前只暴露了 `get`：

- `get(area)`（官方 `Boundary#get`）：按行政区名联网查询；
- **`parsebdStr(str)`（官方 `Boundary#parsebdStr`）**：解析手上已有的混淆坐标串，**不发网络请求**。

两者回包同形（`BoundaryResult`），因此结果落在同一份 `data` / `boundaries`；Driver 侧新增
`parseBoundaryString()`，与 `queryBoundary()` 共用同一投影（`raw` 点串 + `rings` 坐标环）。

顺带纠正 `useAreaBoundary` 页面此前的判断：它写「点串是查询的输入」所以不暴露解析入口，但前提
不成立 —— `get()` 的输入是**行政区名**，点串是它的**回包**；从别处拿到的点串同样需要本地解析
入口。该说明已改写为「两个成员都有出口」。
