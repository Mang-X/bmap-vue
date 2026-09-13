/**
 * 生产源码不得访问 SDK 私有面（R25-C / issue #72 验收标准第 1 条）
 *
 * 背景：`normalize/jsonpProbe.ts` 曾经通过扫 `_rd` 回调注册表、把注册进去的回调换成包装器来
 * 还原服务端错误码（「空结果 vs 失败」的判定）。这条路径依赖 SDK 未公开的内部实现，官方随时
 * 可以改；ADR `2026-09-13-official-first-loader-and-ui-kit` 的决策 9 已经冻结「本库源码不得
 * 访问 `_rd` / `qt=` / `getSeckeyAndSign` 之类的私有面，缺什么能力就按 Capability Catalog 标
 * `unsupported` / `unverified`」，#72 把它落成删除 + 门禁。
 *
 * 这份用例保护的是「没有被重新加回来」：
 *
 * - 只扫**生产源码**（`packages/baidu-map-gl-vue/src/**` 去掉 `*.test.ts`）——测试里允许出现
 *   `_rd`（正证守卫、Fake 替身都需要）；
 * - 匹配的是**访问形态**（`x._rd` / `x["_rd"]` / `"_rd":`），不是裸露的字符串：注释里写
 *   「不嗅探 `_rd`」是允许的，把它读出来才不允许；
 * - 自带**正证守卫**：先把植入的样例喂给同一个匹配器，确认它真的会响；再断言扫描到的文件数
 *   是合理的（不是 0 个文件 ⇒ 恒真）。
 *
 * 为什么不是接进 `check-raw-sdk`：那个门禁带目录白名单（`driver/**` 放行），而私有面规则恰恰
 * 必须在 `driver/**` 里也成立——同一份白名单表达不了「两条规则、两套作用域」。放进行为测试既
 * 保留了精确语义，也不用为了一个新规则去改边界模块的数据结构。
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(import.meta.dirname, "../../packages/baidu-map-gl-vue/src");

/** 私有面：命中即「本库在靠 SDK 内部实现补齐能力」。 */
const PRIVATE_SURFACES = [
  { name: "_rd", reason: "JSONP 私有回调注册表（服务端错误码只在这里出现）" },
  { name: "getSeckeyAndSign", reason: "官方 UI Kit 使用的私有签名入口" },
] as const;

/** 访问形态：`x._rd` / `x._rd;` / `x["_rd"]` / `x['_rd']` / `{ "_rd": … }`。 */
function accessPatterns(name: string): RegExp[] {
  const quoted = `["'\`]${name}["'\`]`;
  return [
    // 属性访问：`sdk._rd`（不匹配注释里的 `_rd`——它前面不是 `.`）
    new RegExp(`\\.\\s*${name}\\b`),
    // 计算访问：`sdk["_rd"]`
    new RegExp(`\\[\\s*${quoted}\\s*\\]`),
    // 对象字面量的键：`{ "_rd": … }`（自建一份私有表）
    new RegExp(`${quoted}\\s*:`),
  ];
}

/** 返回命中项（`文件: 私有面`），干净源码返回空数组。 */
function findPrivateSurfaceUsages(source: string): string[] {
  const hits: string[] = [];
  for (const surface of PRIVATE_SURFACES) {
    if (accessPatterns(surface.name).some((pattern) => pattern.test(source))) hits.push(surface.name);
  }
  return hits;
}

function productionSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...productionSources(full));
      continue;
    }
    if (!/\.(ts|mts|vue)$/.test(entry)) continue;
    if (/\.test\.ts$/.test(entry)) continue;
    files.push(full);
  }
  return files;
}

describe("生产源码不访问 SDK 私有面（R25-C / #72）", () => {
  it("匹配器本身会响：植入的三种访问形态都被抓到", () => {
    // 正证守卫：没有这一条，正则写错（例如漏了转义）会让下面的扫描恒真通过
    expect(findPrivateSurfaceUsages("const table = (sdk as any)._rd;")).toEqual(["_rd"]);
    expect(findPrivateSurfaceUsages('const table = (sdk as any)["_rd"];')).toEqual(["_rd"]);
    expect(findPrivateSurfaceUsages('const registry = { "_rd": {} };')).toEqual(["_rd"]);
    expect(findPrivateSurfaceUsages("const sign = sdk.getSeckeyAndSign(url);")).toEqual([
      "getSeckeyAndSign",
    ]);
  });

  it("匹配器不误报：prose 里的 `` `_rd` `` 与别的私有前缀都不算命中", () => {
    // 注释里说明「不去嗅探」是这套门禁自己的文档，必须允许
    expect(findPrivateSurfaceUsages("// 本库不访问 `_rd` 之类的私有面")).toEqual([]);
    expect(findPrivateSurfaceUsages('const key = "getSeckey";')).toEqual([]);
    expect(findPrivateSurfaceUsages("const rd = sdk.guard;")).toEqual([]);
  });

  it("`packages/baidu-map-gl-vue/src/**` 的生产文件里一处都没有", () => {
    const files = productionSources(SRC);
    // 防空转：文件数为 0（路径写错、递归失效）时下面的断言会「因为没有文件而通过」
    expect(files.length, `扫描到的生产文件数异常偏少（${files.length}）`).toBeGreaterThan(100);

    const violations: string[] = [];
    for (const file of files) {
      const hits = findPrivateSurfaceUsages(readFileSync(file, "utf8"));
      for (const hit of hits) {
        const reason = PRIVATE_SURFACES.find((surface) => surface.name === hit)?.reason ?? "";
        violations.push(`${file.slice(SRC.length + 1)} → ${hit}（${reason}）`);
      }
    }
    expect(violations, `生产源码不得访问私有 SDK 面：\n${violations.join("\n")}`).toEqual([]);
  });
});
