import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  extractDeclareGlobalBlocks,
  stripDeclareGlobalBlocks,
} from "../../packages/bmap-vue/vite.config.build";

const augmentationsDir = resolve(
  import.meta.dirname,
  "../../packages/bmap-vue/src/driver/jsapi-v4/augmentations",
);

const augmentationFiles = readdirSync(augmentationsDir).filter((name) => name.endsWith(".d.ts"));
const primaryFile = resolve(augmentationsDir, "bmap-4.0.4-gaps.d.ts");

/**
 * 复刻 unplugin-dts 收集全局 augmentation 的方式：
 * `declareModules.push(s.slice(node.pos, node.end + 1))`，即块末尾只多带一个字符
 * （LF 文件为 `\n`，CRLF 文件为 `\r`），且块前会带上 `export {};` 之后的 trivia。
 */
function collectInlinedAugmentation(source: string, newline: "\n" | "\r\n"): string {
  const normalized = newline === "\n" ? source : source.replace(/\r?\n/g, "\r\n");
  const ast = ts.createSourceFile("augmentation.d.ts", normalized, ts.ScriptTarget.Latest, true);
  let collected = "";
  const visit = (node: ts.Node): void => {
    if (ts.isModuleDeclaration(node) && node.body && ts.isModuleBlock(node.body)) {
      if (ts.isIdentifier(node.name) && node.name.escapedText === "global") {
        collected += normalized.slice(node.pos, node.end + 1);
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(ast, visit);
  return collected;
}

describe("jsapi-v4 declaration augmentation filtering", () => {
  const lfSource = readFileSync(primaryFile, "utf8");

  it("augmentations 目录存在且包含声明文件", () => {
    expect(augmentationFiles.length).toBeGreaterThan(0);
    expect(readFileSync(resolve(augmentationsDir, "README.md"), "utf8")).toContain("@deletionCondition");
  });

  for (const [label, newline] of [
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ] as const) {
    it(`removes the augmentation inlined from a ${label} boundary file`, () => {
      const source = newline === "\n" ? lfSource : lfSource.replace(/\r?\n/g, "\r\n");
      const blocks = extractDeclareGlobalBlocks(source);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toContain("namespace BMap");
      expect(blocks[0].endsWith("}")).toBe(true);

      const inlined = collectInlinedAugmentation(lfSource, newline);
      expect(inlined).toContain("namespace BMap");

      const publicDts = `export declare const version: string\n${inlined}`;
      const stripped = stripDeclareGlobalBlocks(publicDts, blocks);

      expect(stripped).toBeDefined();
      expect(stripped).not.toContain("namespace BMap");
      expect(stripped).not.toContain("declare global");
      expect(stripped).toBe("export declare const version: string\n");
    });
  }

  it("leaves declaration output untouched when the augmentation is absent", () => {
    expect(stripDeclareGlobalBlocks("export declare const x: number\n", [])).toBeUndefined();
    expect(
      stripDeclareGlobalBlocks("export declare const x: number\n", ["declare global {}"]),
    ).toBeUndefined();
  });

  it("extracts and strips multiple declare-global blocks", () => {
    const source = [
      "export {};",
      "declare global {",
      "  namespace BMap {",
      "    interface A {}",
      "  }",
      "}",
      "declare global {",
      "  interface Window {",
      "    BMap?: unknown",
      "  }",
      "}",
      "",
    ].join("\n");
    const blocks = extractDeclareGlobalBlocks(source);
    expect(blocks).toHaveLength(2);
    const publicDts = `export declare const x: number\n${blocks.join("")}`;
    const stripped = stripDeclareGlobalBlocks(publicDts, blocks);
    expect(stripped).not.toContain("declare global");
    expect(stripped).toBe("export declare const x: number\n");
  });

  it("每个 augmentation 文件都声明在同一全局命名空间且不含 any", () => {
    for (const name of augmentationFiles) {
      const text = readFileSync(resolve(augmentationsDir, name), "utf8");
      expect(text, `${name} 应引用官方类型包`).toContain("@baidumap/jsapi-v4-types");
      const blocks = extractDeclareGlobalBlocks(text);
      expect(blocks.length, `${name} 应包含 declare global 块`).toBeGreaterThan(0);

      // 只看代码，注释中说明规则时提到 `any` 不应算违规
      const codeOnly = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(/\bany\b/.test(codeOnly), `${name} 不得使用 any`).toBe(false);

      for (const block of blocks) {
        expect(block).toContain("namespace BMap");
      }
    }
  });
});

describe("augmentation 删除治理元数据（issue #15）", () => {
  const REQUIRED_TAGS = [
    "@augmentation",
    "@upstream",
    "@upstreamVersion",
    "@runtimeBasis",
    "@deletionCondition",
    "@owner",
  ] as const;

  it("治理 README 提供字段模板与删除条件说明", () => {
    const readme = readFileSync(resolve(augmentationsDir, "README.md"), "utf8");
    for (const tag of REQUIRED_TAGS) {
      expect(readme, `README 应说明 ${tag}`).toContain(tag);
    }
    expect(readme).toContain("pnpm typecheck:package");
    expect(readme).toContain("pnpm check:public-dts");
  });

  for (const name of augmentationFiles) {
    it(`${name} 带齐上游版本 / 运行时依据 / 删除条件`, () => {
      const text = readFileSync(resolve(augmentationsDir, name), "utf8");
      for (const tag of REQUIRED_TAGS) {
        expect(text, `${name} 缺少 ${tag}`).toContain(tag);
      }

      // slug 与文件名一致，便于机械核对与删除
      const slug = `${name.replace(/\.d\.ts$/, "")}`;
      expect(text).toMatch(new RegExp(`@augmentation\\s+${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));

      // 精确版本锁定，禁止 caret / tilde
      const versionLine = text.split("\n").find((line) => line.includes("@upstreamVersion")) ?? "";
      expect(versionLine).toMatch(/@upstreamVersion\s+\d+\.\d+\.\d+\b/);
      expect(versionLine).not.toMatch(/[\^~]|\bx\b/i);
    });

    it(`${name} 只补类型、不引入运行时值`, () => {
      const text = readFileSync(resolve(augmentationsDir, name), "utf8");
      for (const block of extractDeclareGlobalBlocks(text)) {
        expect(block).not.toMatch(/\b(?:declare\s+)?(?:const|let|var|class|function|enum)\b/);
      }
    });
  }
});
