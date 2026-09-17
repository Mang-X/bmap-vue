/**
 * Marker 图标：descriptor → `BMap.Icon` 的缓存与内置名解析（M5-SPEC-MARKER / #30）
 *
 * 验收标准里的「图标重复配置命中 cache 且有上限」在这里落成可执行的检查：
 * - **命中**：同一份 descriptor ⇒ **同一个** Icon 实例（不是「看起来一样」）；
 * - **有上限**：写满 {@link DEFAULT_ICON_CACHE_SIZE} 条之后，最久未使用的条目被淘汰
 *   （用「再取一次会拿到新实例」观测，不需要读缓存内部状态）；
 * - **内置名全覆盖**：`red5` 这类名字必须落在自己的雪碧图格子上——迁移前 Driver 只有 7 个
 *   内置名，其余 20 个会静默回落 `simple_red`。
 *
 * 走**默认路径**装 Client（`createFakeV4Client`：Provider 归一 → `assertLoadedSdk` → 默认 Driver
 * 工厂 → 组装），因此这里测到的就是 `<BMarker icon=...>` 实际会走的那条链。
 */
import { describe, expect, it } from "vitest";
import { createFakeBMapV4, createFakeV4Client } from "../../packages/test-utils";
import type { FakeV4Icon } from "../../packages/test-utils";
import type { MarkerIconInput } from "../../packages/baidu-map-gl-vue/src/driver/types/overlays";
import { DEFAULT_ICON_CACHE_SIZE } from "../../packages/baidu-map-gl-vue/src/core/icons/iconCache";

async function iconBuilder() {
  const fake = createFakeBMapV4();
  const { client } = await createFakeV4Client(fake);
  return {
    fake,
    build: (input: MarkerIconInput): FakeV4Icon =>
      client.driver.overlays.buildIcon(input) as FakeV4Icon,
  };
}

const custom = (imageUrl: string): MarkerIconInput => ({
  imageUrl,
  size: { width: 10, height: 20 },
});

describe("Marker 图标缓存", () => {
  it("同一份配置命中同一条缓存（含对象键序不同、内置名重复）", async () => {
    const { build } = await iconBuilder();
    const first = build(custom("https://example.com/a.png"));
    const second = build({ size: { height: 20, width: 10 }, imageUrl: "https://example.com/a.png" });
    expect(second).toBe(first);
    expect(build("simple_red")).toBe(build("simple_red"));
    // 任何一个字段不同都要换一条缓存
    expect(build(custom("https://example.com/b.png"))).not.toBe(first);
    expect(build({ imageUrl: "https://example.com/a.png", size: { width: 10, height: 21 } })).not.toBe(
      first,
    );
  });

  it("候选图标带锚点/偏移时各自成键（sprites 切图不会被别的格子复用）", async () => {
    const { build } = await iconBuilder();
    const withAnchor = build({
      imageUrl: "https://example.com/sprite.png",
      size: { width: 30, height: 30 },
      anchor: { x: 15, y: 30 },
    });
    const withOffset = build({
      imageUrl: "https://example.com/sprite.png",
      size: { width: 30, height: 30 },
      imageOffset: { x: 60, y: 0 },
      imageSize: { width: 90, height: 90 },
    });
    expect(withAnchor).not.toBe(withOffset);
    expect(withOffset.imageOffset).toMatchObject({ width: 60, height: 0 });
    expect(withAnchor.anchor).toMatchObject({ width: 15, height: 30 });
  });

  it("内置名解析到各自的雪碧图格子（20 个名字不再回落 simple_red）", async () => {
    const { build } = await iconBuilder();
    const red5 = build("red5");
    const simpleRed = build("simple_red");
    expect(red5).not.toBe(simpleRed);
    expect(red5.imageOffset).toMatchObject({ width: 76, height: 0 });
    expect(red5.size).toMatchObject({ width: 19, height: 19 });
    expect(red5.imageSize).toMatchObject({ width: 300, height: 300 });
    // start / end 走内联 SVG（历史行为），并带自己的锚点
    const start = build("start");
    expect(start.imageUrl.startsWith("data:image/svg+xml")).toBe(true);
    expect(start.anchor).toMatchObject({ width: 12, height: 16 });
  });

  it("上限生效：写满之后最久未使用的条目被淘汰", async () => {
    const { build } = await iconBuilder();
    const oldest = build(custom("https://example.com/oldest.png"));
    expect(build(custom("https://example.com/oldest.png"))).toBe(oldest);

    for (let i = 0; i < DEFAULT_ICON_CACHE_SIZE; i++) build(custom(`https://example.com/x${i}.png`));

    // 被淘汰 ⇒ 重新构造出新实例；再取一次仍然命中这一份新的
    const rebuilt = build(custom("https://example.com/oldest.png"));
    expect(rebuilt).not.toBe(oldest);
    expect(build(custom("https://example.com/oldest.png"))).toBe(rebuilt);
  });

  it("未知内置名按兜底图标渲染（只可能来自 JS / any 调用方）", async () => {
    const { build } = await iconBuilder();
    expect(build("no_such_icon" as MarkerIconInput)).toBe(build("simple_red"));
  });
});
