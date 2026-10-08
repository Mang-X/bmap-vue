/**
 * 发布身份的**单一事实源**（issue #45）
 *
 * 发布身份在 1.0 期间从无 scope 的 `bmap-vue` 迁到 `@mangax/bmap-vue`——npm 上的
 * `bmap-vue` 归另一位作者所有（1.0.0–1.5.0），本项目无权发布那个名字。
 *
 * ## 为什么要这个模块
 *
 * 改名触及的地方比想象中多：tarball 文件名、消费 fixture 的依赖键、
 * `verify:package` 的 ESM 探针字符串、`node_modules` 路径……它们散在三个脚本里，
 * 各自写一份字面量的话，改一次包名要同时改十几处，漏一处就是「门禁红」或
 * 「门禁静默不生效」。
 *
 * 因此所有这些位置**一律从 `packages/bmap-vue/package.json` 读**。这是唯一允许
 * 出现包名的地方——下次换名只改 manifest 一个字段。
 *
 * 住在 boundary 而非驱动脚本：驱动脚本顶层跑 `main()`，用例 import 它就会连带触发
 * 真实 `npm install` / `npm pack`。
 */

/** 发布包目录（相对仓库根）。 */
export const PKG_DIR = "packages/bmap-vue";

/** 消费 fixture 拷出来的 tarball 固定名（fixture 的 `package.json` 按它引用）。 */
export const CONSUMER_TARBALL = "bmap-vue.tgz";

export interface ReleaseIdentity {
  /** npm 包名，例如 `@mangax/bmap-vue`。 */
  readonly name: string;
  readonly version: string;
  /** 是否 scoped（`@scope/name`）。scoped 包默认按 restricted 处理，发布必须显式 public。 */
  readonly isScoped: boolean;
  /** `node_modules` 里的目录名：scoped 包是 `scope/name`，不是 `scope-name`。 */
  readonly installedDirName: string;
}

/**
 * 从 manifest 读发布身份。
 *
 * 调用方传 `manifest`（而不是本模块去读盘），这样它对纯函数测试保持无副作用——
 * `fixtures/consumer/package.json` 里的包名与真实包不同，两者要用同一套派生逻辑。
 */
export function releaseIdentityOf(manifest: { name?: unknown; version?: unknown }): ReleaseIdentity {
  const name = typeof manifest.name === "string" ? manifest.name : "";
  const version = typeof manifest.version === "string" ? manifest.version : "";
  return {
    name,
    version,
    isScoped: name.startsWith("@"),
    // npm 把 scoped 包装成 `node_modules/@scope/name`。注意这与 **tarball 文件名**
    // 的规则不同：文件名是 `scope-name-1.0.0.tgz`，**不带前导 `@`**（见
    // `pack-contents-boundary.mts#tarballBasename`）。两处规则不一致是 npm 的既有行为。
    installedDirName: name,
  };
}

/** ESM 导入说明符（`@mangax/bmap-vue` / `@mangax/bmap-vue/ui-kit`）。 */
export function importSpecifier(identity: ReleaseIdentity, subpath = ""): string {
  return `${identity.name}${subpath}`;
}

/**
 * `.artifacts` 下**属于该身份**的 tarball 文件名。
 *
 * 判据是 **name + version 精确匹配**，不是「同包名前缀」。
 *
 * ⚠️ 前缀匹配会认错包：`.artifacts` 里同时存在 `mangax-bmap-vue-1.0.0-rc.0.tgz` 与
 * `mangax-bmap-vue-1.0.0-rc.9.tgz` 时，两边都命中，于是可能**验证了旧包**。
 *
 * 后面 `assertReleaseIdentity` 也拦不住：它只要求版本匹配同一条版本线，`1.0.0-rc.9`
 * 同样满足。
 *
 * #158 工作包 E 起，`pnpm pack:package` 会在打包前清掉 `.artifacts` 里旧的 `*.tgz` 与旧
 * 来源 sidecar，所以本地最常见的 `pnpm pack:package && pnpm verify:package` 不会留下别的
 * 版本线旧包；而**同名旧包**由 `tarball-identity.mts` 的来源记录（打包 commit vs 当前
 * HEAD）拦截。精确匹配仍是前提：它是「哪些文件算这个身份的包」的唯一判据。
 */
export function isOwnTarball(fileName: string, identity: ReleaseIdentity): boolean {
  return fileName === tarballBasename(identity.name, identity.version);
}

/**
 * npm 打包产物的文件名。
 *
 * ⚠️ scoped 包**不带前导 `@`**：实测 `npm pack` 对 `@mangax/bmap-vue@1.0.0-rc.0` 产出
 * 的是 `mangax-bmap-vue-1.0.0-rc.0.tgz`。
 *
 * 与 `installedDirName` 的规则**不一致**，那是 npm 的既有行为，两个都要各自钉住。
 */
export function tarballBasename(name: string, version: string): string {
  return `${name.replace(/^@/, "").replaceAll("/", "-")}-${version}.tgz`;
}
/**
 * `exports` 里**有运行时 JS 产物**的子路径。
 *
 * 「入口数 == dist 的 .d.ts 数」这条判据此前在两处各写一遍，两处都假设每个子路径都有
 * `import` 条件。`./volar` 打破了这个假设：它是**纯 `types` 出口**（一份供 IDE 读的
 * `GlobalComponents` 声明，运行时不 import 它），因此没有 dist 产物。
 *
 * `./styles.css` 是**第二个**打破假设的出口（#189）：它是纯样式资源出口
 * （`"./styles.css": "./dist/bmap-vue.css"`），既没有 `import` 条件、也不该有假 `.d.ts`。
 * 它与 `./volar` 的差别正是判据要在意的：一个指向资源，一个指向声明。
 *
 * 因此判据收窄为「spec 最终解析到 `.mjs` 运行时产物」，而不是「有 `import` 条件」或
 * 「包内字符串目标」——后两者会把资源出口也算成入口，得出「dist 少了两个入口」这种误判。
 * 集中在这里是为了让它只被推导一次——两处各判一次，早晚有一处忘记排除。
 */
export function runtimeExportSubpaths(exportsField: unknown): string[] {
  if (!exportsField || typeof exportsField !== "object") return [];
  return Object.entries(exportsField as Record<string, unknown>)
    .filter(([subpath]) => subpath !== "./package.json")
    .filter(([, spec]) => exportTargetsOf(spec).some((target) => target.endsWith(".mjs")))
    .map(([subpath]) => subpath)
    .sort();
}

/** 一个 `exports` 条目的全部字符串叶子（条件对象递归下钻）。 */
function exportTargetsOf(spec: unknown): string[] {
  if (typeof spec === "string") return [spec];
  if (spec && typeof spec === "object") {
    return Object.values(spec as Record<string, unknown>).flatMap(exportTargetsOf);
  }
  return [];
}
