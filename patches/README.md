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

### （无在用补丁）

原 `@baidumap__jsapi-v4-types@4.0.4.patch`（修 `core/displayOptions.d.ts` 的大小写引用）**已删除**。

**删除依据**（即该补丁自己写明的 deletionCondition）：上游 `4.0.5`
（`baidu-maps/jsapi-v4-types@5ba67f4dda11b0a4b54fc631278d3e39e11667c3`）自己修正了大小写，
`index.d.ts` 现在写的是 `core/DisplayOptions.d.ts`。依赖因此从 npm 的 `4.0.4` 换成**钉住 commit**
的 git 依赖——4.0.5 至今**未发布到 npm**（`npm view` 的 `latest` 仍是 4.0.4）。

大小写回归本身由 `tests/behavior/upstream-types-reference-case.test.ts` 继续守着
（原 `upstream-types-case-patch.test.ts` 反转成回归门禁，见该文件头）。
