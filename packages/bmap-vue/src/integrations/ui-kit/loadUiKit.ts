/**
 * 官方 UI Kit 的动态加载边界（R25-D / issue #73）
 *
 * 为什么必须是动态 import（ADR 2026-09-13 决策 4 与「已知限制」）：
 * `@baidumap/jsapi-ui-kit@1.1.2` 没有 `exports` 字段 ⇒ Node 侧解析到 `main`（IIFE 产物），
 * 模块求值期就访问 `document` 而抛 `ReferenceError`；ESM 产物更早死在打包进去的 `js-md5`
 * / `Buffer` interop 上。两者都是**求值期**崩溃，无法被 `try/catch` 或条件分支挡住——
 * 所以 `./ui-kit` 入口与根入口都不得静态引入它，只能在浏览器挂载后动态 import。
 *
 * 本模块是**唯一的** UI Kit 加载点：
 * - 让「加载」这件事只有一份账（单例 Promise），避免每个组件各 import 一次；
 * - 让「无 DOM 环境调用」有一个明确的、可测的失败面，而不是让上游的
 *   `document is not defined` 冒到业务里；
 * - 让构建侧只需要在 `vite.config.build.ts` 里把包名标成 external（见该文件注释）。
 */
import { BMapError } from "../../core/errors/BMapError";
import type { UiKitModule } from "./types";

/** 运行时依赖的官方 UI Kit 包名；精确锁定版本见 package.json 的 optional peer。 */
export const UI_KIT_PACKAGE = "@baidumap/jsapi-ui-kit";

/**
 * UI Kit 样式表的显式引入路径。
 *
 * 官方包**不在 JS 里注入样式**（#70 契约：JS 入口 eval 后页面里 0 个 UI Kit 样式节点），
 * 消费方必须自己 `import` 本路径。`./ui-kit` 入口刻意**不**自动引入它：
 * 「CSS 由消费方显式引入」是与 #70 一起冻结的口径，自动注入会让「不用 UI 的产物」
 * 也可能带上样式。
 */
export const UI_KIT_STYLE_PATH = "@baidumap/jsapi-ui-kit/dist/css/jsapi-ui-kit.css";

/** 模块级单例 Promise：并发调用共享同一次 import，失败不缓存（可重试）。 */
let cached: Promise<UiKitModule> | null = null;

/** 当前是否已经发起过加载（诊断/测试用，不改变加载行为）。 */
export function isUiKitLoaded(): boolean {
  return cached !== null;
}

/**
 * 动态加载官方 UI Kit。
 *
 * - 无 DOM 环境（SSR / Node）：**不**去 import，直接以 `BMAP_UI_KIT_UNAVAILABLE` 拒绝，
 *   这样 SSR 渲染我们的组件只会得到一条可读错误，而不是上游的模块求值崩溃；
 * - 包未安装 / 加载失败：同样以 `BMAP_UI_KIT_UNAVAILABLE` 拒绝并保留 `cause`，
 *   且**不缓存失败**——optional peer 是「不装也能跑，需要时装上就生效」，把失败缓存住
 *   会让后续调用永远失败。
 */
export function loadUiKit(): Promise<UiKitModule> {
  if (typeof document === "undefined") {
    return Promise.reject(
      new BMapError(
        "BMAP_UI_KIT_UNAVAILABLE",
        `${UI_KIT_PACKAGE} 只能在浏览器环境使用：UI Kit 的入口在模块求值期就访问 document，` +
          "请在浏览器挂载后再调用（服务端渲染时不要渲染 UI 组件）。",
      ),
    );
  }

  if (cached) return cached;

  // 说明：这里的 specifier **必须**是字面量。写成变量（例如 `import(UI_KIT_PACKAGE)`）后
  // 打包器无法静态分析，产物里会留下一个运行期解析的 bare specifier —— 消费方的 bundler
  // 既不会把它当 external，也不会打进产物，最终在浏览器里解析失败。
  const pending = import("@baidumap/jsapi-ui-kit").then(
    (module) => module as unknown as UiKitModule,
    (error: unknown) => {
      // 失败不缓存：装了包之后重试应当能成功。
      if (cached === pending) cached = null;
      throw new BMapError(
        "BMAP_UI_KIT_UNAVAILABLE",
        `无法加载 ${UI_KIT_PACKAGE}：请确认已安装（它是 optional peer，不使用 UI 时可以不装）。`,
        { cause: error },
      );
    },
  );

  cached = pending;
  return pending;
}
