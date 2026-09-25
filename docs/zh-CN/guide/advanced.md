# 扩展契约（`./advanced`）

组件库对外的入口分四种承诺。它们**不是并列的能力清单**，而是不同强度的承诺：

| 子路径 | 是什么 | 承诺 |
| --- | --- | --- |
| `.` | 组件、composable、resolver、公共类型 | **稳定**，按语义化版本演进 |
| `./advanced` | 第三方扩展契约：Provider / Driver / Handle / Capability / 归一化函数 | **承诺维护**，导出面是冻结的精确集合（见下） |
| `./plugins` | 插件定义面：`BMapPluginDefinition`、插件 Catalog 名字表、definition 工厂 | **承诺维护**（`plugins: [...]` 是公开配置面） |
| `./ui-kit` | 官方 UI Kit 的 Vue 封装（optional peer） | 独立契约，见[官方 UI Kit](./ui-kit) |

（`./components` / `./composables` / `./resolver` 是根入口的等价视图，承诺与 `.` 相同。）

**没有 `./core` 子路径。** 1.0 的公共出口只有上面那几个。要写第三方 adapter、
自研 Provider / Driver、或者要拿 raw SDK 对象，都用 `./advanced`。

`MapRuntime`、`SdkRegistry`、`ScriptLoader`、`hash` 这类内部实现**没有任何公开出口可达**，
它们随时可能改。

## `./advanced` 导出什么

按用途分六组（**这就是全部**——它是冻结的精确集合，25 个值导出，多一个少一个都要显式改门禁）：

| 用途 | 导出 |
| --- | --- |
| Provider / Client | `normalizeProvider`、`createBMapClientDefinition`、`createBMapClient`、`jsapiV4DriverFactory` |
| v4 Provider 家族（#44 从 `./core` 并入） | `baiduJsapiV4Provider`、`customScriptV4Provider`、`existingGlobalV4Provider`、`createLoadedJsapiV4` |
| Driver | `createJsapiV4Driver`、`assertLoadedSdk`、`isLoadedSdk` |
| Handle（含 raw 逃生口） | `unwrapRaw`、`createHandle`、`HANDLE_BRAND` |
| Capability | `createCapabilityRegistry`、`UnsupportedCapabilityError`、`CAPABILITY_CATALOG`、`CAPABILITY_FAMILIES`、`CAPABILITY_IDS`、`CAPABILITY_STATUSES` |
| 归一化 | `normalizeMapMouseEvent`、`toPoint`、`toPlainPoint`、`toPlainPoints`、`isPointLike` |

类型面另有 `BMapClient` / `BMapDriver` / `BMapProviderLike` / `MapHandle` 家族 / `Capability` /
`OverlayDriver` / `LayerDriver` / Provider options 家族 … 等（见 `dist/advanced.d.ts`）。

**刻意不在 `./advanced` 里的东西**（它们只属于仓库内部的 `src/core`，**没有任何公开子路径可达**）：

`MapRuntime`、`SdkRegistry`、`ScriptLoader`、`SharedLoadTask`、`createMapEventBus`、
`createFrameScheduler`、`ResourceScope`、`hash`、`fingerprintConfig`、`normalizeApiUrl`、
`createPluginRegistry`、`useSdkResource`、`createLayerRegistry`、`createOverlayRegistry`、
`DataLayerManager`、`BMapError`。

这条边界由回归测试双向钉住：上面这批内部名字**必须**能在一个内部 barrel 里找到（正证），
**必须**不在任何公开子路径上（负向）。只写负向是不够的——清单拼错或名字改名后，
那条断言会静默变绿。`./core` 子路径也不会被重新加回 `package.json#exports`。

## 第三方 adapter 的最小装配

```ts
import {
  createBMapClient,
  createBMapClientDefinition,
  createJsapiV4Driver,
  normalizeProvider,
  unwrapRaw,
  type BMapProviderLike,
} from 'bmap-vue/advanced'

export function createAdapter(provider: BMapProviderLike, options: { ak: string; rawSdk: unknown; version: string }) {
  const definition = createBMapClientDefinition({
    provider,
    loadOptions: { ak: options.ak },
    // 注入自己的 Driver 工厂；缺省是 jsapiV4DriverFactory（内部先 assertLoadedSdk）
    driver: (input) => createJsapiV4Driver({ rawSdk: input.rawSdk, version: input.version, unsupported: 'warn' }),
  })
  return {
    definition,
    createClient: () => createBMapClient(definition),
    normalized: normalizeProvider(provider),
  }
}
```

`raw` 逃生口一律经 handle：

```ts
import { createHandle, unwrapRaw } from 'bmap-vue/advanced'

const handle = createHandle('map', rawMap) // rawMap 是 SDK 的 Map 实例
const raw = unwrapRaw(handle) // 形状由 SDK 决定，本库不承诺
```

这份代码在仓库里有**可编译的实例**：`fixtures/consumer/src/advanced-adapter.ts`
（由 `pnpm verify:package` 对着 tarball 编译）。

## tree-shaking 承诺

包声明 `sideEffects: false`，并且 `./advanced` 的静态依赖闭包**不含任何组件**（也不引用官方
UI Kit）。所以「只用了 `./advanced`」的消费者不会把整个组件库拉进包里。

这条承诺在两侧各有一个门禁，而且是**成对**的（只有正证才能证明判据有区分力）：

| 位置 | 判据 |
| --- | --- |
| 行为测试 | `dist/advanced.mjs` 的 import 闭包不含组件标记、不引用 `@baidumap/jsapi-ui-kit`；**对照**：根入口闭包必须含组件标记 |
| `pnpm verify:package` | 在装了 tarball 的消费方里用真实打包器各打一次「只用 `./advanced`」与「只用根入口」，前者 0 个组件标记、后者必须命中 |

```bash
# 消费方一侧的完整验证（会打包 tarball 并在 fixture 里安装）
pnpm pack:package && pnpm verify:package
```
