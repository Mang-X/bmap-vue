/**
 * 子入口声明自指改写（#160）—— 纯函数契约
 *
 * 背景：`vue-tsc` 的声明 emit 对「从子入口 barrel 转出、自身不在本子目录声明」的符号写
 * `import("..").X`，`unplugin-dts` 之后把它提升成静态顶层导入
 * `import { … } from '..';`。这里的 `..` 指向的正是**本子入口自己的**声明文件，于是同一批
 * 符号同时以「rollup 根」和「被引用的模块」两种身份进入 API Extractor，触发
 * `_makeUniqueNames()` 判重，把整张类型图复制一遍（实测 114 个）。`vite.config.build.ts`
 * 的 `rewriteEntrySelfReExports()` 把它改写回真正的声明处。
 *
 * ## 为什么要单测这个（#160 评审 P2）
 *
 * 判「是不是在 dist 的**子目录**里」最初写成 `filePath.slice(dir.length + 1).includes('/')`。
 * Node 在 Windows 上给出的 `filePath` 用**反斜杠**，那一步恒为 false —— 整段改写静默
 * 不生效，也就是**这票最关键的那个修好在 Windows 构建上等于没做**。CI 是 Linux，
 * 全绿完全覆盖不到这一支。
 *
 * 所以这里显式喂 Windows 风格路径。`isInsideSubdirectory` 因此**不能**用
 * `path.relative` / `path.sep`：那两个是平台相关的，在 POSIX 上处理不了反斜杠路径。
 */
import { describe, expect, it } from "vitest";
import {
  isInsideSubdirectory,
  rewriteEntrySelfReExports,
} from "../../packages/bmap-vue/vite.config.build";

const DIST_POSIX = "/repo/packages/bmap-vue/dist";
const DIST_WINDOWS = "C:\\repo\\packages\\bmap-vue\\dist";

describe("isInsideSubdirectory（平台无关，#160 评审 P2）", () => {
  it("POSIX 与 Windows 两种风格给出**同一**结论", () => {
    for (const dir of [DIST_POSIX, DIST_WINDOWS]) {
      const sep = dir.includes("\\") ? "\\" : "/";
      const join = (...parts: string[]): string =>
        dir.endsWith(sep) ? `${dir}${parts.join(sep)}` : `${dir}${sep}${parts.join(sep)}`;
      // 子目录里的文件：正是要改写的那一类
      expect(isInsideSubdirectory(dir, join("composables", "useMap.d.ts"))).toBe(true);
      // 更深的嵌套同样算子目录
      expect(isInsideSubdirectory(dir, join("integrations", "ui-kit", "index.d.ts"))).toBe(true);
      // 入口自身在 dist 顶层：不算
      expect(isInsideSubdirectory(dir, join("composables.d.ts"))).toBe(false);
      expect(isInsideSubdirectory(dir, join("index.d.ts"))).toBe(false);
      // 完全不在 dist 下：不算。注意要**真的**造出 `..`（`resolve` 后的形态），
      // 而不是 `dist/../src` 这种带字面 `..` 段的形式 —— 那不是构建会传入的路径。
      const outsideDir = dir.replace(/dist$/, "src");
      expect(isInsideSubdirectory(dir, `${outsideDir}${sep}composables${sep}useMap.d.ts`)).toBe(false);
    }
  });

  it("正证：Windows 风格的子目录路径确实被认出来（否则上面整条恒假）", () => {
    expect(isInsideSubdirectory(DIST_WINDOWS, "C:\\repo\\packages\\bmap-vue\\dist\\composables\\useMap.d.ts")).toBe(true);
    // 反证：同形但目录名不同 —— 结论必须随目录变
    expect(isInsideSubdirectory(DIST_WINDOWS, "C:\\repo\\packages\\bmap-vue\\src\\composables\\useMap.d.ts")).toBe(false);
  });
});

describe("rewriteEntrySelfReExports（自指改写，#160）", () => {
  const nameToFile = new Map<string, string>([
    ["MapContext", `${DIST_POSIX}/core/context/types.d.ts`],
    ["MapHandle", `${DIST_POSIX}/driver/types/handles.d.ts`],
  ]);

  it("把静态自指换成指向真正声明处的相对 specifier", () => {
    const content = [
      "import { ComputedRef } from 'vue';",
      "import { MapContext, MapHandle } from '..';",
      "export declare function useMapContext(): MapContext;",
    ].join("\n");
    const out = rewriteEntrySelfReExports(
      content,
      `${DIST_POSIX}/composables/useMap.d.ts`,
      DIST_POSIX,
      new Map([
        ["MapContext", `${DIST_POSIX}/core/context/types.d.ts`],
        ["MapHandle", `${DIST_POSIX}/driver/types/handles.d.ts`],
      ]),
    );
    expect(out).toBeDefined();
    // 不再有指向入口自己的 `from '..'`
    expect(out).not.toMatch(/from ['"]\.\.['"]/);
    expect(out).toContain("../core/context/types");
    expect(out).toContain("../driver/types/handles");
    // 类型只导入就够（原来那批是 `import ".."` 被提升上来的运行时导入面）
    expect(out).toContain("import type { MapContext }");
  });

  it("解析不到声明位置时**原样保留**（宁可留一个可见的重复，也不改错目标）", () => {
    const content = "import { NotDeclaredAnywhere } from '..';\n";
    const out = rewriteEntrySelfReExports(
      content,
      `${DIST_POSIX}/composables/useMap.d.ts`,
      DIST_POSIX,
      nameToFile,
    );
    expect(out).toBeUndefined();
  });

  it("入口自身（dist 顶层）不动", () => {
    const content = "export * from './composables/index.js'\n";
    const out = rewriteEntrySelfReExports(content, `${DIST_POSIX}/composables.d.ts`, DIST_POSIX, nameToFile);
    expect(out).toBeUndefined();
  });
});
