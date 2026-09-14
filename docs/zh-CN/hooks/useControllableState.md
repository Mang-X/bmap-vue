---
title: useControllableState
---

# useControllableState 受控 / 非受控状态

把一个字段的**受控值 / 非受控初值 / 库默认值**三种来源收成同一套规则，供组件与业务侧复用。
`<BMap>` 的 `center` / `zoom` / `heading` / `tilt` 就是用它实现的（规则与状态表见
[Map 地图](../components/map) 的「受控 / 非受控视野」一节）。

```ts
import { useControllableState } from 'baidu-map-gl-vue'
```

## 优先与模式

来源优先级固定为 **受控值 > `defaultValue` > `fallback`**：

| 模式 | 判定 | 生效值（`value`） | 外部值变化 | 内部状态变化（用户交互） |
| --- | --- | --- | --- | --- |
| 受控 | 受控 getter 返回非 `undefined` | 外部值 | 写进内部镜像（受控值优先） | 更新内部镜像并通知调用方 |
| 非受控 | 受控 getter 返回 `undefined`，`defaultValue` 有值 | 内部状态 | 不适用 | 更新内部状态 |
| 缺省 | 两者都没有 | 内部状态（初值 = `fallback`） | 不适用 | 更新内部状态 |

## 基本用法

```ts
import { useControllableState } from 'baidu-map-gl-vue'
import { shallowRef, watch, computed } from 'vue'

const props = defineProps<{ value?: number; defaultValue?: number }>()
const emit = defineEmits<{ 'update:value': [value: number] }>()

const state = useControllableState<number>({
  name: 'value',
  value: () => props.value,
  defaultValue: () => props.defaultValue,
  fallback: 0,
  equals: (a, b) => Math.abs(a - b) <= 1e-6,
})

// ① 外部值 → 内部：在自己的 watcher 里同步（受控值优先）
watch(
  () => props.value,
  (next) => state.syncExternal(next),
  { flush: 'post' },
)

// ② 用户交互 → 内部 → 通知父级：只在真的变化时通知
function handleUserInput(next: number) {
  if (state.commit(next)) emit('update:value', next)
}

console.log(state.value.value) // 生效值（受控时读外部，非受控时读内部）
```

必须在 `setup()` 或 `effectScope()` 内调用（内部会注册一个 `defaultValue` 变化的告警 watcher，
需要随作用域一起释放）。

传**可变对象**（坐标点一类）时补一个 `copy`，否则内部状态会与调用方的对象共享引用：

```ts
const state = useControllableState<{ lng: number; lat: number }>({
  name: 'center',
  value: () => props.center,
  fallback: { lng: 116.403901, lat: 39.915185 },
  equals: (a, b) => Math.abs(a.lng - b.lng) <= 1e-7 && Math.abs(a.lat - b.lat) <= 1e-7,
  copy: (p) => ({ lng: p.lng, lat: p.lat }), // 初值、外部同步、SDK 回写三处都会经它
})
```

## 返回值

| 成员 | 说明 |
| --- | --- |
| `value` | 生效值（`ComputedRef`）：受控时读外部值，非受控时读内部状态 |
| `internal` | 内部状态（`ShallowRef`）：非受控模式的事实源，受控模式是外部值的镜像 |
| `isControlled` | 当前是否受控 |
| `initial` | 首次解析出的初值（用于「初次创建」这类一次性动作） |
| `syncExternal(next)` | 外部值变化入口；传 `undefined` 表示当前没有受控值 |
| `commit(next)` | 内部状态变化入口；返回**是否真的变化**（相等判定含容差） |
| `reset()` | 把内部状态恢复为 `initial`（**不通知**）：「回到初值」的命令之后用它让状态跟上 |

## 选项

| 选项 | 说明 |
| --- | --- |
| `name` | 字段名（告警文案与 context） |
| `value()` | 受控值读取器；返回 `undefined` 即非受控 |
| `defaultValue()` | 非受控初值读取器；**只在首次解析时读一次** |
| `fallback` | 既无受控值也无初值时的库默认值（只在首次解析时使用） |
| `equals` | 相等判定；**必须容忍浮点抖动**，否则受控写入与 SDK 回写会形成往返 |
| `copy` | 值的防御性拷贝（默认恒等）；传可变对象时应当提供 |
| `warn` | 是否输出用法告警（默认 `true`）；即使为 `true`，也只有**非生产环境**才真的打印（读 `process.env.NODE_ENV`，由消费方的打包器或运行时决定） |

## 五条规则

1. **`defaultValue` 只在首次解析时读一次。** 之后**任何** default 写入都不会覆盖内部状态（值改变、
   从无到有、从有到无），因此都会告警一次（每字段至多一次）；发生这种情况时输出一次告警。
2. **模式按「当前受控值是否存在」实时判定，不冻结在首次解析**，因此「异步数据到达后才开始
   受控」是支持的。
3. **模式切换只告警、不拒绝**，且只在「切换会造成事实源歧义」时告警：非受控 → 受控且外部值
   与当前内部状态冲突时告警一次；受控 → 非受控时内部状态接管（保留最后一次外部值）并告警一次。
   父级把交互结果原样写回（`v-model` 的正常闭环）不会告警。
4. **可变值必须经 `copy` 落库**：初值、外部同步、SDK 回写三处都持有独立拷贝，调用方原地修改
   自己的对象不会绕过状态机。
5. **「回到初值」的命令必须同时调用 `reset()`**：只在外部世界（地图等）侧重置而不管状态，会让
   非受控档的状态与外部世界分叉——之后**真实**回到「重置前那个值」的操作会被 `commit` 判成
   「没变化」而丢掉。

告警只在非生产环境输出：判定读 `process.env.NODE_ENV`，**留给消费方的构建 / 运行时**去折叠
（打包器替换成字面量、Node / SSR 读真实环境变量），因此不会因为发布构建而永远消失。

相等判定的现成实现见
`packages/baidu-map-gl-vue/src/core/utils/equality.ts`（`pointEquals` / `numbersEqual` /
`anglesEqual`）。
