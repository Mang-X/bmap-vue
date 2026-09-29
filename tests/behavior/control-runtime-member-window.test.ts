/**
 * **运行时成员面窗口**的行为门禁（#165c 复核带出的真缺陷）
 *
 * ## 这份文件在防什么
 *
 * #165 审计把 `CityListControl` 的命令面与 `CopyrightControl#removeCopyright` 记成
 * 「运行时不存在」，据此要删两个公开 API、并给 `unmount` 换语义。**复核否掉了那两条**：
 * 成员面在稳定态**全部在位且真调得动**（live 读数见 `scripts/probe-165c-surface.mts`）。
 *
 * 复核同时取到一条**真的**，它比原结论更值得修：
 *
 * > 官方 loader 的就绪信号（`__bmapJSApiOnLoad_N` callback，= `@baidumap/jsapi-loader@1.0.0`
 * > 判「已加载」的那一下）**早于控件成员面补齐约 150ms**。窗口宽 126–167ms（4 次独立复跑）。
 *
 * 本库、以及任何用官方 loader 的代码，都从那个 callback 开始建图建控件 ⇒ **窗口是可达的**。
 * 窗口内：
 *
 * | 成员 | 状态 |
 * | --- | --- |
 * | `addCopyright` / `getCopyright` / `getCopyrightCollection` | **在**（8 个成员那批里的） |
 * | `removeCopyright` | **不在**（16 个成员那批里，后补） |
 * | `CityListControl#toggle` / `getCityName` / `open` / `close` | **不在** |
 *
 * ⇒ **挂载成功、卸载抛 `BMAP_SDK_CALL_FAILED`**，且因为 `removeCopyrightControlIfEmpty` 排在
 * 它后面，共享控件**永远不从地图上摘除**、位置缓存条目**永不淘汰**。
 *
 * 关键设计点：**补齐会追溯到已存在的实例**（原型被补 ⇒ 实例自动获得成员），live 实测
 * 「窗口里 add 的那条，窗口后能 remove 掉」。因此正确的修法**不是**把 `removeCopyright`
 * 降级成「调用失败就跳过」——那会把版权项**永久留在地图上**。见 `CopyrightControl.vue` 的
 * `deferCopyrightRemoval` 注释。
 *
 * ## 为什么用 Fake 切形状而不是 mock 掉

 * 真实浏览器里这个窗口宽 ~150ms 且依赖网络时序，在单测里既不可复现也不稳定。
 * 因此 Fake 提供**可控开关**：`installDeferredRuntimeMembers()` 卸下这些成员，
 * `resetRuntimeMemberShape()` 装回。窗口成为一条**可执行**的用例，而不是注释里的注意事项。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import MapComponent from "../../packages/bmap-vue/src/components/map/Map.vue";
import CopyrightControlComponent from "../../packages/bmap-vue/src/components/controls/CopyrightControl.vue";
import { BMapError } from "../../packages/bmap-vue/src/core/errors/BMapError";
import { createFakeV4Harness, type FakeBMapV4, type FakeV4Harness } from "../../packages/test-utils";
import {
  FAKE_V4_DEFERRED_RUNTIME_MEMBERS,
  installDeferredRuntimeMembers,
  resetRuntimeMemberShape,
} from "../../packages/test-utils/fake-bmap-v4/runtime-member-shape.ts";

let harness: FakeV4Harness;
let fake: FakeBMapV4;

beforeEach(() => {
  ({ harness, fake } = createFakeV4Harness());
});

afterEach(() => {
  // 每个用例开头装回「稳定态」：忘了恢复的用例会把「成员缺失」带进后续用例，
  // 而那类失败会伪装成「Driver 探测错了」。
  resetRuntimeMemberShape(fake);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await flushPromises();
  await nextTick();
}

/**
 * 等延后摘除的**重试定时器**跑完（live 窗口 ~150ms；单测里用真实定时器推进）。
 *
 * 不能只 `flushPromises()`：摘除是 `setTimeout` 驱动的，Promise 微任务不会推进定时器。
 * 这里等 4 次尝试（`REMOVAL_RETRY_ATTEMPTS` × 50ms）+ 余量，正好覆盖「补齐后第一次就成功」。
 */
async function settleRemovalRetries(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await settle();
}

type AnyRecord = Record<string, any>;

function controlsOnMap(): AnyRecord[] {
  const map = fake.createdMaps[fake.createdMaps.length - 1];
  return (map?.controls ?? []) as AnyRecord[];
}

async function mountCopyrights(count = 1) {
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(MapComponent, { provider: harness.provider() }, () => [
          ...Array.from({ length: count }, (_unused, index) =>
            h(
              CopyrightControlComponent,
              { anchor: "BMAP_ANCHOR_BOTTOM_RIGHT" },
              { default: () => `copyright-${index}` },
            ),
          ),
        ]),
    }),
    { attachTo: harness.container() },
  );
  await settle();
  await settle();
  return wrapper;
}

/* ------------------------------------------------------------------ 窗口本身 */

describe("运行时成员面窗口：成员「晚 ~150ms 才补齐」这条事实必须可复现", () => {
  it("installDeferredRuntimeMembers 卸下的成员确实不在，resetRuntimeMemberShape 装回", () => {
    const cityProto = (fake.namespace as AnyRecord).CityListControl.prototype;
    const copyrightProto = (fake.namespace as AnyRecord).CopyrightControl.prototype;

    // 稳定态：命令面在（= 复核读数，改动这些名字会红）
    expect(typeof cityProto.toggle).toBe("function");
    expect(typeof cityProto.getCityName).toBe("function");
    expect(typeof cityProto.open).toBe("function");
    expect(typeof copyrightProto.removeCopyright).toBe("function");

    installDeferredRuntimeMembers(fake);
    // 窗口：恰好是 live 读数里「补齐前」的那几个
    for (const member of FAKE_V4_DEFERRED_RUNTIME_MEMBERS.CityListControl) {
      expect(typeof cityProto[member], `CityListControl.${member} 应被卸下`).toBe("undefined");
    }
    for (const member of FAKE_V4_DEFERRED_RUNTIME_MEMBERS.CopyrightControl) {
      expect(typeof copyrightProto[member], `CopyrightControl.${member} 应被卸下`).toBe("undefined");
    }
    // 补齐**前**就在的那批不能被误伤（addCopyright 在 8 成员批里）
    expect(typeof copyrightProto.addCopyright, "addCopyright 属于补齐前那批，不该被卸下").toBe(
      "function",
    );

    resetRuntimeMemberShape(fake);
    expect(typeof cityProto.toggle).toBe("function");
    expect(typeof copyrightProto.removeCopyright).toBe("function");
  });
});

/* ------------------------------------------------- 缺陷：窗口内卸载抛错 + 泄漏 */

describe("缺陷：成员面补齐前卸载 <CopyrightControl> —— 不得抛错、不得泄漏", () => {
  it("窗口内卸载：组件卸载**不抛错**（Vue 卸载路径不得被 SDK 缺口打断）", async () => {
    installDeferredRuntimeMembers(fake);
    const wrapper = await mountCopyrights(1);
    // 窗口内挂载是成功的（addCopyright 在补齐前那批）——所以这里真的有东西要摘
    expect(controlsOnMap()[0]!.copyrights).toHaveLength(1);

    // 关键断言：卸载期间 `removeCopyright` 抛 BMAP_SDK_CALL_FAILED。
    // `useControlResource` 的 dispose 路径会把它 catch 成 logger.warn，所以「抛」体现在
    // 共享控件没被摘下来（见下一条用例）；这里先钉住「卸载不炸」。
    const errors: unknown[] = [];
    const onError = (error: unknown) => errors.push(error);
    wrapper.vm.$.appContext.config.errorHandler = onError;

    expect(() => wrapper.unmount()).not.toThrow();
    await settle();
    expect(errors, "Vue 卸载期间不得有未处理错误").toEqual([]);
  });

  it("窗口内卸载：共享控件**从地图上摘除**、位置缓存条目被淘汰", async () => {
    installDeferredRuntimeMembers(fake);
    const wrapper = await mountCopyrights(1);
    expect(controlsOnMap()).toHaveLength(1);

    wrapper.unmount();
    await settle();

    // 这是 #165 审计说的「泄漏」：原先 `removeCopyright` 抛错 ⇒ 后面这行永不执行。
    expect(controlsOnMap(), "窗口内卸载也必须把控件摘下来（否则永远残留在宿主上）").toHaveLength(
      0,
    );
  });

  it("窗口内卸载：版权项**不留在 SDK 上**（延后到成员补齐之后再摘）", async () => {
    installDeferredRuntimeMembers(fake);
    const wrapper = await mountCopyrights(1);
    const control = controlsOnMap()[0]!;
    expect(control.copyrights).toHaveLength(1);

    wrapper.unmount();
    await settle();
    // 立刻断言「控件已摘、版权项还在」——这正是延后存在的**唯一**理由：
    // 它是「宁可 SDK 上多留 ≤ 一个窗口，也不要永久残留」的取舍。
    expect(controlsOnMap(), "控件必须同步摘下（共享实例不能留在宿主上）").toHaveLength(0);
    expect(control.copyrights, "摘除被延后 ⇒ 这一条此刻仍在 SDK 上").toHaveLength(1);

    // 成员补齐（= live 的 ~150ms 之后）后，补做的那一次必须真的摘掉。
    resetRuntimeMemberShape(fake);
    await settleRemovalRetries();
    expect(control.copyrights, "成员补齐后补做的一次 removeCopyright 必须真的摘掉").toHaveLength(
      0,
    );
  });

  it("成员补齐后：补做的那次摘除真的生效（补齐是追溯到已存在实例的）", async () => {
    installDeferredRuntimeMembers(fake);
    const wrapper = await mountCopyrights(1);
    const control = controlsOnMap()[0]!;
    expect(control.copyrights).toHaveLength(1);

    wrapper.unmount();
    await settle();

    // 复原成员面（= live 的 ~150ms 之后），让补做的那条路径真的调得到
    resetRuntimeMemberShape(fake);
    await settleRemovalRetries();

    expect(control.copyrights, "成员补齐后补做的一次 removeCopyright 必须真的摘掉").toHaveLength(
      0,
    );
  });

  it("窗口内卸载：不得静默吞掉——必须能观察到（logger.warn 一次）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installDeferredRuntimeMembers(fake);
    const wrapper = await mountCopyrights(1);

    wrapper.unmount();
    await settle();

    // 「延后摘除」是**有代价**的取舍（版权项在 SDK 上多留一会儿），
    // 因此必须说得出来，而不是变成一个没人知道的静默行为。
    const said = warn.mock.calls.some((call) =>
      String(call[0] ?? "").includes("removeCopyright"),
    );
    expect(said, "延后摘除必须告警（否则就是静默的行为差异）").toBe(true);
  });

  it("兄弟组件仍在时：窗口内卸载**不**摘共享控件（共享语义优先于摘除时机）", async () => {
    installDeferredRuntimeMembers(fake);
    const showSecond = ref(true);
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(MapComponent, { provider: harness.provider() }, () => [
            h(
              CopyrightControlComponent,
              { anchor: "BMAP_ANCHOR_BOTTOM_RIGHT" },
              { default: () => "first" },
            ),
            showSecond.value
              ? h(
                  CopyrightControlComponent,
                  { anchor: "BMAP_ANCHOR_BOTTOM_RIGHT" },
                  { default: () => "second" },
                )
              : null,
          ]),
      }),
      { attachTo: harness.container() },
    );
    await settle();
    await settle();

    expect(controlsOnMap()).toHaveLength(1);
    expect(controlsOnMap()[0]!.copyrights).toHaveLength(2);

    // 摘掉第二个组件：它的版权项**被延后**，所以此刻 SDK 上仍有两条。
    // 但判「控件该不该摘」必须**排除它自己那条**——否则「稍后会被摘掉的一条」
    // 会把共享控件永久留在图上（这正是 #165 记的泄漏形状）。
    showSecond.value = false;
    await nextTick();
    await nextTick();
    await settle();

    // 第一个组件的版权项还在（兄弟还在）⇒ 控件必须留在图上
    expect(controlsOnMap(), "兄弟还在，控件必须留在图上").toHaveLength(1);
    expect(controlsOnMap()[0]!.copyrights, "此刻两条都在（第二条的摘除被延后）").toHaveLength(2);

    // 成员补齐后，延后的那条被真的摘掉 ⇒ 只剩兄弟那一条。
    resetRuntimeMemberShape(fake);
    await settleRemovalRetries();
    expect(controlsOnMap()[0]!.copyrights, "补齐后只剩兄弟那一条").toHaveLength(1);

    wrapper.unmount();
    await settleRemovalRetries();
  });
});

/* ------------------------------------------------------------- 稳定态不回退 */

describe("稳定态（成员已补齐）：既有语义不得被窗口修复改坏", () => {
  it("稳定态卸载：正常摘控件 + 摘版权项（无延后、无告警）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = await mountCopyrights(1);
    const control = controlsOnMap()[0]!;
    expect(control.copyrights).toHaveLength(1);

    wrapper.unmount();
    await settle();

    expect(control.copyrights).toHaveLength(0);
    expect(controlsOnMap()).toHaveLength(0);
    expect(
      warn.mock.calls.some((call) => String(call[0] ?? "").includes("removeCopyright")),
      "稳定态不该走延后路径",
    ).toBe(false);
  });

  it("稳定态：同 anchor 两个组件共用控件、各自一条版权项（共享语义不回退）", async () => {
    const wrapper = await mountCopyrights(2);
    expect(controlsOnMap()).toHaveLength(1);
    expect(controlsOnMap()[0]!.copyrights).toHaveLength(2);
    wrapper.unmount();
    await settle();
  });
});
