/**
 * 插件兼容 inventory 契约测试（M3A3-07 / issue #25）
 *
 * 这份清单要能替代 catalog 里原来那句「迁移结论待定（M8）」——也就是读者打开文档就能知道
 * **已经查过什么、依据是哪一档、还差什么**。因此这里钉住四类东西：
 *
 * 1. **数据 ↔ 生成物 ↔ URL 单一事实源三者不漂移**（含脚本 `--check` 实跑）；
 * 2. **能力与清单互锁**：catalog 里标了 `unsupported` 的插件类能力必须在这里有依据，
 *    反向也不能凭空声明一个不存在的能力；
 * 3. **依据不许留空**：每条结论至少一档依据；写了 `incompatible` 就必须给出决定性的私有面；
 * 4. **隔离是真的**（本文件里唯一一条行为断言）：可选插件失败只发 `plugin:error`，不抛；
 *    必需插件失败才抛。**正证与反证在同一个用例内**——否则「隔离成立」可能只是没跑到。
 *
 * 另外把「这条门禁真的被某个 workflow 的 `run:` 跑起来」也钉住：`generate:plugin-inventory:check`
 * 曾经在别的 PR 里出现过「文档说进门禁、其实没有任何 job 跑它」的情况（#74 实测）。
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BUILTIN_PLUGIN_URLS,
  geoUtilsPlugin,
  PLUGIN_COMPAT_INVENTORY,
  stringToPluginDefinitions,
} from "../../packages/baidu-map-gl-vue/src/plugins";
import { CAPABILITY_CATALOG } from "../../packages/baidu-map-gl-vue/src/driver/capability";
import { createPluginRegistry } from "../../packages/baidu-map-gl-vue/src/core/plugins/PluginRegistry";
import { ResourceScope } from "../../packages/baidu-map-gl-vue/src/core/lifecycle/ResourceScope";

const ROOT = resolve(import.meta.dirname, "../..");
const DOC_MD = resolve(ROOT, "docs/zh-CN/contributing/plugin-compat-inventory.md");
const DOC_JSON = resolve(ROOT, "docs/.vitepress/plugin-inventory.json");
const WORKFLOW = resolve(ROOT, ".github/workflows/quality.yml");

const ENTRIES = PLUGIN_COMPAT_INVENTORY;

describe("生成物与数据同源", () => {
  it("生成器 --check 无漂移（文档确实来自数据模块）", () => {
    const script = resolve(ROOT, "scripts/generate-plugin-inventory.mts");
    expect(() =>
      execFileSync(process.execPath, ["--experimental-strip-types", script, "--check"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ).not.toThrow();
  });

  it("生成产物存在、带 Generated 标记、且逐个包含四个插件", () => {
    expect(existsSync(DOC_MD)).toBe(true);
    expect(existsSync(DOC_JSON)).toBe(true);

    const markdown = readFileSync(DOC_MD, "utf8");
    expect(markdown).toContain("Generated file. Do not edit directly.");
    for (const entry of ENTRIES) {
      expect(markdown, `清单缺少 ${entry.id}`).toContain(`\`${entry.id}\``);
    }

    const json = JSON.parse(readFileSync(DOC_JSON, "utf8")) as {
      plugins: { id: string; url: string | null }[];
    };
    expect(json.plugins.map((p) => p.id).sort()).toEqual(ENTRIES.map((e) => e.id).sort());
    expect(json.plugins.every((p) => typeof p.url === "string" && p.url.startsWith("https://"))).toBe(
      true,
    );
  });

  it("urlKey 集合与 BUILTIN_PLUGIN_URLS 的键集合相等（URL 只有一份事实源）", () => {
    const inventoryKeys = new Set(ENTRIES.map((entry) => entry.urlKey));
    const builtinKeys = new Set(Object.keys(BUILTIN_PLUGIN_URLS));
    expect([...inventoryKeys].sort()).toEqual([...builtinKeys].sort());
    // 先证明两边都非空，否则上一条会在「两个空集合」上恒真
    expect(builtinKeys.size).toBe(4);
  });

  it("锁定的 URL 不含浮动版本（不许出现 latest / next / *）", () => {
    for (const url of Object.values(BUILTIN_PLUGIN_URLS)) {
      expect(url, `${url} 用了浮动版本`).not.toMatch(/latest|@next|\*/);
      expect(url).toMatch(/^https:\/\//);
    }
  });
});

describe("依据与结论不留空", () => {
  it("每条至少一档依据，且没有未定义的依据名", () => {
    const known = new Set(["artifact", "declaration", "runtime"]);
    for (const entry of ENTRIES) {
      expect(entry.basis.length, `${entry.id} 没有依据`).toBeGreaterThan(0);
      for (const basis of entry.basis) {
        expect(known.has(basis), `${entry.id} 依据名未定义：${basis}`).toBe(true);
      }
    }
  });

  it("声明面结论必须有 artifact + declaration 两档依据", () => {
    for (const entry of ENTRIES) {
      if (entry.verdict === "no-declaration-gap" || entry.verdict === "incompatible") {
        expect(entry.basis, `${entry.id} 的结论强于依据`).toContain("artifact");
        expect(entry.basis, `${entry.id} 的结论强于依据`).toContain("declaration");
      }
    }
  });

  it("标 incompatible 必须给出决定性依据（正证与反证共用同一条判定）", () => {
    // 判定写成纯谓词：反证必须走**同一条**规则，否则「反证」只是在断言两个字面量。
    // 决定性依据有**两种**合法形态：引用了命名空间级私有面，或运行时直接抛错。
    type Decisive = {
      id: string;
      verdict: string;
      hasPrivateSurface: boolean;
      runtime?: { status: string };
    };
    const violatesDecisiveEvidenceRule = (entry: Decisive): boolean =>
      entry.verdict === "incompatible" &&
      !entry.hasPrivateSurface &&
      entry.runtime?.status !== "threw";

    for (const entry of ENTRIES) {
      expect(
        violatesDecisiveEvidenceRule(entry),
        `${entry.id} 说不兼容，却既没引用私有面、也没有运行时抛错`,
      ).toBe(false);
    }

    // 反证：两条都不能缺 —— 同一条谓词喂进三种假数据，判定必须分别为 违规/合规/合规
    expect(
      violatesDecisiveEvidenceRule({ id: "Bogus", verdict: "incompatible", hasPrivateSurface: false }),
    ).toBe(true);
    expect(
      violatesDecisiveEvidenceRule({ id: "Bogus2", verdict: "incompatible", hasPrivateSurface: true }),
    ).toBe(false);
    expect(
      violatesDecisiveEvidenceRule({
        id: "Bogus3",
        verdict: "incompatible",
        hasPrivateSurface: false,
        runtime: { status: "threw" },
      }),
    ).toBe(false);
  });

  it("成员核对分两层：命名空间级自动、实例成员人工（形态 + 渲染都锁住）", () => {
    for (const entry of ENTRIES) {
      // 命名空间级成员名里不该出现 `#`（那是实例成员的写法）
      expect(
        entry.sdkNamespaceMembers.every((name) => !name.includes("#")),
        `${entry.id} 的 sdkNamespaceMembers 混进了实例成员写法`,
      ).toBe(true);
      for (const member of entry.manualInstanceChecks) {
        expect(member, `${entry.id} 的实例成员要写成 Owner#member`).toMatch(
          /^[A-Za-z][A-Za-z0-9]*#[A-Za-z][A-Za-z0-9]*$/,
        );
      }
    }
    // 先证明这条断言不是空转：至少有一条真的有人工清单
    expect(ENTRIES.some((entry) => entry.manualInstanceChecks.length > 0)).toBe(true);

    // 生成物必须把「自动只到命名空间级」写清楚，并且不再钉死上游版本号
    const markdown = readFileSync(DOC_MD, "utf8");
    expect(markdown).toContain("成员核对");
    expect(markdown).toContain("不在自动门禁内");
    expect(markdown, "生成物不该钉死上游版本（依赖升级即漂移）").not.toMatch(
      /@baidumap\/jsapi-v4-types@\d/,
    );
  });

  it("catalog 与 inventory 的运行时状态不得互相矛盾（评审 #85 P2-3）", () => {
    let checked = 0;
    for (const entry of ENTRIES) {
      if (!entry.capability) continue;
      const description = CAPABILITY_CATALOG[entry.capability].description;
      if (entry.runtime?.status === "verified") {
        checked += 1;
        expect(description, `${entry.capability} 仍写着「运行时未验证」`).not.toContain(
          "运行时未验证",
        );
        expect(description, `${entry.capability} 未写明最小运行时路径已跑通`).toContain(
          "最小运行时路径已验证",
        );
      }
    }
    // 空转守卫：至少真的比对过一条（否则「没有矛盾」可能只是没比）
    expect(checked).toBeGreaterThan(0);
  });

  it("配置页的插件状态表与 inventory 不矛盾（评审 #85 第二轮 P2）", () => {
    const doc = readFileSync(resolve(ROOT, "docs/zh-CN/guide/config.md"), "utf8");
    const ids = new Set<string>(ENTRIES.map((entry) => entry.id));
    const rows = new Map<string, string>();
    for (const line of doc.split("\n")) {
      const match = /^\|\s*\[([A-Za-z]+)\]\(/.exec(line);
      if (match && ids.has(match[1]!)) rows.set(match[1]!, line);
    }
    // 空转守卫：四个插件在配置页都必须有行（删了行也不能绕过检查）
    expect([...rows.keys()].sort()).toEqual([...ids].sort());

    for (const entry of ENTRIES) {
      const row = rows.get(entry.id)!;
      if (entry.runtime?.status === "verified") {
        expect(row, `${entry.id} 的配置页行还写着「运行时未验证」`).not.toContain("运行时未验证");
        expect(row, `${entry.id} 的配置页行未写明最小运行时路径已验证`).toContain(
          "最小运行时路径已验证",
        );
      }
      if (entry.verdict === "incompatible") {
        expect(row, `${entry.id} 判不兼容，配置页却没说`).toContain("不兼容");
      } else {
        expect(row, `${entry.id} 不是 incompatible，配置页却说「不兼容」`).not.toContain("不兼容");
      }
    }
  });

  it("TrackAnimation 不向用户承诺 hook（#104：v4 上没有可运行的实现，状态机已删除）", () => {
    const trackAnimation = ENTRIES.find((entry) => entry.id === "TrackAnimation")!;
    // inventory 的运行时读数仍然成立：插件本身最小路径验证过，只是本库不装配
    expect(trackAnimation.runtime?.status).toBe("verified");
    expect(existsSync(resolve(ROOT, "docs/zh-CN/hooks/useBMapTrackAnimation.md"))).toBe(false);
  });

  it("runtime 读数与 `basis` 里的 runtime 档双向一致，且读数不是一句话", () => {
    const withRuntime = ENTRIES.filter((entry) => entry.runtime !== undefined);
    // 先证明这条断言不是空转：清单里确实有运行时读数
    expect(withRuntime.length).toBeGreaterThan(0);

    for (const entry of ENTRIES) {
      const declared = entry.basis.includes("runtime");
      expect(declared, `${entry.id} 的 runtime 档与读数不一致`).toBe(entry.runtime !== undefined);
      if (entry.runtime) {
        expect(["verified", "threw"]).toContain(entry.runtime.status);
        expect(entry.runtime.detail.length, `${entry.id} 的运行时读数过短（要求写出实测读数）`)
          .toBeGreaterThan(30);
      }
    }
  });

  it("每条都写清残余风险（不许只写「存在风险」四个字）", () => {
    for (const entry of ENTRIES) {
      expect(entry.residualRisks.length, `${entry.id} 没有残余风险条目`).toBeGreaterThan(0);
      for (const risk of entry.residualRisks) {
        expect(risk.length, `${entry.id} 的残余风险过短`).toBeGreaterThan(10);
      }
    }
  });

  it("内置插件一律 optional（必需功能不依赖插件脚本）", () => {
    for (const entry of ENTRIES) {
      expect(entry.required, `${entry.id} 应为 optional`).toBe(false);
    }
  });
});

describe("与 Capability Catalog 双向互锁", () => {
  it("清单声明的能力都真实存在于 Catalog", () => {
    for (const entry of ENTRIES) {
      if (!entry.capability) continue;
      expect(
        Object.prototype.hasOwnProperty.call(CAPABILITY_CATALOG, entry.capability),
        `${entry.id} 声明了不存在的能力 ${entry.capability}`,
      ).toBe(true);
    }
  });

  it("Catalog 标 unsupported 的插件类能力必须在清单里有依据，且说明指向清单", () => {
    const pluginCapabilities = Object.values(CAPABILITY_CATALOG).filter(
      (descriptor) =>
        descriptor.status === "unsupported" &&
        (descriptor.id.endsWith(".mapvgl") || descriptor.id.endsWith(".track-animation")),
    );
    // 先证明这条断言不是空转：Catalog 里确实有这类能力
    expect(pluginCapabilities.length).toBeGreaterThan(0);

    for (const descriptor of pluginCapabilities) {
      const entry = ENTRIES.find((candidate) => candidate.capability === descriptor.id);
      expect(entry, `Catalog 标了 ${descriptor.id} 为 unsupported，但清单里没有依据`).toBeDefined();
      // 说明文字必须指向这份清单，而不是继续写「结论待定」
      expect(descriptor.description).not.toContain("待定");
      expect(descriptor.description).toContain("plugin-compat-inventory");
    }
  });

  it("清单判 incompatible 的能力，Catalog 也必须是 unsupported（反向也不许矛盾）", () => {
    const incompatible = ENTRIES.filter((entry) => entry.verdict === "incompatible");
    // 先证明这条断言不是空转：清单里确实有 incompatible 条目
    expect(incompatible.length).toBeGreaterThan(0);

    for (const entry of incompatible) {
      expect(entry.capability, `${entry.id} 判不兼容却没有关联能力`).toBeDefined();
      const descriptor = CAPABILITY_CATALOG[entry.capability!];
      expect(descriptor, `${entry.id} 关联的能力不存在`).toBeDefined();
      expect(descriptor.status, `${entry.id} 判不兼容，Catalog 却仍标 ${descriptor.status}`).toBe(
        "unsupported",
      );
    }
  });

  it("清单里的每个 id 都解析得出 definition（且作用域是脚本插件的 `global`）", () => {
    // M8-PLUGIN-CORE（#42）之后，**函数同一性**这条更强的判据搬到了
    // `src/plugins/catalog.test.ts`（`BUILTIN_PLUGIN_CATALOG[name].create === trackAnimationPlugin`）。
    // 这里保留与 inventory 的那半条：清单里的 id 必须都能被解析，且内置插件都是 global 脚本插件 ——
    // 只断言 name/required 是不够的（真工厂与「同名同 required 的别的实现」在这两项上一样）。
    const defs = stringToPluginDefinitions(ENTRIES.map((entry) => entry.id));
    for (const def of defs) {
      expect(def.scope, `${def.name} 是脚本插件，作用域必须是 global`).toBe("global");
    }
    for (const def of defs) expect(typeof def.load).toBe("function");

    // GeoUtils 此前只有 URL、没有工厂，也没有名字表条目 —— 这条防止再退回去
    expect(geoUtilsPlugin().scope).toBe("global");
    expect(geoUtilsPlugin().name).toBe("GeoUtils");
  });
});

describe("可选插件故障与必需功能隔离", () => {
  const makeContext = () => ({ client: null, map: null, api: {} });

  it("optional 插件失败不抛、只发 plugin:error；required 插件失败才抛（同一用例内正证 + 反证）", async () => {
    const boom = new Error("plugin script unavailable");

    // 反证（已证伪的那一半）：把同一个失败插件标成 required，它必须抛。
    // 没有这一半，「optional 不抛」可能只是因为失败根本没被观察到。
    const requiredRegistry = createPluginRegistry(
      makeContext(),
      { emit: () => {} },
      new ResourceScope(),
    );
    requiredRegistry.register({
      name: "RequiredFail",
      required: true,
      load: async () => {
        throw boom;
      },
    });
    await expect(requiredRegistry.whenPlugin("RequiredFail")).rejects.toBe(boom);

    // 正证：内置插件用的形态（required 缺省 = optional）必须只发事件、不抛。
    const events: { type: string; payload: unknown }[] = [];
    const optionalRegistry = createPluginRegistry(
      makeContext(),
      {
        emit: (type, payload) => {
          events.push({ type, payload });
        },
      },
      new ResourceScope(),
    );
    optionalRegistry.register({
      name: "OptionalFail",
      required: false,
      load: async () => {
        throw boom;
      },
    });

    // M8-PLUGIN-CORE（#42）：optional 失败以 **`null`** resolve。
    // 用 `undefined` 表达失败会与「void 插件（合法地 load 出 undefined）」撞车（评审 #85 P1-2）。
    await expect(optionalRegistry.whenPlugin("OptionalFail")).resolves.toBeNull();
    expect(optionalRegistry.getStatus("OptionalFail")).toBe("error");
    // 这里只锁「发的是 plugin:error」与「带的是同一个错误对象」，次数留给
    // `PluginRegistry.test.ts`（那里断言恰好一次）。两处都锁会让无关的实现调整制造双重红。
    expect(new Set(events.map((e) => e.type))).toEqual(new Set(["plugin:error"]));
    expect(events.length).toBeGreaterThan(0);
    expect((events[0]!.payload as { error: unknown }).error).toBe(boom);
  });

  it("四个内置插件在注册表里的失败都不阻断（用真实名字表 + 被打桩的加载）", async () => {
    const registry = createPluginRegistry(
      makeContext(),
      { emit: () => {} },
      new ResourceScope(),
    );
    // 走 `stringToPluginDefinitions`：它同时验证「名字表认得这四个插件」，而不只是
    // 「工厂单独可用」——此前 GeoUtils 有 URL 却没有名字表条目，会被静默当成未知插件。
    const definitions = stringToPluginDefinitions(ENTRIES.map((entry) => entry.id));
    expect(definitions.length).toBe(4);
    expect(definitions.map((d) => d.name)).toEqual(ENTRIES.map((entry) => entry.id));
    for (const def of definitions) {
      registry.register({
        ...def,
        load: async () => {
          throw new Error("boom");
        },
      });
    }
    for (const def of definitions) {
      await expect(registry.whenPlugin(def.name)).resolves.toBeNull();
      expect(registry.getStatus(def.name)).toBe("error");
    }
  });
});

describe("门禁真的被 workflow 跑起来", () => {
  it("quality job 里有一条未被架空的 run: generate-plugin-inventory --check", () => {
    const lines = readFileSync(WORKFLOW, "utf8").split(/\r?\n/);
    const start = lines.findIndex((line) => line === "  quality:");
    expect(start, "找不到 quality job 段").toBeGreaterThanOrEqual(0);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
      if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i]!)) {
        end = i;
        break;
      }
    }
    const job = lines.slice(start, end);

    // 定位式只写一次，正证与反证共用它 —— 否则「反证」可能只是在断言另一条更严的正则
    const locateCheckRun = (lines: readonly string[]): number =>
      lines.findIndex((line) =>
        /^\s*run:\s*.*scripts\/generate-plugin-inventory\.mts --check/.test(line),
      );

    const runIndex = locateCheckRun(job);
    expect(runIndex, "quality job 里没有跑 plugin-inventory 的 --check").toBeGreaterThanOrEqual(0);

    // 该 step 不得被 if / continue-on-error 架空：往上找最近的 `- name:`
    let stepStart = runIndex;
    while (stepStart > 0 && !/^\s*- /.test(job[stepStart]!)) stepStart -= 1;
    const stepLines = job.slice(stepStart, runIndex);
    // 切片非空：切空的话下面的 filter 也是 []，`toEqual([])` 会恒过
    expect(stepLines.length, "没有切出 step 区块，架空检查无从判断").toBeGreaterThan(0);
    // 切片确实从 step 边界开始（`- name:` / `- uses:` 那一行），不是从文件开头切上来的
    expect(stepLines.some((line) => /^\s*-\s/.test(line))).toBe(true);
    const blockers = stepLines.filter((line) => /^\s*(if|continue-on-error):/.test(line));
    expect(blockers, "该 step 被开关架空").toEqual([]);

    // 反证：把同一个 job 文本里的 `--check` 换成 `--nope`，**同一条定位式**必须找不到
    const renamed = job.map((line) => line.replace("--check", "--nope"));
    expect(locateCheckRun(renamed)).toBe(-1);
  });

  it("nightly 里有一条未被架空的 run: probe:plugin-compat（真实产物核对有归属）", () => {
    const nightly = resolve(ROOT, ".github/workflows/nightly-v4-smoke.yml");
    const lines = readFileSync(nightly, "utf8").split(/\r?\n/);
    const runIndex = lines.findIndex((line) =>
      /^\s*run:\s*.*probe:plugin-compat/.test(line),
    );
    expect(runIndex, "nightly 里没有跑 probe:plugin-compat").toBeGreaterThanOrEqual(0);

    // 往前找该 step 的起点，断言它没有被 if / continue-on-error 架空
    let stepStart = runIndex;
    while (stepStart > 0 && !/^\s*- /.test(lines[stepStart]!)) stepStart -= 1;
    const stepLines = lines.slice(stepStart, runIndex);
    expect(stepLines.length, "没有切出 step 区块，架空检查无从判断").toBeGreaterThan(0);
    expect(stepLines.some((line) => /^\s*-\s/.test(line))).toBe(true);
    expect(stepLines.filter((line) => /^\s*(if|continue-on-error):/.test(line))).toEqual([]);

    // 反证：同一文件里必须存在一条**会**被架空的 step，证明上面的过滤器不是恒空
    // （`Upload` 的 `if: always()` 是 upload-artifact 的正常用法，与门禁判定无关）
    const alwaysIndex = lines.findIndex((line) => /^\s*if: always\(\)/.test(line));
    expect(alwaysIndex, "夹具里应当存在一条带 if 的 step，否则上一条断言可能只是没扫到")
      .toBeGreaterThanOrEqual(0);
  });
});

describe("文档承诺的命令真的存在（防空口承诺）", () => {
  it("inventory 文档里出现的每条 `pnpm <script>` 都能在根 package.json 里找到", () => {
    const markdown = readFileSync(DOC_MD, "utf8");
    const scripts = (
      JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
        scripts: Record<string, string>;
      }
    ).scripts;

    const mentioned = [...markdown.matchAll(/pnpm\s+([a-z][\w:-]*)/g)].map((m) => m[1]!);
    // 先证明这条断言不是空转：文档里确实提到了命令
    expect(mentioned.length).toBeGreaterThan(0);
    for (const name of new Set(mentioned)) {
      expect(scripts[name], `文档提到的 \`pnpm ${name}\` 在 package.json 里不存在`).toBeDefined();
    }
  });

  it("清单源码里指向的 ADR 都在仓库里，且不再指向已删除的 legacy 声明面", () => {
    const sourceFile = resolve(
      ROOT,
      "packages/baidu-map-gl-vue/src/plugins/compat-inventory.ts",
    );
    const source = readFileSync(sourceFile, "utf8");
    const mentioned = [
      "docs/adr/2026-09-13-plugin-compat-inventory.md",
      "docs/adr/2026-09-13-private-sdk-surface-removal.md",
    ];
    for (const path of mentioned) {
      // 先证明这条断言真的在检查东西：文件名主干确实在源码里被提到。
      // 比对主干（去掉 .md）是因为源码里引用 ADR 时本来就不写扩展名。
      const marker = path.split("/").pop()!.replace(/\.md$/, "");
      expect(source, `清单源码没有指向 ${marker}`).toContain(marker);
      expect(existsSync(resolve(ROOT, path)), `${path} 不存在`).toBe(true);
    }

    // M3A3-REMOVE-LEGACY（#26）：`types/BMapGL` 已删除，清单不能再把它当成现存文件引用。
    // 正证守卫：那句话本身还在（只是改成历史表述），否则下面这条负向断言可能恒真。
    expect(source, "GeoUtils 的声明面差异应当继续被记录").toContain("BMapGLLib.GeoUtils");
    expect(source).not.toContain("types/BMapGL/");
  });
});
