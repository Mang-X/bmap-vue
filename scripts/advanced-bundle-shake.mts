/**
 * 打包产物「有没有把不该带的东西带进来」的共用判据（M8-ADAPTERS-ADVANCED / issue #43）
 *
 * 两处用它，**判据只写一份**：
 *
 * - `tests/behavior/v3-advanced-contract.test.ts`：直接读仓库自己的 `packages/.../dist`，
 *   断言 `./advanced` 入口的静态 import 闭包不含组件 / 官方 UI Kit；
 * - `scripts/verify-package.mts`：在装了 **tarball** 的消费方 fixture 里用真实打包器
 *   （vite）各打一次「只用 `./advanced`」与「只用根入口」，断言前者的产物闭包不含组件标记、
 *   后者**必须**含 —— 后者是这条判据的**正证**（没有它，「闭包里没有组件」可能只是判据没生效）。
 *
 * 口径说明：这里的「组件标记」是 SFC 编译产物里稳定出现、而 driver/core 不会出现的字符串。
 * 用标记而不是文件名，是因为打包器会重命名 chunk。
 */

/** SFC 编译产物里稳定出现、driver/core/client 不会出现的标记。 */
export const COMPONENT_MARKERS: readonly string[] = [
  "defineComponent",
  "createElementBlock",
  "BInfoWindow",
  "BPlaceSearch",
];

/** 官方 UI Kit 的包名：`./advanced` 的闭包不得引用它（它是 optional peer，且 import 即碰 document）。 */
export const UI_KIT_SPECIFIER = "@baidumap/jsapi-ui-kit";

/** 读文件里的相对 / 裸说明符（静态 import 与动态 import 都算）。 */
export function importsOf(file: string, readFile: (file: string) => string): string[] {
  const source = readFile(file);
  const out: string[] = [];
  for (const match of source.matchAll(/from\s*["']([^"']+)["']/g)) out.push(match[1]);
  for (const match of source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) out.push(match[1]);
  return out;
}

export interface ImportClosure {
  /** 闭包内的文件（相对 `root` 的路径，已排序）。 */
  files: string[];
  /** 闭包外的说明符（`vue` / `@vueuse/core` / 官方 UI Kit……）。 */
  external: string[];
}

/**
 * 某个入口的 import 闭包。
 *
 * 只沿「解析得到、且仍在 `root` 之内」的说明符往下走；走不到的一律记进 `external`。
 * `resolve` / `existsSync` / `readFile` / `relative` 由调用方注入，这样浏览器外的 Node 脚本与
 * vitest 里的用例可以共用同一份实现而不必统一各自的路径风格。
 */
export function collectImportClosure(
  input: {
    root: string;
    entry: string;
    resolve: (from: string, specifier: string) => string;
    relative: (from: string, to: string) => string;
    exists: (file: string) => boolean;
    readFile: (file: string) => string;
  },
): ImportClosure {
  const files = new Set<string>();
  const external = new Set<string>();
  const stack = [input.entry];
  while (stack.length > 0) {
    const current = stack.pop()!
    if (files.has(current)) continue
    files.add(current)
    for (const specifier of importsOf(current, input.readFile)) {
      const target = input.resolve(current, specifier)
      if (target.startsWith(input.root) && input.exists(target)) stack.push(target)
      else external.add(specifier)
    }
  }
  return {
    files: [...files].map((file) => input.relative(input.root, file)).sort(),
    external: [...external].sort(),
  }
}

/** 闭包里出现了哪些组件标记（空数组 = 没有把组件打进来）。 */
export function componentMarkersIn(
  closure: ImportClosure,
  resolvePath: (relativeFile: string) => string,
  readFile: (file: string) => string,
): string[] {
  return COMPONENT_MARKERS.filter((marker) =>
    closure.files.some((file) => readFile(resolvePath(file)).includes(marker)),
  )
}
