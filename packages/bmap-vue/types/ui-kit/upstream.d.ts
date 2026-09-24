/**
 * 官方 UI Kit 的**类型占位**（R25-D / issue #73）
 *
 * 为什么需要它：`@baidumap/jsapi-ui-kit@1.1.2` 的 `types` 入口
 * （`dist/index.d.ts` → `dist/types/options.d.ts`）第一行是
 * `/// <reference types="bmapgl-browser" />`，而 `@types/bmapgl-browser` 只是上游自己的
 * **devDependency**。本仓库的 `tsconfig.build.json` 用 `skipLibCheck: false`，把这套声明拉进
 * Program 后会直接报：
 *
 * ```
 * dist/types/options.d.ts(1,23): error TS2688: Cannot find type definition file for 'bmapgl-browser'.
 * dist/components/place-search/PlaceSearch.d.ts(16,13): error TS2833: Cannot find namespace 'BMapGL'.
 * ```
 *
 * 三条处置路线与取舍（决策记录）：
 *
 * 1. **装 `@types/bmapgl-browser`**：`@types/bmapgl-browser@0.0.3` 是第三方手发的包
 *    （作者 Junior2ran，npm 上并不存在被声明对象 `bmapgl-browser`，tarball 内也没有标准的
 *    `package.json` 布局）。为一个 peer 的类型引用引入一份额外的全局 `BMapGL` 命名空间，
 *    会与本仓库精心治理的 `@baidumap/jsapi-v4-types` + augmentation 边界重叠。**不采用。**
 * 2. **改 `skipLibCheck`**：会顺手放过整个仓库的第三方声明检查，代价远大于收益。**不采用。**
 * 3. **本文件（采用）**：把该 specifier 在**构建期**映射到一个空的占位模块
 *    （见 `tsconfig.build.json` 的 `paths`）。运行时行为完全不变（`loadUiKit()` 里的
 *    `import()` 仍是真实的字面量 specifier，产物里也是 external 的 bare import）；
 *    只是让「上游声明文件自身不可消费」这件事不再污染本包的类型检查。
 *
 * 代价与补偿：`src/integrations/ui-kit/types.ts` 里的结构化接口不再由编译器对着上游声明校验，
 * 因此补了一条**契约测试**（`tests/behavior/v3-ui-kit-widget-contract.test.ts`）直接解析
 * 安装目录里上游公布组件 `.d.ts`，逐成员核对名字与调用形态；运行时可用性由 #70 的真实探针
 * （`pnpm probe:official`）覆盖。
 */
export {};
