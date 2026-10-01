---
"@mangax/bmap-vue": patch
---

#165 Slice 2：地理编码两个 hook 的动作名与结果读取口对齐官方 `BMap.Geocoder`

官方 `Geocoder` 只有两个成员——`getPoint(address, cb, city?)`（地址 → 坐标点）与
`getLocation(point, cb, options?)`（坐标点 → 地址）。#165 的口径是「同一能力 ⇒ 同名」，
此前 composable 面上既改了动作名（`get`），又给**同一个 ref** 挂了四个名字
（`data` / `location` / `point` / `result`），其中 `location` 与官方 `getLocation` 的语义
**相反**（官方产出地址，我们装的是坐标点）——照 SDK 命名找成员会拿到语义相反的值。

**破坏性变更**（按 #165 §3.6「清除旧 API 包袱」，**不保留 deprecated 别名或兼容入口**）

| 位置 | 变更 | 说明 |
| --- | --- | --- |
| `useGeocoder().get` | → `useGeocoder().getPoint` | 与官方 `Geocoder#getPoint` 同名；参数与返回语义不变（`city` 仍可省略，`Promise<ServiceResult<GeoPoint>>`）。 |
| `useGeocoder().point` / `.location` / `.result` | **删除** | 三者原本与 `data` 是**同一个 ref**，没有可区分的行为。`location` 尤其危险：官方 `getLocation` 产出地址，这里却是坐标点。 |
| `useGeocodeDetail().get` | → `useGeocodeDetail().getLocation` | 与官方 `Geocoder#getLocation` 同名；参数与返回语义不变。 |
| `useGeocodeDetail().result` | **删除** | 与 `useGeocoder` 同口径收敛到 `data`。 |

**未变更**

- `getBatch` 两个 composable 都保留（官方是单次调用，没有批量入口；批量是本库的编排能力，
  逐项自带 `status` / `error` 的「部分成功」语义与 `runSequential` 底座绑定）。
- `useIpLocation` 未动（`location` / `data` / `result` 三个别名）——见下条待办。
- 逆地址解析**没有**搬进 `useGeocoder`：官方 `Geocoder` 的两个方法本就在同一实例上，
  本库按方向拆成两个 hook 共用 `service.geocoder` 能力与 `useSimpleServiceTask` 内核，
  合并会让一个 hook 持有两份方向不同的 `data` 语义。

**待办（下一票）**：`useIpLocation` 仍有 `location` / `data` / `result` 三个同义别名，
按同口径应收敛到 `data`。
