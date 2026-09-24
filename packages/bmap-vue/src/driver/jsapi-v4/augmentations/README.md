# JSAPI 4.0 类型边界 augmentation 治理

本目录集中存放官方类型包 `@baidumap/jsapi-v4-types` 的**最小声明补丁**。
它属于源码侧的**声明边界**，不进入发布产物，消费者无需安装官方类型包。

- 计划键：`M3A0-BOUNDARY`（issue #15，追踪 #12）
- 上游类型包与精确版本见 `packages/bmap-vue/package.json`（当前 `4.0.4`）
- 接入位置：`packages/bmap-vue/tsconfig.build.json` 的 `compilerOptions.types`
- 目录入口：`../types-reference.d.ts`（三斜线引用本目录下的 `.d.ts`）

## 允许范围（白名单）

只有以下情况可以新增 augmentation：

1. 官方 `.d.ts` **引用了但未声明**的名字（`skipLibCheck: false` 会因此报错）；
2. 官方声明与 `v=4.0` 运行时行为不一致，且短期内不会修（必须在 `@runtimeBasis` 写明证据）；
3. 官方类型包缺少的最小补充，且无法通过项目领域类型绕开。

禁止：

- 复制整套官方声明、或用 augmentation 复刻业务类型；
- 使用 `any` / `unknown` 掩盖缺口（`unknown` 仅用于真正的运行时形状不明，且必须注释原因）；
- 声明运行时值（`const` / `class` / `function`）——本目录只补类型；
- 把官方类型包变成运行时依赖或具名导入。

## 必需元数据（每个 `.d.ts` 文件头）

新增/修改 augmentation 时，文件头必须包含以下字段（`scripts/check-public-dts.mts` 的同级治理测试会校验）：

```ts
/**
 * @augmentation <slug>                    唯一标识，与文件名一致
 * @upstream <package>                     上游包名，如 @baidumap/jsapi-v4-types
 * @upstreamVersion <x.y.z>                精确版本，禁止 caret/range
 * @runtimeBasis <依据>                    运行时依据：加载参数、复现成员、官方文档/issue 链接
 * @deletionCondition <删除条件>           可验证的删除条件（官方补齐即删）
 * @owner <path>                           归属边界（如 driver/jsapi-v4）
 */
```

缺少任一字段、或出现 `any`、或声明了运行时值，治理测试都会失败。

## 生命周期

1. **新增**：先确认能否用项目领域类型绕开；必须补时，按模板写头，并在 `../types-reference.d.ts` 中加三斜线引用。
2. **核对**：每次升级 `@baidumap/jsapi-v4-types`（精确版本变更）后，逐条核对 `@deletionCondition`；
   官方补齐的名字必须删除对应声明，而不是保留“以防万一”。
3. **删除**：删除声明块 → 删除三斜线引用 → 删除文件 → 重跑 `pnpm typecheck:package` 与 `pnpm build:package`。
   若 `typecheck:package` 失败则说明该缺口仍存在，恢复并更新 `@runtimeBasis`。

## 门禁

| 命令 | 作用 |
| --- | --- |
| `pnpm typecheck:package` | `skipLibCheck: false` 下校验 augmentation 与官方声明可合并 |
| `pnpm build:package` | 声明构建；`vite.config.build.ts` 会把 `declare global` 块从公共 `.d.ts` 中剔除 |
| `pnpm check:public-dts` | 断言发布产物无 `BMap.*` / `BMapGL` / 官方类型包引用，且边界文件未被发布 |
| `pnpm check:raw-sdk` | 断言组件 / composable / runtime 未直接访问 raw SDK |

边界配置的单一事实源：`scripts/raw-sdk-boundary.mts`。
