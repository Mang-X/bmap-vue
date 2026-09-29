# 待定：API 对齐走查发现（issue #141 文档走查）

> 这些是走查中发现的**需要产品决策**的项，不是文档问题。
> 文档侧已经按「现状」改写（不改运行时），但下面第 1 条的两种处理方式需要你选一个。

## 1.【高】`invalidateService` 没有对外暴露，「独占档多一个入口」这个契约不可观察

- `packages/bmap-vue/src/composables/serviceTask.ts:118` 定义了「独占服务任务的公开面：多一个
  `invalidateService`」，`useExclusiveServiceTask`（`:219`）也确实返回它；
- 但 `useLocalSearch`（`useLocalSearch.ts:273`）与四个路线 composable
  （`routeServices.ts:312`）**各自手写返回对象，都没有把它透出去**；
- `packages/bmap-vue/dist/composables.d.ts` 里 `invalidateService` 出现 **0 次**。

结果：文档里「简单档不暴露 / 独占档暴露」的两档划分，**对使用者不可观察**。
`clear()` 事实上就是那个入口（它内部 `task.reset()` + `invalidateService()`）。

两种处置：

| 方案 | 改动 | 代价 |
| --- | --- | --- |
| A. 补进公开面 | 5 个 composable 的返回加 `invalidateService` | 公共 API 增加（要过 `check:api` 基线）；语义上与 `clear()` 高度重叠 |
| B. 承认只有 `clear()` | 改 `serviceTask.ts:118` 的注释与 `guide/services.md` 的两档表述为「内部两档、对外统一是 `clear()`」 | 内部注释即契约说明，改动小；但「独占档」的设计意图在文档上消失 |

**当前按 B 处理**（只改文档与注释，没动运行时）。若选 A，`clear()` 与 `invalidateService`
的关系需要重新写清楚，否则会出现两个含义相近的入口。

## 2.【中】`result` / `location` / `data` 别名只保留了一半

`#165` 的对齐删掉了 `useGeocoder` / `useGeocodeDetail` 的 `result` 别名，但
`useConvertor`（`result`）与 `useIpLocation`（`location` + `data` + `result` 三个同值 ref）
仍然保留。同一个「结果别名」约定，一半 hook 有、一半没有。

建议：明确「只保留 `data`」这一条，其余别名按弃用处理（与 #165 已有的做法一致）。

## 3.【中】`useGeolocation` 的 `data.status` 是硬编码常量

`project` 里 `status: "BMAP_STATUS_SUCCESS"` 是写死的，真实的官方状态码在同对象的
`sdkStatus` 上。也就是说调用方读 `data.status` **永远拿到成功**，无法用于失败分支。
官方 `GeolocationResult` 并没有 `status` 字段，是本库加的。

文档已明确写出「判断成败请看 `status` 而不是 `data.status`」，但这是个易踩的 API 形状。

## 4.【中】`useGeocoder` / `useGeocodeDetail` 共用能力 id 但各建实例

两者都用 `service.geocoder` 这个能力，却各自 `createGeocoder()`。功能无碍
（`Geocoder` 无状态），但与「同能力共享实例」的直觉相反。

## 5.【低】同一层级的两个字段用两套「缺省」语义

`GeocodeDetailResult.point` 在回包无坐标时**回退到请求坐标**，
`addressComponents` 缺项**回填空串**。一个编造值、一个清空，文档已分别说明。

---

## 走查中已直接修掉的文档错误（无需决策）

- `services.md` 示例写 `useGeocoder().search(...)` —— 该 composable 没有 `search`，
  实际是 `getPoint` / `getBatch`（`useGeocoder.ts:81-96`）。示例必然运行时报错。
- `useGeolocation.md` 返回值表列了不存在的 `location`。
- `useGeocodeDetail.md` 的 `getBatch` 逐项形状写成 `{ point, detail, error? }`，
  实际是 `{ point, detail, status, error }`（`useGeocodeDetail.ts:43-48`）。
- 7 个页面的「对**六个** service hooks 完全一致」—— 实际有 12 个服务 composable。
- `sdkStatus`「成功为 0，拿不到为 null」对多数服务**不成立**：
  `useGeocoder` / `useGeocodeDetail` / `useAreaBoundary` / `useIpLocation` /
  `usePanoramaService` 的 `sdkStatus` **恒为 `null`**（官方无状态码入口，
  `services.ts:20-27`）。
- `<BMapProvider :ak>` / `:plugins` 用法错误：`ak` 与 `plugins` 都在 `<Map>` 上，
  `BMapProvider` 只接受 `client` / `definition` / `provider` / `loadOptions` / `autoLoad`。
- `enable-scroll-wheel-zoom`（9 处）—— #165 已改名为 `enable-wheel-zoom`，
  写错的 prop 落进 `$attrs`，**不报错也不生效**。

---

## 6.【严重·运行时缺陷】未传的交互 prop 被 Vue 强制转换成 `false`，等于把官方的「默认开」关掉

`Map.vue:592` 的 `syncEnableProps`：

```ts
for (const [prop, interaction] of INTERACTION_PROPS) {
  const value = props[prop];
  if (value === undefined) continue;          // ← 永不成立
  ctx.client.driver.map.setInteraction(ctx.map, interaction, Boolean(value));
}
```

`INTERACTION_PROPS` 有 8 项，但 `withDefaults` 只显式声明了 `enableDragging: true`、
`enableWheelZoom: false`、`enableAutoResize: true` 三项。其余五项
（`enableInertialDragging` / `enableContinuousZoom` / `fixCenterWhenResize` /
`enableDblclickZoom` / `enableKeyboard` / `enablePinchZoom`）是**缺省 `Boolean` prop**，
Vue 会把「没传」转成 `false`——于是 `value === undefined` 的守卫**永不命中**，
逐个把官方实例方法调成 `disable*()`。

而官方 `core/MapOptions.d.ts` 里：

| 键 | 官方 `@default` | 本库实际（不传时） |
| --- | --- | --- |
| `enableDblclickZoom` | **true** | `false`（→ `disableDoubleClickZoom()`） |
| `enablePinchZoom` | **true** | `false`（→ `disablePinchToZoom()`） |
| `enableKeyboard` | 未标注 | `false` |

**后果**：用户什么都不写，**双指缩放与双击缩放就被静默关掉了**——而这正是
官方默认打开的行为。文档原来写「默认 true」描述的是本应有的行为；
现在表里改成了实测值并加了告警框，但**运行时的错值没有修**。

修法（改 `src/**`，需你授权）：给这 6 个 prop 在 `withDefaults` 里显式钉上
`undefined`，让「没传」真的是「没传」，`syncEnableProps` 的守卫才会短路——
与 `OverviewMapControl` 现有的 `isOpen: false` 注释里写的正是同一个理由。

## 7.【中】`BMAP_HYBRID_MAP` 声明存在但运行期必失败

`driver/jsapi-v4/map.ts:130-140` 附近的注释写着「4.0.5 声明里的 hybrid 在真实运行时
不存在」，`resolveMapTypeConstant` 因此会显式抛错（`BMAP_SDK_CALL_FAILED`）。
文档原先把它标成 ✅ 可用，会让人以为传了就能出混合图。
已改为明确标注「不可用，要混合底图请用 `mapStyleId` / `mapStyleJson`」。

## 8.【中】`MapTypeId` 候选表的自相矛盾注释

`MAP_TYPE_CONSTANT_CANDIDATES` 写 `normal: ["NORMAL", "BMAP_NORMAL_MAP"]`，
注释说运行时三个成员字面量是 `{NORMAL, EARTH, SATELLITE}`，却又说 `BMAP_*` 那组
在运行时不存在。两条注释对同一事实给出相反表述，建议实机复核一次。

## 9.【低】`enableTraffic` 留在 `MapProps` 上但零效果

不在 `INTERACTION_PROPS` 里，因此既不报错也不生效；`Map.vue` 还在 watch 它。
要么删（与 #165「删掉静默丢弃的 prop」的做法一致），要么接上 `TrafficLayer`。
