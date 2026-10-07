/**
 * SSR 消费者报告的判据（issue #158 工作包 B）
 *
 * 住在 boundary 而非驱动脚本：驱动脚本顶层跑 `main()`，用例 import 它会连带触发真实的
 * 子进程；这里只有纯函数，可以喂**合成报告**做行为级反例（合法报告必须过、每类违规必须红）。
 * 与 `consumer-isolation.mts` / `release-identity.mts` 的分层理由相同。
 *
 * 判据分六组，缺一组都会让某一类回归静默通过：
 *
 * | 组 | 防的是 |
 * | --- | --- |
 * | 环境无 DOM | 门禁其实跑在 happy-dom / jsdom 里（那样「SSR 可用」是假结论） |
 * | 三个包同版本 | 装了两个 Vue（SFC 编译 / SSR 渲染对不上），却因为「能渲染」而看起来正常 |
 * | 容器 shell | 组件在服务端根本没渲染出容器（或渲染成空） |
 * | 插槽可观察量 | 服务端**建了图**（`map` 非 null）或状态不是 `idle` |
 * | DOM 访问增量为 0 | 入口 / 渲染在服务端碰了 DOM（`document` 是硬信号） |
 * | 未加载 SDK | 服务端发起或完成了 JSAPI 加载（`loader` 状态 / 全局 `BMap`） |
 */
export interface SsrReport {
  readonly versions: {
    readonly vue: string;
    readonly serverRenderer: string;
    readonly compilerSfc: string;
  };
  readonly environment: {
    readonly hasWindow: boolean;
    readonly hasDocument: boolean;
  };
  readonly domAccessDelta: readonly string[];
  readonly html: string;
  readonly loaderStatus: string;
  readonly bmapGlobal: string;
}

/** `vue` 与两个配套包必须同版本（三者不同版是「装了两个 Vue」最典型的形态）。 */
const VERSION_FIELDS = ["vue", "serverRenderer", "compilerSfc"] as const;

export function assertSsrReport(report: SsrReport): void {
  // 只看 window / document：Node 21+ 自带 `navigator`，它的存在不是 DOM 证据。
  const domPresent = (["hasWindow", "hasDocument"] as const).filter(
    (key) => report.environment[key],
  );
  if (domPresent.length > 0) {
    throw new Error(
      `[consumer-ssr] SSR 门禁跑在了有 DOM 的环境里（${domPresent.join(", ")}）—— ` +
        `那样「服务端渲染可用」是假结论。runner 必须是纯 Node，不得加载 happy-dom / jsdom。`,
    );
  }

  const versions = VERSION_FIELDS.map((field) => report.versions[field]);
  if (versions.some((version) => version.length === 0)) {
    throw new Error(`[consumer-ssr] 版本读数缺失：${JSON.stringify(report.versions)}`);
  }
  if (new Set(versions).size !== 1) {
    throw new Error(
      `[consumer-ssr] vue / @vue/server-renderer / @vue/compiler-sfc 版本不一致：` +
        `${JSON.stringify(report.versions)}\n` +
        `  三者不同版会同时破坏 SFC 编译与 SSR 渲染，且常常表现为「能渲染但行为怪」。`,
    );
  }

  // 容器 shell：SSR 输出必须包含组件自己的两个结构类名，而不是空串或错误兜底。
  for (const marker of ["bmap-container", "bmap-canvas-host"]) {
    if (!report.html.includes(marker)) {
      throw new Error(
        `[consumer-ssr] SSR 输出里没有 \`${marker}\` —— 容器 shell 没有渲染出来：\n  ${report.html.slice(0, 300)}`,
      );
    }
  }

  // 插槽可观察量：状态是 idle，且服务端**没有**地图实例（`map === null` → `no-map`）。
  if (!report.html.includes('class="ssr-status">idle<')) {
    throw new Error(
      `[consumer-ssr] SSR 下 <Map> 的 status 不是 \`idle\` —— 服务端不应进入建图状态：\n  ${report.html.slice(0, 300)}`,
    );
  }
  if (!report.html.includes('class="ssr-has-map">no-map<')) {
    throw new Error(
      `[consumer-ssr] SSR 下默认插槽拿到了非 null 的 map —— 服务端不应创建地图实例：\n  ${report.html.slice(0, 300)}`,
    );
  }
  if (report.html.includes("<script")) {
    throw new Error("[consumer-ssr] SSR 输出里出现了 <script> —— 服务端不应注入任何脚本。");
  }

  // DOM 访问增量为 0：`document` / `window` / `navigator` 都不许被碰（基线已扣掉 Vue 自身）。
  if (report.domAccessDelta.length > 0) {
    const counts = report.domAccessDelta.reduce<Record<string, number>>((acc, name) => {
      acc[name] = (acc[name] ?? 0) + 1;
      return acc;
    }, {});
    throw new Error(
      `[consumer-ssr] SSR 渲染期间访问了浏览器全局：${JSON.stringify(counts)} —— ` +
        `入口或组件在服务端碰了 DOM（库与它的依赖都必须在无 DOM 时可用）。`,
    );
  }

  if (report.loaderStatus !== "notload") {
    throw new Error(
      `[consumer-ssr] 服务端渲染改变了官方 loader 状态：${report.loaderStatus}（应为 notload）—— ` +
        `服务端不应发起 JSAPI 加载。`,
    );
  }
  if (report.bmapGlobal !== "undefined") {
    throw new Error(
      `[consumer-ssr] 服务端出现了全局 BMap（typeof = ${report.bmapGlobal}）—— ` +
        `SDK 不得在无 DOM 的服务端被装配。`,
    );
  }
}
