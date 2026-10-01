---
"@mangax/bmap-vue": patch
---

发布身份迁到 `@mangax/bmap-vue`

npm 上的 `bmap-vue` 归另一位作者所有（1.0.0–1.5.0），且我们目标发布的 `1.0.0`
那个版本号已被占用。因此本库的发布身份从无 scope 的 `bmap-vue` 迁到
`@mangax/bmap-vue`（#45 实施第 6 条）。

**这不是一次 API 变更**：公共类型面、导出面、产物内容全部不变——5 份 API report
基线只重录了 header 一行（`## API Report File for "…"`），7 份签名基线逐字节未变。

同步更新的位置：

- `packages/bmap-vue/package.json` 的 `name`；
- README / 安装页 / 对照页 / 关于页的安装命令、npm 徽章、CDN 示例（CDN 路径同时
  锁到 `@1`）；
- `scripts/verify-package.mts`：tarball 定位、ESM 探针说明符、`node_modules` 路径
  一律改为从 manifest 派生。原先散落的十处字面量是「改一处、漏三处」的来源——
  漏掉的那处不会报错，只会让门禁静默不生效；
- 新增 `scripts/release-identity.mts` 作为发布身份的单一事实源：下次换包名只需改
  manifest 一个字段。

`publishConfig.access` 此前对无 scope 名是空操作，现在**必需**——npm 对 scoped 包
默认按 restricted 处理，漏掉它首次 `npm publish` 会直接失败。
`verify:package` 现在会断言这一项。

补充（第二轮评审后）：包名改动还波及三处此前没人想到的地方，一并修掉：

- **CI 的 `package` job** 原本按 `bmap-vue-*.tgz` glob 找 tarball，迁到 scoped 名后
  匹配不到任何文件。现在直接调 `pnpm verify:package`（单一实现，且覆盖面更全）。
- **全部 60 份未消费的 changeset** 的 package key 必须一并迁移。实测只要有**一份**
  仍用旧 key，`changeset status` 就直接崩溃（exit 1）——发版流程会当场断掉。
- **文档代码块里的裸 specifier 共 119 个文件**（`from 'bmap-vue'`、`bmap-vue/volar`）。
  消费 fixture 在验证时会重写包名，所以门禁照样绿——**临时重写掩盖了公开文档本身的
  迁移遗漏**。现已直接改源码，并新增 `check:docs-brand` 的 `retired-scope` 规则让旧名
  无法在发布面的导入语句里回流。
- 两处**门禁自己没跟上身份迁移**：`check:snippet-consistency` 的标识符提取写死旧名
  （迁移后 `createBMapPlugin` 从校验集合消失而报告仍 OK）、`generate-api-diff` 把旧包名
  写进生成物。判据同样改为从 manifest 派生。