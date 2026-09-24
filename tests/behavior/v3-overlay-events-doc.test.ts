/**
 * 覆盖物事件矩阵 ↔ 文档镜像门禁（M5-VECTORS / issue #31）
 *
 * `docs/zh-CN/components/overlay/events.md` 是事件矩阵的**镜像**：用户看到的事件名、载荷档与说明
 * 必须与 `core/overlays/overlayEventCatalog.ts` 逐条一致。与 map 事件的做法相同
 * （`v3-map-event-catalog.test.ts` 对 `com-events.md` 的表格做同样的比对）——文档不是手抄件。
 *
 * 三条口径：
 * 1. 每个有矩阵的 kind 在文档里都要有一节，且**只有**这些 kind（多一节 = 表格里多了一个不存在的能力）；
 * 2. 每节的表格与矩阵**逐行相等**（Vue 名 / SDK 名 / 载荷档说明 / 说明文字）；
 * 3. 「上游没有事件表的种类」一节列出的 kind 与 `OVERLAY_KINDS_WITHOUT_EVENT_MATRIX` 相等。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OVERLAY_EVENT_MATRIX,
  OVERLAY_KINDS_WITHOUT_EVENT_MATRIX,
} from "../../packages/bmap-vue/src/core/overlays/overlayEventCatalog";
import {
  OVERLAY_EVENT_ALIASES,
  OVERLAY_PROP_ALIASES,
} from "../../packages/bmap-vue/src/core/deprecations";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const DOC_PATH = resolve(REPO_ROOT, "docs/zh-CN/components/overlay/events.md");
const MIGRATION_DOC_PATH = resolve(REPO_ROOT, "docs/zh-CN/guide/migration-from-v2.md");

/** 载荷档 → 文档里的说明文字（两处必须同时改）。 */
const PAYLOAD_TEXT: Record<string, string> = {
  pointer: "`point` 必填",
  "partial-pointer": "坐标可缺",
  base: "仅底座字段",
};

interface DocSection {
  readonly kind: string;
  readonly upstream: string;
  readonly count: number;
  readonly rows: Array<{ vue: string; sdk: string; payload: string; description: string }>;
}

function parseDoc(): { sections: DocSection[]; noEventKinds: string[] } {
  const text = readFileSync(DOC_PATH, "utf8");
  const sections: DocSection[] = [];
  const headingPattern = /^### `([\w-]+)`（上游 `([^`]+)`，(\d+) 个）$/gm;
  const matches = [...text.matchAll(headingPattern)];
  for (const [index, match] of matches.entries()) {
    const start = match.index! + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const body = text.slice(start, end);
    const rows = [...body.matchAll(/^\| `([^`]+)` \| `([^`]+)` \| ([^|]+?) \| (.+?) \|$/gm)].map(
      (row) => ({
        vue: row[1]!,
        sdk: row[2]!,
        payload: row[3]!.trim(),
        description: row[4]!.trim(),
      }),
    );
    sections.push({
      kind: match[1]!,
      upstream: match[2]!,
      count: Number(match[3]),
      rows,
    });
  }

  const noEventBlock = text.split("## 上游没有事件表的种类")[1] ?? "";
  const noEventKinds = [...noEventBlock.matchAll(/^- `([\w-]+)`：/gm)].map((match) => match[1]!);
  return { sections, noEventKinds };
}

const doc = parseDoc();

describe("#31 事件矩阵 ↔ 文档镜像", () => {
  it("解析守卫：文档里真的解析到了事件表（解析方式失效时不静默通过）", () => {
    expect(doc.sections.length, "文档里没有解析到任何事件表小节").toBeGreaterThanOrEqual(10);
    const totalRows = doc.sections.reduce((sum, section) => sum + section.rows.length, 0);
    expect(totalRows, "解析到的表格行太少").toBeGreaterThan(100);
    // 下界跟着 `OVERLAY_KINDS_WITHOUT_EVENT_MATRIX` 走：它现在只剩两个 kind（#33 把
    // custom-overlay / context-menu 收进矩阵后）。这里只用「非空且与登记表同量级」守解析失效，
    // 逐项相等由下面那条用例负责。
    expect(doc.noEventKinds.length, "没有解析到「无事件表」清单").toBeGreaterThanOrEqual(2);
    expect(doc.noEventKinds.length).toBeLessThanOrEqual(
      Object.keys(OVERLAY_KINDS_WITHOUT_EVENT_MATRIX).length + 1,
    );
  });

  it("文档里的小节恰好是矩阵里的 kind", () => {
    expect([...doc.sections.map((section) => section.kind)].sort()).toEqual(
      Object.keys(OVERLAY_EVENT_MATRIX).sort(),
    );
  });

  it("每节的表头数量与小节标题里的个数一致", () => {
    for (const section of doc.sections) {
      expect(section.rows.length, `${section.kind} 的行数`).toBe(section.count);
    }
  });

  it.each(Object.keys(OVERLAY_EVENT_MATRIX))("%s：表格与矩阵逐行相等", (kind) => {
    const section = doc.sections.find((entry) => entry.kind === kind)!;
    const entry = OVERLAY_EVENT_MATRIX[kind as keyof typeof OVERLAY_EVENT_MATRIX];
    expect(section.upstream).toBe(entry.upstream);
    const expected = Object.values(entry.events).map((event) => ({
      vue: event.vue,
      sdk: event.sdk,
      payload: PAYLOAD_TEXT[event.payload]!,
      description: event.requiresEditing
        ? `${event.description}（需 \`enableEditing\`）`
        : event.description,
    }));
    expect(section.rows).toEqual(expected);
  });

  it("「上游没有事件表的种类」与登记表相等", () => {
    expect([...doc.noEventKinds].sort()).toEqual(
      Object.keys(OVERLAY_KINDS_WITHOUT_EVENT_MATRIX).sort(),
    );
  });
});

describe("#31 弃用表 ↔ 迁移文档镜像", () => {
  /**
   * 迁移文档的「弃用」一节给的是同一张表（旧名 → 替代 + code）。
   *
   * 单测**不解析**那节的自然语言，只核对两组必需事实：每个 code 都出现、每个旧名与替代名都出现。
   * 这样文档改词句不会被拦，但「表里少一条 / 名字写错」会红——与 `events.md` 的口径一致。
   */
  const migrationDoc = readFileSync(MIGRATION_DOC_PATH, "utf8");
  const section = migrationDoc.split("## 5. 弃用")[1]?.split("\n## ")[0] ?? "";

  it("解析守卫：弃用一节真的解析到了内容", () => {
    expect(section.length, "迁移文档的弃用一节为空").toBeGreaterThan(200);
  });

  it.each([...OVERLAY_PROP_ALIASES, ...OVERLAY_EVENT_ALIASES])(
    "文档覆盖 $code 的每个名字",
    (alias) => {
      expect(section, `${alias.code} 没出现在迁移文档里`).toContain(alias.code);
      expect(section, `${alias.canonical} 没出现在迁移文档里`).toContain(alias.canonical);
      const deprecated = alias.target === "prop" ? alias.deprecated : [alias.alias];
      for (const name of deprecated) {
        expect(section, `旧名 ${name} 没出现在迁移文档里`).toContain(name);
      }
    },
  );
});
