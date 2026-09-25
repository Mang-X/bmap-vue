// 文档示例的第三方依赖声明。
//
// **刻意不声明 `*.vue`**：消费方 fixture 装了 `@vue/compiler-sfc` + `vue-tsc`，
// SFC 会被**真正解析**。一旦在这里写 `declare module "*.vue"`，`docs/examples/**`
// 就会退化成「任何 props 都合法」的空壳——那样这道检查（示例对着正式 tarball 编译）
// 就没有判别力了。
//
// 真正需要声明的只有 `bmap-draw`：它没有随包发布类型，而 `docs/examples/expand/bmap-draw/**`
// 确实 import 它。
declare module "bmap-draw";
