# 依赖补丁（pnpm patches）

本目录存放**上游包产物**的最小修补，由 `pnpm-workspace.yaml` 的 `patchedDependencies` 在
`pnpm install` 时应用。补丁一律随版本精确生效，并且**必须有删除条件** —— 上游修复后应删除补丁，
而不是让它长期留存。

生成方式：

```bash
pnpm patch <pkg>@<version>
# 编辑 node_modules/.pnpm_patches/<pkg>@<version>/ 下的文件
pnpm patch-commit node_modules/.pnpm_patches/<pkg>@<version>
```

## 清单

### `@baidumap__jsapi-v4-types@4.0.4.patch`

| 项 | 值 |
| --- | --- |
| 上游包 | `@baidumap/jsapi-v4-types@4.0.4` |
| 上游仓库 | <https://github.com/baidu-maps/jsapi-v4-types> |
| 修补文件 | `index.d.ts`（入口，全文 192 行均为 `/// <reference path>`） |
| 改动 | `/// <reference path="core/displayOptions.d.ts" />` → `core/DisplayOptions.d.ts` |
| 触发问题 | issue #50（发现于 #15 / PR #49 的 CI 首轮） |
| 决策记录 | [`docs/adr/2026-09-13-upstream-types-case-patch.md`](../docs/adr/2026-09-13-upstream-types-case-patch.md) |
| 门禁 | `tests/behavior/v3-upstream-types-case-patch.test.ts`、`pnpm typecheck:v3` |

**为什么需要它**：发布产物中实际文件名是 `core/DisplayOptions.d.ts`，而入口引用写成了小写。
macOS（APFS 默认大小写不敏感）能解析到真实文件，Linux / 任何大小写敏感的卷上
`pnpm typecheck:v3`（`skipLibCheck: false`）直接失败：

```text
error TS6053: File '.../core/displayOptions.d.ts' not found.
error TS2552: Cannot find name 'DisplayOptions'.   // core/Map.d.ts / core/MapOptions.d.ts
```

包内 193 个 `.d.ts`、192 条三斜线引用，按文件名大小写逐条比对**只有这一处不匹配**
（复核脚本见门禁用例：用 `readdirSync` 的精确名字比对，不依赖平台的大小写敏感性）。

**删除条件**：上游发布修正大小写的版本后 ——

1. 把 `packages/baidu-map-gl-vue/package.json` 的 `@baidumap/jsapi-v4-types` 升到该精确版本；
2. 删除本补丁文件与 `pnpm-workspace.yaml` 里的 `patchedDependencies` 条目；
3. 重跑 `pnpm install`、`pnpm typecheck:v3` 与 `pnpm test:unit`
   （`v3-upstream-types-case-patch.test.ts` 会核对补丁已声明且已生效；删除补丁时需同步删掉该用例
   的补丁断言，保留「无大小写不匹配引用」那条扫描断言 —— 上游修好之后它仍应通过）。

这一步不会悄悄漏掉：`patchedDependencies` 的键是 `包名@精确版本`，只升级依赖而留下旧键时
`pnpm install` 直接失败（实测 2026-09-13）：

```text
ERR_PNPM_UNUSED_PATCH  The following patches were not used: @baidumap/jsapi-v4-types@4.0.3
help: Either remove them from "patchedDependencies" or update them to match packages in your dependencies.
```

**回滚方式**：删除补丁与 `patchedDependencies` 条目 → 恢复 `pnpm install` →
`pnpm typecheck:v3` 会重新在 Linux 上失败，此时必须同时把该 step 从
`.github/workflows/quality.yml` 摘掉，并更新 `CONTRIBUTING.md` 与
`docs/zh-CN/contributing/ai-development.md` 的验证口径。
