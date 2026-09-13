# 官方 UI Kit（`./ui-kit`）

`baidu-map-gl-vue/ui-kit` 是**独立按需子入口**：四个标准 UI（输入建议下拉、结果列表、
详情面板、路线面板）全部由官方
[`@baidumap/jsapi-ui-kit`](https://www.npmjs.com/package/@baidumap/jsapi-ui-kit) 渲染，
本库只负责 host 容器、生命周期、props → 已验证 setter / 构造选项、事件数据与公开动作。

| 上游 widget | 本库组件 | 一句话 |
| --- | --- | --- |
| `PlaceAutocomplete` | `BPlaceAutocomplete` | 输入建议下拉 + 键盘导航 |
| `PlaceSearch` | `BPlaceSearch` | 结果列表 + 检索 / 翻页 API |
| `PlaceDetail` | `BPlaceDetail` | 地点详情面板（uid 模式 / POI 模式） |
| `RoutePlan` | `BRoutePlan` | 路线面板（锁定版本只开放驾车） |

> 决策与依据见 ADR [Official-first](/adr/2026-09-13-official-first-loader-and-ui-kit)
> 与 ADR [UI Kit 子路径与类型边界](/adr/2026-09-13-ui-kit-subpath-and-type-boundary)；
> 详情 / 路线这两个封装的判断（含「上游声明了但没实现」的处置）见
> ADR [详情与路线封装](/adr/2026-09-13-ui-kit-detail-route-wrappers)；
> 上游逐项行为以[官方包发布契约](/zh-CN/contributing/official-packages)为准。

## 为什么是独立入口

`@baidumap/jsapi-ui-kit` 是**可选依赖**，而且它在**模块求值期**就会访问 `document`
（Node 侧 `import` 直接崩）。因此：

- 根入口 `baidu-map-gl-vue` **不导出**这四个组件，产物里也不含 UI Kit 的代码与样式；
  它的整条 ESM 闭包由 `tests/behavior/v3-ui-kit-entry.test.ts` 遍历断言；
- 组件只在浏览器挂载后**动态 import** 上游包，所以 `./ui-kit` 本身在 SSR / 离线环境
  可以安全 `import`（不会触碰 DOM），但渲染 UI 组件没有意义 —— 服务端渲染时请不要渲染它们。

### 不受 `.vue` 自动导入（resolver）覆盖

这四个组件**不在**组件 manifest 里，因此 `Vue3BaiduMapGlResolver` /
`unplugin-vue-components` 的自动导入**不会**解析它们：必须显式写
`import { BPlaceSearch } from "baidu-map-gl-vue/ui-kit"`。

这是刻意的：manifest 生成的 `components/index.ts` 会被**根入口**引用，把 UI Kit 放进去就等于
把可选依赖与 DOM 副作用拖进所有消费者的产物图（见 ADR
[UI Kit 子路径与类型边界](/adr/2026-09-13-ui-kit-subpath-and-type-boundary) 决策 1）。

## 安装

```bash
pnpm add baidu-map-gl-vue vue
# 只有用到 ./ui-kit 时才需要（版本由本库精确锁定为 optional peer）
pnpm add @baidumap/jsapi-ui-kit@1.1.2
```

## 样式必须显式引入

官方包**不在 JS 里注入样式**，不引入不会报错，只会「没有样式」：

```ts
import { BPlaceSearch } from "baidu-map-gl-vue/ui-kit"; // ❌ 这不会引入任何样式
```

正确写法：

```ts
import "@baidumap/jsapi-ui-kit/dist/css/jsapi-ui-kit.css";
```

`UI_KIT_STYLE_PATH` 导出的就是这个路径，可用于避免手写错：

```ts
import { UI_KIT_STYLE_PATH } from "baidu-map-gl-vue/ui-kit";
console.log(UI_KIT_STYLE_PATH); // "@baidumap/jsapi-ui-kit/dist/css/jsapi-ui-kit.css"
```

## 快速开始

```vue
<script setup lang="ts">
import { ref } from "vue";
import { BMap } from "baidu-map-gl-vue";
import {
  BPlaceAutocomplete,
  BPlaceDetail,
  BPlaceSearch,
  BRoutePlan,
} from "baidu-map-gl-vue/ui-kit";
import "@baidumap/jsapi-ui-kit/dist/css/jsapi-ui-kit.css";
import type { PlacePoiDTO, PlaceSuggestionDTO } from "baidu-map-gl-vue/ui-kit";

const autocomplete = ref<InstanceType<typeof BPlaceAutocomplete> | null>(null);
const search = ref<InstanceType<typeof BPlaceSearch> | null>(null);
const routePlan = ref<InstanceType<typeof BRoutePlan> | null>(null);
const detailUid = ref<string>();

function onSelect(poi: PlacePoiDTO) {
  console.log(poi.title, poi.point); // point 是纯数据 { lng, lat }
  detailUid.value = poi.uid; // 「检索 → 看详情」：把 uid 交给详情面板
}
function onSuggest(items: PlaceSuggestionDTO[]) {
  console.log(items.map((item) => item.name));
}
</script>

<template>
  <BMap :ak="ak">
    <!-- host 只是一个容器：给它尺寸即可 -->
    <div style="width: 360px; height: 320px">
      <BPlaceAutocomplete ref="autocomplete" location="北京" @suggest="onSuggest" />
    </div>
    <div style="width: 360px; height: 420px">
      <BPlaceSearch ref="search" @select="onSelect" />
    </div>
    <div style="width: 360px; height: 420px">
      <BPlaceDetail :uid="detailUid" />
    </div>
    <div style="width: 360px; height: 420px">
      <BRoutePlan ref="routePlan" />
    </div>
  </BMap>
</template>
```

四个组件都必须是 `<BMap>` 的后代：上游四个 widget 在构造期强制要求 `options.map`，
本库会等地图就绪后再构造，并且**跟随地图实例换代自动重建**。

## `BPlaceAutocomplete`

### Props

| Prop | 类型 | 说明 | 变更时 |
| --- | --- | --- | --- |
| `placeholder` | `string` | 输入框提示，上游默认 `搜索地点` | 🔁 重建 |
| `debounce` | `number` | 输入防抖毫秒，上游默认 `300` | 🔁 重建 |
| `minLength` | `number` | 触发检索的最小字符数，上游默认 `1` | 🔁 重建 |
| `showSuggestion` | `boolean` | 是否展示建议下拉，上游默认 `true` | 🔁 重建 |
| `suggestionCount` | `number` | 建议条数上限（移动端默认 6） | 🔁 重建 |
| `display` | `PlaceAutocompleteDisplayDTO` | 下拉字段显隐 | 🔁 重建 |
| `location` | `string` | 检索城市限定，如 `北京` | ✅ `setLocation()`；改回未设置 → 🔁 重建 |
| `citylimit` | `boolean` | 是否严格限定在城市内 | ✅ `setCitylimit()` |
| `types` | `'all' \| 'city'` | 结果类型过滤 | ✅ `setTypes()`；改回未设置 → 恢复默认 `all` |

- **有 setter 的三项**走 `setLocation()` / `setCitylimit()` / `setTypes()` 镜像，不销毁 widget；
- **构造期选项**上游没有对应 setter，变更即**重建 widget**（不会静默保留旧值）。重建按「内容的稳定串」
  比对，因此每次渲染传新的对象字面量、内容相同不会引发重建。口径与官方
  [react-bmap](https://github.com/huiyan-fe/react-bmap) 的 `ctorKey` 一致；
- `location` 由「有值」变回「未设置」时**重建**：上游没有公开、也没有被验证过的「清除城市限定」
  入口（`setLocation("")` 的语义未知），本库不去猜隐藏语义。

布尔 props 都在本库侧给了与上游一致的显式默认值 —— Vue 对 `Boolean` 类型有「缺省即 `false`」的转换，
不给默认值会把上游默认的 `true` 静默改掉。

### 事件

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `suggest` | `PlaceSuggestionDTO[]` | 建议列表更新 |
| `select` | `PlaceSuggestionDTO` | 用户选中某条建议 |
| `highlight` | `PlaceHighlightChangeDTO` | 高亮项变化：`{ from, to }` 变更对；`from` 在首次高亮时为 `null` |

`highlight` 保留上游的**变更对**语义（高亮从 `from` 移到 `to`），不压平成单条 —— 「从哪来」不是本库
能替调用方决定的信息。载荷形状由 `tests/behavior/v3-ui-kit-widget-contract.test.ts` 对着发布产物锁定
（上一版曾把它错当成 `{ index, value }`，导致事件在真实运行时被静默丢弃）。

载荷是**纯数据**：坐标统一为 `{ lng, lat }`，上游标注 `@deprecated` 的字段（如 `street`）不转发。

### 公开动作（`ref`）

```ts
const api = autocomplete.value!;
await api.search("百度大厦");        // 程序化检索
await api.setInputValue("已写入");   // 只写值，不触发检索
await api.getInputValue();           // 读输入框当前值
await api.setLocation("上海");
await api.setCitylimit(true);
await api.setTypes("city");
await api.show();                    // 展开 / 收起建议列表
await api.hide();
```

动作都是 `async`：构造是异步的（延迟 import + 等地图就绪），所以动作会**等待就绪**后执行；
组件已卸载则明确拒绝（错误码 `BMAP_RESOURCE_DISPOSED`），而不是静默什么都不做。

### 没有 `v-model:query`

上游 `1.1.2` 没有公开的「输入变化」事件契约（`on()` 只接受 `suggest` / `select` / `highlight`），
所以本库**不提供** `v-model:query`，也**不会**去 `querySelector` 上游内部的输入框 ——
那是对上游内部 DOM 的隐式依赖。需要读当前值请调用 `getInputValue()`。

## `BPlaceSearch`

### Props

| Prop | 类型 | 说明 | 变更时 |
| --- | --- | --- | --- |
| `pageCapacity` | `number` | 每页条数，上游默认 `10` | 🔁 重建 |
| `pageNum` | `number` | 请求页码 | 🔁 重建 |
| `display` | `PlaceSearchDisplayDTO` | 列表字段显隐（图片/电话/评分/人均…） | 🔁 重建 |

这三项都是构造期选项（上游没有 setter），变更即重建 widget。

### 事件

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `load` | `PlacePoiDTO[]` | 一轮检索的完整结果 |
| `select` | `PlacePoiDTO` | 用户点选某条结果 |

### 公开动作（`ref`）

```ts
await api.search("百度大厦", { city: "北京" });
await api.searchNearby("咖啡", { lng: 116.4, lat: 39.9 }, 1500);
await api.searchInBounds("学校", { sw: { lng: 116.2, lat: 39.8 }, ne: { lng: 116.5, lat: 40.1 } });
await api.prevPage();
await api.nextPage();
await api.goToPage(3);
```

周边 / 范围检索的坐标由本库经 Driver 转成引擎原生点后再交给上游
（上游把它们直接塞进请求，裸 `{ lng, lat }` 会被 SDK 的 `instanceof` 校验挡掉）。

**翻页是能力而不是内置 UI**：上游 `1.1.2` 只提供 `prevPage` / `nextPage` / `goToPage` 三个 API，
**没有**会自动出现翻页按钮的控件 —— 需要翻页按钮请自行渲染并调用上面这几个动作。
结果列表本身（条目、字段显隐、点击）由上游渲染。

### 不会重复发请求

本组件**不**调用本库 headless 的 `LocalSearch`：一次交互只走 UI Kit 一条通道。
上游自己用 `api.map.baidu.com` 的 JSONP 通道（`qt=` 私有请求码），本库源码不接触这些私有面。
`tests/behavior/v3-ui-kit-events.test.ts` 用「`driver.services` 一次都没被读到」来锁这条。

## 与 `BAutoComplete` 的区别（迁移说明）

两者**不是同一个东西**，本库不会静默替换：

| | `BAutoComplete` | `BPlaceAutocomplete` |
| --- | --- | --- |
| 数据通道 | 本库 headless `Autocomplete`（`BMapGL.Autocomplete`） | 官方 UI Kit 的 JSONP 通道 |
| UI | 无（只把输入框绑给 SDK，联想 UI 由 SDK 自己的下拉实现） | 官方 UI Kit 输入框 + 建议下拉 + 键盘导航 |
| 入口 | 根入口 `baidu-map-gl-vue` | 子入口 `baidu-map-gl-vue/ui-kit` |
| 额外依赖 | 无 | `@baidumap/jsapi-ui-kit`（optional peer）+ 手写引入 CSS |

- 想要**官方样式与交互**、并且可以接受多一个可选依赖 → 用 `BPlaceAutocomplete`；
- 已有页面在用 `BAutoComplete` 且不想改样式/依赖 → 保持现状，两者可以在同一页共存
  （它们走不同通道，互不干扰）。

## `BPlaceDetail`

详情面板（图片、标题、评分、营业时间、电话、标签、外链等）全部由官方 UI Kit 渲染。

### Props

| Prop | 类型 | 说明 | 变更时 |
| --- | --- | --- | --- |
| `display` | `PlaceDetailDisplayDTO` | 详情字段显隐（上游默认全部显示） | 🔁 重建 |
| `uid` | `string` | 要展示的 POI uid；不传则停在空状态 | ✅ `setPlace()`；改回未设置 → `clear()` |

`uid` **不是**构造期选项（上游构造器只吃 `map` / `display`），所以本库会在 widget 构造完成后
补一次 `setPlace()` —— **挂载时就带 `uid` 也能生效**。改回未设置走 `clear()`（上游有明确定义的
公开方法），不会清掉 widget 本身。

### 事件

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `load` | `PlaceDetailDTO` | 详情加载完成 |

### 公开动作（`ref`）

```ts
const api = detail.value!;
await api.setPlace("poi-uid");   // uid 模式：请求详情接口
await api.setPlace(rawPoiObject); // POI 模式：上游按自己的 POI 形状直接渲染
await api.clear();                // 回到空状态占位
```

### 两个必须知道的边界

- **`setPlace(uid)` 是「发起」而不是「完成」**（上游 `setPlace()` 返回 `void`）。完成信号是
  `load` 事件；**该 uid 找不到时上游既不抛错也不发事件**，界面回到空状态占位 ——
  所以「没有收到 `load`」是合法结果，需要超时语义请自行对事件设截止时间。
  请求失败也没有错误出口（上游把 Promise 丢掉了），本库**不合成** `error` 事件。
- **POI 模式要求传上游能渲染的 POI 对象**。本库原样转发、不做字段转换，也不为它的内部结构
  背书：传本库的 `PlacePoiDTO`（`title` / `address` / …）**不会**得到完整详情。
  要展示检索结果的详情，请用 uid —— `BPlaceSearch` 的 `select` 载荷里就带 `uid`。
- **快速切换 `uid` 时不要假设有请求去重**。上游的 `load` 载荷里没有「这是第几次请求」的标识，
  它自己也会把迟到的回包渲染进面板；本库因此**不做请求去重、也不丢事件**（只丢事件会变成
  「面板显示 B、事件却说 A」）。需要按当前 `uid` 过滤时，请在 `load` 载荷里比对 `uid`
  （uid 模式会把它带回来）。

**没有 `layout`**：上游 `PlaceDetailOptions` 声明了 `layout?: 'default' | 'compact'`，
但锁定版本 `1.1.2` 的两个产物里**没有任何读取点**（传了不生效）。假支持不如没有，
所以本库不暴露它；上游真做出来时形状锁会先红。

## `BRoutePlan`

路线面板（表单、类型标签、方案卡、开始导航按钮）全部由官方 UI Kit 渲染。

### Props

| Prop | 类型 | 说明 | 变更时 |
| --- | --- | --- | --- |
| `drivingOptions` | `{ policy?: RoutePlanDrivingPolicy; alternatives?: number }` | 驾车策略与备选方案数（上游默认 `0` / `1`） | 🔁 重建 |

`RoutePlanDrivingPolicy` 是与上游 `DrivingPolicy` 枚举**逐值对齐**的自持常量表，
**既是类型也是值**（与 TS 枚举同形），所以不必写魔法数字：

```ts
import { BRoutePlan, RoutePlanDrivingPolicy } from "baidu-map-gl-vue/ui-kit";

// 模板里：<BRoutePlan :driving-options="{ policy: RoutePlanDrivingPolicy.AVOID_CONGESTION }" />
const props = {
  drivingOptions: { policy: RoutePlanDrivingPolicy.AVOID_CONGESTION, alternatives: 2 },
};
```

常量表与上游枚举的「名字 → 数字」对应关系由契约测试对着上游声明逐成员锁定，
不是靠命名规律推断的。

### 事件

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `result` | `RoutePlanResultDTO` | 搜索成功（与 `search()` 的 Promise 结果**同一形状**） |
| `error` | `BMapError` | 搜索失败（与 `search()` 的失败是**同一条**错误对象，`code` 为 `BMAP_SERVICE_FAILED`） |
| `planselect` | `{ type, planIndex, plan }` | 某条方案被选中（展开） |
| `navclick` | `{ type, result, planIndex, plan? }` | 点击「开始导航」（`result` 可为 `null`） |
| `clear` | — | 结果被清空 |
| `typechange` | `{ type }` | 类型切换（**锁定版本下不可达**，见下） |

### 公开动作（`ref`）

```ts
const api = routePlan.value!;

// 纯数据坐标：本库会经 Driver 转成引擎原生点后再交给上游
const result = await api.search({
  start: { lng: 116.404, lat: 39.915 },
  end: { lng: 116.305, lat: 39.982 },
  startName: "起点",
  endName: "终点",
});

// 也支持地点名 / uid 字符串（上游的字符串模式），以及驾车途经点
await api.search({ start: "百度大厦", end: "中关村", waypoints: [{ lng: 116.35, lat: 39.95 }] });

await api.clear();               // 清空结果（同时触发 clear 事件）
await api.getCurrentType();      // 锁定版本恒为 "driving"
await api.getLastResult();       // 没搜索过 / 被清空时为 null
```

`search()` 的返回值与 `result` 事件是同一形状（上游返回值里叫 `routeType`、事件里叫 `type`，
本库统一成 `type`）。回包形状无法识别时 `search()` 会**拒绝**（`BMAP_SERVICE_FAILED`），
而不是给你一个空计划表 —— 「形状变了」与「真的没有路线」必须能分辨。这条对**整批漂移**同样成立：
`plans` / `segments` 里**非空却一条都投影不出来**时按不可用处理（事件不发 / 动作拒绝），
只有「本来就是空数组」才是合法的空结果。

**并发调用**：上游没有取消入口，也没有「这是第几次请求」的标识，它自己按后到的回包改写缓存与面板。
所以本库**不做请求去重、也不丢弃旧结果**（丢弃会造成「`await` 拿到的」与「面板显示的」不一致，
比不丢更难排查）。需要串行就请在调用方自己排队。

### 只开放驾车

锁定版本 `1.1.2` 的 `enabledTypes` 硬编码为 `["driving"]`、`showTabs: false`，
`switchType("walking" | "riding" | "transit")` 是 **no-op + `console.warn`**。因此：

- 本库**不暴露 `switchType()`** —— 它的每一种调用要么 no-op 要么只 warn，暴露就是空承诺；
- `typechange` 照常转发（不丢上游事件），但在这个版本下不会触发；
- **四类路线的 headless 能力不受影响**（那是另一条通道，见「服务」相关 composable）。

## `loadUiKit()`：原生逃生口

不用 Vue 组件、或要用上游还没被本库封装的成员时，可以经 `loadUiKit()` 原生构造，自行负责销毁：

```ts
import { loadUiKit } from "baidu-map-gl-vue/ui-kit";

const uiKit = await loadUiKit();
const detail = new uiKit.PlaceDetail(container as HTMLElement, { map: rawMap });
// 用完记得 detail.destroy()；生命周期由你负责
```

- 主题（`applyTheme` / `darkThemeVariables` 等）与多地图共享场景上游尚未验证，
  本库不做额外承诺。

## 运行前提与排错

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 第一次检索抛 `BMap AK is not set` | UI Kit 的 AK 解析链只认「页面里带 `ak=` 的 SDK `<script>`」或 `window.BMAP_AUTHENTIC_KEY` | 用默认 Provider（会自动注入 SDK script）；代理模式请补 `window.BMAP_AUTHENTIC_KEY` |
| `BMAP_UI_KIT_UNAVAILABLE` | 无 DOM 环境调用了 UI 组件，或没装 `@baidumap/jsapi-ui-kit` | 服务端不要渲染 UI 组件；确认已安装 optional peer |
| 组件渲染出来了但没有样式 | 没有显式引入官方 CSS | `import "@baidumap/jsapi-ui-kit/dist/css/jsapi-ui-kit.css"` |
| `BMAP_RESOURCE_DISPOSED` | 组件已卸载后仍调用公开动作 | 在 `onUnmounted` 之前调用，或用 `status` 判断 |
| `BMAP_SERVICE_FAILED`（`BRoutePlan`） | 路线搜索失败（上游的 `error`），或搜索成功但**回包形状无法识别**（上游实现可能已变更） | 看错误的 `message` 与 `cause`；形状漂移会先被 `v3-ui-kit-widget-contract.test.ts` 抓到 |
| `BPlaceDetail` 一直没有 `load` 事件 | 上游对「uid 找不到」与「详情请求失败」**都不发事件**（见上文边界） | 给 `load` 设自己的截止时间；确认 `uid` 来自真实检索结果 |

组件 ref 上还会暴露 `status`：`idle` / `loading` / `ready` / `error` / `disposed`。
它是**取值**而不是 ref（`ref.value.status === "ready"`，不要写 `.status.value` —— 声明里也是取值类型），
加载失败会经地图上下文的事件总线发出 `resource:error`（载荷含 `component` 与 `BMapError`）。

## 验证状态与已知留白

本库侧的行为都有可复现证据（命令见 ADR
[UI Kit 子路径与类型边界](/adr/2026-09-13-ui-kit-subpath-and-type-boundary) 与
[详情与路线封装](/adr/2026-09-13-ui-kit-detail-route-wrappers) 的「后果 / 已知限制」一节）：

- 所有权 / 竞态 / 释放顺序 / props 变更（重建 vs setter）/ 事件 DTO / 不重复请求 →
  `tests/behavior/v3-ui-kit-lifecycle.test.ts`、`v3-ui-kit-events.test.ts`
  （用会记账的假 widget，断言落在计数与监听集合上）；
- `BPlaceDetail` / `BRoutePlan` 自己的那几条 → `v3-ui-kit-place-detail.test.ts`（uid 镜像、
  `load` 投影、不暴露 `layout`）、`v3-ui-kit-route-plan.test.ts`（坐标经 Driver、事件与拒绝是
  同一条错误、脱敏、不暴露 `switchType`）；
- **事件载荷形状 / 上游声明 vs 我们的投影** → `v3-ui-kit-widget-contract.test.ts`：对着官方发布
  产物做形状锁（不靠夹具自证），并用「双向 `Exclude`」与「上游字段必须被投影读到」两类断言把
  自持类型的偏差变成编译器错误；
- 产物隔离与消费方 → `v3-ui-kit-entry.test.ts`（含真实 Vite 生产构建）、`v3-ui-kit-ssr.test.ts`
  （无 DOM 子进程 + DOM 访问记账）、`pnpm verify:package`（tarball 消费方类型检查与子路径 import）。

**未验证项（如实标注，不要当成已证）**：

- **未经本库 Vue 组件、在真实 AK 与真实 v4 上的端到端 smoke**。#70 的探针覆盖的是**原生 widget**
  在真实 v4 上的构造 / 检索回包 / 释放；本库四个 wrapper 的真机验收由 #74 用同一候选提交统一收口。
- **`typechange` / `navclick` 的真实载荷**：`typechange` 在锁定版本不可达；
  `navclick` 的微信 `wx-open-launch-app` 路径会按需注入外部脚本，未纳入探针。
- **`PlaceDetail` 的 POI 模式**在真实 v4 上只用过「上游能渲染的 POI 对象」这一条路径，
  本库不承诺它接受本库自己的 `PlacePoiDTO`（见上文边界）。
