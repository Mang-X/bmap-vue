/**
 * `./resolver` 与**真实目标插件**的类型契约（#221）
 *
 * ## 为什么需要它
 *
 * `BMapResolver()` 对外承诺「给 unplugin-vue-components 做组件自动导入」。此前
 * `ComponentResolverLike.type` 是**可选**（`type?`），而目标插件 `Options.resolvers` 要求
 * `ComponentResolverObject`（`type` **必填**）—— 于是消费者的标准写法
 * `Components({ resolvers: [BMapResolver()] })` 会被 TS 拒绝，**尽管运行时返回的对象带 `type`**。
 * 类型把可用的东西挡在门外，且**只对照本库声明面**（#220 那轮只核了生成表与 CI）看不出来。
 *
 * 所以这里用**真实插件的类型声明**（`unplugin-vue-components`，devDependency）做消费端编译，
 * 而不是拿一份本地复刻的上游形状 —— 复刻会随上游漂移。
 *
 * ## 判据（正反两侧）
 *
 * - **正证**：真实的 `Components({ resolvers: [BMapResolver()] })` 编译零诊断；
 * - **反例**：把 `type` 写回可选（旧形状）放在**同一个位置** → **必须报错**。没有这一条，
 *   一旦插件的 `resolvers` 退化成 `any`、或本库类型退回 `type?`，正证仍恒真。
 */
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const virtualFile = join(repoRoot, "tests/__resolver-consumer-probe__.ts");

const COMPILER_OPTIONS: ts.CompilerOptions = {
  noEmit: true,
  strict: true,
  // 只关心「本库声明能不能被这个插件消费」，不审上游声明内部。
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  lib: ["lib.es2020.d.ts", "lib.es2022.error.d.ts", "lib.dom.d.ts"],
  baseUrl: repoRoot,
  types: [],
};

/** 用一次性 Program 编译一段虚拟消费方源码，返回**落在虚拟文件上**的诊断行。 */
function diagnose(source: string): string[] {
  const host = ts.createCompilerHost(COMPILER_OPTIONS, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (file) => (resolve(file) === virtualFile ? source : readFile(file));
  host.fileExists = (file) => (resolve(file) === virtualFile ? true : fileExists(file));
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) =>
    resolve(file) === virtualFile
      ? ts.createSourceFile(file, source, languageVersion, true)
      : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);

  const program = ts.createProgram([virtualFile], COMPILER_OPTIONS, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName.startsWith(repoRoot))
    .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
}

/** 真实消费方写法：把本库 resolver 交给目标插件。 */
const REAL_USAGE = `
import Components from "unplugin-vue-components/vite";
import { BMapResolver } from "../packages/bmap-vue/src/resolver/index.ts";
Components({ resolvers: [BMapResolver()] });
export {};
`;

/** 反例：与修复前**同一个类型形状**（`type?` 可选），放在同一个位置。 */
const OLD_SHAPE_USAGE = `
import Components from "unplugin-vue-components/vite";
type OldResolverLike = {
  type?: "component" | "directive";
  resolve: (name: string) => { name: string; from: string } | undefined | void;
};
declare const old: OldResolverLike;
Components({ resolvers: [old] });
export {};
`;

describe("resolver · 与 unplugin-vue-components 的真实类型契约（#221）", () => {
  it("BMapResolver() 能作为 resolvers 传进真实插件（零诊断）", () => {
    expect(diagnose(REAL_USAGE), "本库 resolver 的公开类型与目标插件不兼容").toEqual([]);
  });

  it("判别力：type 写回可选（旧形状）在同一位置必须报错", () => {
    // 旧形状就是 #221 的缺陷形态。若这条不报错，说明「正证」没有判别力（插件侧或本库侧退化了）。
    expect(
      diagnose(OLD_SHAPE_USAGE),
      "旧形状（type?）竟然通过了 —— 这条正证不再证明任何东西",
    ).not.toEqual([]);
  });
});
