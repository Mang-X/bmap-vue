---
"baidu-map-gl-vue": minor
---

新增 `<BCustomOverlay>`、给 `<BContextMenu>` 补上声明式菜单项，并让「菜单挂到标注上」这条路径真的可用。

**`<BCustomOverlay>`（新组件）**：用 Vue 内容做地图上的 DOM 覆盖物。

- 组件创建一个 **detached `<div>`** 交给 SDK，用 `<Teleport>` 把 slot 渲染进它内部：
  SDK 搬运的始终是宿主元素，不会移动你写的节点；`$attrs` 落在宿主内部的一层包装节点上。
- 宿主**一个组件一份、跨重建复用**，因此任何一条重建路径（`anchor` / `offset` / `zIndex` 等构造期
  属性变化）都不会让 slot 子树被卸载重建。
- props：`position` / `offset` / `anchor` / `rotation` / `zIndex` / `minZoom` / `maxZoom` / `properties` /
  `visible` / `enableMassClear`；事件 `click` / `mouseover` / `mouseout`。
- `position` 变化走 `setPoint(point, true)`——**只位移**，不重新调用业务 DOM 工厂。

**`<BContextMenu>`**：两种写法，一份条目。

- 数据 API 的正典是 `items`（v3 的 `menuItems` **仍可用**，会在控制台提示一次；`items` 有值时旧名完全不参与）。
- 新增声明式 API `<BMenuItem>` / `<BMenuSeparator>`：与数据 API 归一化成同一份条目（顺序、`disabled`、
  `width` / `id`、`select` 载荷都不因写法而异），可混用（`items` 在前、children 在后）。
  顺序按**渲染顺序**（`v-if` 切换回来时回到模板里写的位置）。
- 新增 `select` 事件（**本库事件**，不是 SDK 事件）：载荷 `{ item, index, point, pixel, map, target }`，
  数据 API 的 `callback` 也收同一份载荷。
- `menuItems` 变化**原子重建**菜单；`open` / `close` 仍是纯观测（SDK 事件），不做受控。

**行为变更：菜单可以挂到标注上了。**

- 写在 `<BMarker>` 里的 `<BContextMenu>` 现在挂在**该标注**上（`Marker#addContextMenu`）；
  写在 `<BMap>` 下则挂到地图（`Map#addContextMenu`）。
- 此前这条路径在 v4 上被**静默拒绝**（菜单不生效也不报错），理由是「4.0 没有 Marker 级入口」——
  真实 AK 实测推翻了它：`Marker#addContextMenu` / `#removeContextMenu` 是 4.0 的运行时成员，
  只是官方 4.0.4 的类型包只在 `Map` 上声明它们。
- **其它目标**（普通覆盖物 / 旧层组件下的菜单）**显式报错**（`resource:error` 收到
  `BMAP_CAPABILITY_UNSUPPORTED`），不回退挂到地图上。
- `ContextMenuItem` 的 `callback` 参数从 `(...args: any[]) => void` 收紧为
  `(payload: ContextMenuSelectPayload) => void`；`ContextMenuItem` / `ContextMenuSeparator` 改从
  `baidu-map-gl-vue` 的类型入口导出（具名导入路径不变）。

**顺带修掉一处契约错误**：事件矩阵此前把 `custom-overlay` 与 `context-menu` 登记成「上游没有事件表」，
实际两张表都存在，只是在 `overlay/CustomOverlay.d.ts` 与 `context-menu/ContextMenu.d.ts` 里
（矩阵门禁当时只解析了一个文件）。现在矩阵覆盖这两类，门禁也改成多文件解析 + 声明文件归属核对。
