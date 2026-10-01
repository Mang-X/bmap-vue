---
"@mangax/bmap-vue": patch
---

发布基础设施收口：把「本地产物能跑」变成「发布产物可断言」（#45）

- 新增 `check:pack-contents`：判据是**实际发布的那一个 tarball**（`files` 声明的每一项、
  `exports` 与顶层字段引用的每个文件、禁止形态、`dist` 产物形态），此前 `publint` / `attw`
  都只看目录，一条都抓不到这类问题。两条匹配口径刻意区分：`files` 的**目录项**才允许前缀
  匹配（否则 `volar.d.ts/leftover.txt` 会顶替缺失的 `volar.d.ts`）；顶层字段的 `./` 前缀
  **不是必需的**（`unpkg: "dist/index.js"` 是合法形态，只收 `./` 会让它被静默跳过）。
- 修掉一个**已经存在**的发布缺陷：`volar.d.ts` 在 `.gitignore` 里且只由
  `generate-manifest-artifacts.mts` 写，跳过那一步直接 `pnpm pack` 会静默发出**缺 Volar 类型**的包
  （实测 47 vs 48 个条目），而 README 与安装页都承诺了自动补全。**三管齐下**堵住：根
  `pack:package` 内置生成前置；子包 `prepack` 让 `npm publish` 路径也强制（实测 publish 会跑
  子包 lifecycle 但不跑根脚本）；门禁从结果侧钉死。
- `dist/bmap-vue.css` 从「构建副产物」变成**显式声明的公共面**（按文件名列入 `files`），
  CDN 示例同时锁定版本并指向显式的 `dist/index.global.js`。
- `publint` / `@arethetypeswrong/cli` / `@microsoft/api-extractor` 精确锁版本：它们是门禁不是库，
  上游一次 minor 就能在无人 review 的情况下改变一个 PR 的判定。attw 的判定从一句
  `grep -q 'node16 (from ESM)'`（外加吞掉退出码的 `|| true`）改为读 JSON 的 `problems`；
  实测被原先那句 grep 藏住的 `CJSResolvesToESM`（7 个子路径）与 `NoResolution`（6 个子路径）
  现已逐条可见——两者都是 ESM-only 出口面的有意后果，登记为显式例外（修它们属 #158 范围）。
- sourcemap 保留：产物中带 `//# sourceMappingURL=` 注释的文件必须有同名 `.map`，否则消费方
  逐文件 404。纯 re-export facade（`components.mjs` / `composables.mjs` / `resolver.mjs`）
  没有注释也不要求 map。

决策与全部依据见 ADR `2026-09-30-pack-contents-and-publish-shape-gates`。
