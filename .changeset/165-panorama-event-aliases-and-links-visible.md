---
"@mangax/bmap-vue": patch
---

#165 TASK 6 / 7：`<Panorama>` 事件名的 SDK 拼写别名 + `linksVisibleChanged`

## TASK 6 —— 官方事件名的两种拼写都能绑

事件名是公共契约，而用户拿到名字的来源有**两份且拼写不同**：

| 来源 | 拼写 |
| --- | --- |
| JSAPI 声明 `panorama/PanoramaEvent.d.ts` 的 `PanoramaEventMap` 键 | snake_case（`link_click`） |
| 官方 React 参考 `src/components/Panorama/index.tsx` 的 `on*` props | camelCase（`onLinkClick`） |

`<Map>` 早已为同一件事留了机制（`MAP_EVENT_EMIT_ALIASES`），这里沿用同一口径：
**规范名（camelCase）与 SDK 拼写（snake_case）都会派发**，载荷完全相同。

```ts
// 完全等价
<Panorama @link-click="onLink" @link_click="onLink" />
```

一次性对应（`core/panorama/panoramaEventCatalog.ts` 是单一事实源）：

`positionChange`/`povChange`/`zoomChange`/`idChange`/`sceneTypeChange`/`linksChange`/
`linksVisibleChanged`/`linkClick`/`povChangedEnd`/`sceneChangeEnd`/`sizeChanged`/
`overlayAdd`/`overlayRemove`/`overlaysClear`/`visiblePoiTypeChanged`
↔ 各自的 `snake_case` 形态（15 对）。

**不做 1:1 的三类，理由逐条写在那份源码上：**

- **改名不是拼写差异**：`dataload → load`、`pano_error → error`。对外名与官方名不是同一个
  名字的两种写法，一并发出会多出一条官方从未承诺的事件路径（`pano_error` 还会与本库通用的
  `error` 失败出口撞名）。这两个官方键**不能绑**。
- **官方名本来就没有分隔符**：`click` / `dblclick` / `touchstart` / `touchend` /
  `clickonroad` —— camelCase 与 snake_case 对它们是同一个字符串，不需要别名
  （加了反而会把同一个监听回调调两遍）。
- **不构成名字差异的**：`visible` 是 **prop** 而不是事件；官方 React 参考的 `onPovChange()`
  不带值而本库 `povChange` 回读 `getPov()` 补值 —— 那是**载荷口径**的差异。

### 为什么不复用 `MAP_EVENT_EMIT_ALIASES` 本身

形状相同，但那张表的**内容**由 `MAP_EVENT_CATALOG` 派生，而 map 的名字规则是
`vue = sdk.replace(/_/g, "-")`（**kebab**）。`<Panorama>` 的对外名是 camelCase 且已发布，
因此复用要付三笔账：① 在 map 事件的单一事实源里塞进一批不符合 kebab 规则的条目；
② 借用 `MapEventEmits`（载荷是 `MapEventPayload` / `MapPointerEvent`，与全景的
`Point | null` / `PanoramaLink[]` 完全不同，混进一个接口后 `EmitPayloadMismatches`
那条类型门禁失去意义）；③ 想让组件用上那张表就得走 `useOverlaySpec` / `OverlayKind`，
而全景**不是覆盖物**（它在独立容器上），加进去会破坏「kind 集封闭」与「矩阵驱动的绑定」
两条前提。

因此本票是**等价物**：一张只装全景的表，**组件里没有第二份兼容代码**（同 #28 对 map 的
要求）。`tests/behavior/panorama-event-aliases.test.ts` 有反证用例钉住第 ③ 条。

## TASK 7 —— 新增 `linksVisibleChanged`

官方 `links_visible_changed: { value: boolean }`（道路链接显隐状态变化后触发）是
`getLinks()` / `linksChange` 那一族的第三条，此前缺失。载荷投影成**裸 `boolean`**
（官方包装对象是 SDK 的形状，不是本库的领域形状，与 `visiblePoiTypeChanged` 同一手法）。

**更正 #168 的一条裁决**：`links_visible_changed` 此前判为「不加」，理由是「由官方自带
控件的显隐驱动，本库无读回入口」。**该理由不成立**——「没有读回入口」与「该不该暴露」
无关：官方载荷 `{ value: boolean }` 是**声明过且自足**的（不需要回读任何 getter），
这与同族另外两条「不带值、要组件回读」的判据完全相反。原判把「本库不镜像那个控件」
当成了「它没有可消费的内容」，那是两件事。

### ⚠️ 与 `linksChange` 是两件事

| 对外事件 | 官方事件名 | 说的是 | 载荷 |
| --- | --- | --- | --- |
| `linksChange` | `links_changed` | **链接列表**变了 | `PanoramaLink[]` |
| `linksVisibleChanged` | `links_visible_changed` | 链接**显不亮**变了 | `boolean` |

上游没给 `value` / 给了非 boolean 时归成 `false`：载荷类型是 `boolean`（非可空），
塞 `undefined` 会让类型对调用方说谎；官方没有读回入口，「没给」与「false」只能落成
同一个答案（同 `getLinks()` 的空数组取舍）。

## 测试基建

Fake v4 全景补 `setLinksVisible()` 驱动路径（值不变时**不**派发，与官方「状态变化后触发」
一致），并闭合它自己登记的一处建模缺口：`setId()` 原用 `as unknown as Record` 把裸字符串
硬塞进对象载荷的 `emit()`，现改为派发空事件对象 + 把真实值留在 `this.id` 上——任何人若
改成读事件载荷会立刻暴露（读到 `undefined`），而硬塞一个形状不对的载荷会让「读错了但看起来
对」成为可能。

## 验证

新增 `tests/behavior/panorama-event-aliases.test.ts`（27 例，含 15 对别名的双发、载荷一致性、
`linksVisibleChanged` 的投影与「值不变不派发」、别名订阅卸载后归零、别名必须由官方
`.d.ts` 声明的反证）与 `tests/type-contracts/panorama-event-aliases.type-test.ts`
（钉住**声明面**——别名只写运行时表、漏写 `defineEmits` 会让 `emit()` 静默失灵，
而类型检查仍会绿灯）。
