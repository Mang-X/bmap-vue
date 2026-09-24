/**
 * 在 Node 里按路径载入**仓库源码**的 `.ts` 模块（供生成器脚本使用）
 *
 * 为什么不能直接 `import(freshModuleUrl(path))`：`node --experimental-strip-types` 只做
 * **类型擦除**，不补扩展名，也不解析目录。因此 `overlayEventCatalog.ts` 里那句
 * `import { toVueEventName } from "../events/eventCatalog"` 会以 `ERR_MODULE_NOT_FOUND`
 * 失败——Node 去找的是字面量路径 `…/core/events/eventCatalog`（无扩展名）。
 *
 * `generate-capability-matrix.mts` 一类的事实源都是**纯数据**模块（只有一个 `import type`
 * 会被擦除），所以 `freshModuleUrl()` 够用；本模块负责的事实源带**值导入**的跨文件依赖，
 * 必须在 Node 能解析扩展名之后才能载入。
 *
 * 为什么用 rolldown：它是 Vite 自带的打包器（`vite` 的传递依赖），不引入新的顶层依赖；
 * `build({ write: false })` 在内存里出 ESM 产物，`import(dataUrl)` 即可拿到运行期值。
 * 另一条更重的路是起一个 dev server / 调 vitest 的模块图——生成器只需要「读几张数据表」，
 * 那样做会引入本仓库的测试环境（happy-dom、setup 文件），与本脚本无关的失败面太大。
 */
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

/** rolldown（Vite 的传递依赖）没有 hoist 到 `node_modules` 根，从 `vite` 的位置反查。 */
function loadRolldown(): Promise<(options: unknown) => Promise<Bundle>> {
  const require = createRequire(import.meta.url);
  const vitePackage = require.resolve("vite/package.json");
  const entry = require.resolve("rolldown", { paths: [dirname(vitePackage)] });
  return import(pathToFileURL(entry).href).then(
    (module) => (module as { rolldown: (options: unknown) => Promise<Bundle> }).rolldown,
  );
}

interface Bundle {
  generate(options: { format: "esm" }): Promise<{ output: readonly { code: string }[] }>;
}

/**
 * 打包并载入一个**绝对路径**的 `.ts` 源文件，返回它的导出命名空间。
 *
 * `platform: "node"` 让依赖解析走 Node 语义而不是浏览器语义；本仓库的生成器只喂纯数据模块，
 * 不涉及条件导出 / 浏览器字段。
 */
export async function loadSourceModule<T = Record<string, unknown>>(
  absolutePath: string,
): Promise<T> {
  const rolldown = await loadRolldown();
  const bundle = await rolldown({ input: absolutePath, platform: "node" });
  const { output } = await bundle.generate({ format: "esm" });
  const code = output[0]!.code;
  return (await import(`data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`)) as T;
}
