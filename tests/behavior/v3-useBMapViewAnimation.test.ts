/**
 * useBMapViewAnimation（#104 A2 之后的行为面）
 *
 * 这个 hook 原先**一条用例都没有**，而它恰恰是「镜像 SDK 内部状态」的重灾区：
 * 旧的 `stop()` / `proceed()` 直接打私有成员 `_pause` / `_continue`，`status` 由命令乐观改写。
 * 收窄到公开面之后，用例只锁三件可观察事实：
 *
 * 1. 播放走的是官方公开路径：一次 `start()` = 一个 `ViewAnimation` 实例 + 一次地图起播；
 * 2. `status` 是**观察值**——只有 SDK 的公开事件能改它，命令不能，被取代的上一段也不能；
 * 3. 每段的订阅随该段结算释放；卸载把在飞动画**同步**停掉，且不残留任何 Driver 侧资源。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
import { useRequiredMapContext } from "../../packages/baidu-map-gl-vue/src/core/context/inject";
import { useBMapViewAnimation } from "../../packages/baidu-map-gl-vue/src/composables/useBMapViewAnimation";
import type { ViewAnimationKeyFrames } from "../../packages/baidu-map-gl-vue/src/composables/useBMapViewAnimation";
import { createFakeV4Harness } from "../../packages/test-utils";
import type { FakeV4ViewAnimation } from "../../packages/test-utils";

let harness: ReturnType<typeof createFakeV4Harness>["harness"];
let fake: ReturnType<typeof createFakeV4Harness>["fake"];

beforeEach(() => {
  const created = createFakeV4Harness();
  harness = created.harness;
  fake = created.fake;
  harness.reset();
});

const KEY_FRAMES: ViewAnimationKeyFrames[] = [
  { center: { lng: 116.307, lat: 40.054 }, zoom: 18, percentage: 0 },
  { center: { lng: 116.308, lat: 40.055 }, zoom: 19, percentage: 1 },
];

/** 起播之后，SDK 的启动定时器（`delay` 的 setTimeout）落地一次。 */
async function letSdkStart(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
}

/**
 * 在飞窗口屏障：Fake 的启动定时器 / 回调都记在 `diagnostics` 里。断言它们归零，用例的后续读数
 * 才是「已经静下来」而不是「恰好赶在前一次推进上」（#105 评审 P2）。
 */
async function settleAsyncWindow(): Promise<void> {
  await letSdkStart();
  expect(fake.diagnostics.pendingAsync()).toEqual({ timers: 0, callbacks: 0 });
}

type Hook = ReturnType<typeof useBMapViewAnimation>;

function mountHook(run: (hook: Hook) => void | Promise<void>) {
  const Child = defineComponent({
    setup() {
      const hook = useBMapViewAnimation({ duration: 10_000, delay: 0, loop: "INFINITE" });
      void Promise.resolve(run(hook));
      return () => h("div", "animator");
    },
  });
  return mount(
    defineComponent({
      components: { BMap, Child },
      setup: () => () => h(BMap, { provider: harness.provider() }, () => [h(Child)]),
    }),
    { attachTo: harness.container() },
  );
}

/** 挂载并等地图就绪（hook 的第一次 `start()` 内部也要等同一件事）。 */
async function startAndSettle(run: (hook: Hook) => void | Promise<void>) {
  const wrapper = mountHook(run);
  await flushPromises();
  await letSdkStart();
  return wrapper;
}

function lastAnimation(): FakeV4ViewAnimation {
  const animation = fake.createdViewAnimations.at(-1);
  if (!animation) throw new Error("没有创建 ViewAnimation 实例");
  return animation;
}

/**
 * 与 `mountHook` 同形，额外挂一条 `resource:error` 探针：卸载钩子里没人能接住抛错，
 * 那条失败必须由诊断总线交出来（`logger.warn` 在 production 会被折叠掉，不足以支撑可观测性）。
 */
function mountHookWithProbe(run: (hook: Hook) => void | Promise<void>) {
  const errors: Array<{ error: unknown; component?: string }> = [];
  const Child = defineComponent({
    setup() {
      useRequiredMapContext().events.on("resource:error", (payload) => {
        errors.push(payload as { error: unknown; component?: string });
      });
      const hook = useBMapViewAnimation({ duration: 10_000, delay: 0, loop: "INFINITE" });
      void Promise.resolve(run(hook));
      return () => h("div", "animator");
    },
  });
  const wrapper = mount(
    defineComponent({
      components: { BMap, Child },
      setup: () => () => h(BMap, { provider: harness.provider() }, () => [h(Child)]),
    }),
    { attachTo: harness.container() },
  );
  return { wrapper, errors };
}

describe("useBMapViewAnimation：只用官方公开面", () => {
  it("一次 start() 建一个动画实例，关键帧与公开选项原样交给 SDK", async () => {
    await startAndSettle((hook) => void hook.start(KEY_FRAMES));

    expect(fake.createdViewAnimations).toHaveLength(1);
    const animation = lastAnimation();
    expect(animation.keyFrames).toHaveLength(2);
    // `interation` 是官方 4.0 的拼写：本库不改名，因此这里读到的就是它
    expect(animation.options).toMatchObject({
      duration: 10_000,
      delay: 0,
      interation: "INFINITE",
    });
  });

  it("status 只由公开事件写：命令本身不改它", async () => {
    let hook!: Hook;
    await startAndSettle(async (created) => {
      hook = created;
      await created.start(KEY_FRAMES);
      // 起播命令已经打到 SDK，但 `animationstart` 是异步的：还没观察到事件就不能算在播
      expect(created.status.value).toBe("idle");
    });
    await flushPromises();

    expect(hook.status.value).toBe("playing");
    lastAnimation().finish();
    expect(hook.status.value).toBe("idle");
  });

  it("cancel() 走公开的取消命令，状态由 animationcancel 写回 idle", async () => {
    let hook!: Hook;
    await startAndSettle(async (created) => {
      hook = created;
      await created.start(KEY_FRAMES);
    });
    await flushPromises();
    expect(hook.status.value).toBe("playing");

    hook.cancel();
    await letSdkStart();

    expect(lastAnimation().cancelCalls, "取消必须落到 SDK 的 cancel").toBeGreaterThanOrEqual(1);
    expect(hook.status.value).toBe("idle");
  });

  it("反复播放不累积订阅：每段动画的监听随结束释放", async () => {
    await startAndSettle(async (hook) => {
      for (let round = 0; round < 3; round += 1) {
        await hook.start(KEY_FRAMES);
      }
    });
    await flushPromises();

    const settled = fake.createdViewAnimations.slice(0, 2);
    expect(settled).toHaveLength(2);
    for (const animation of settled) {
      expect(animation.getListenerCount(), "被后一段取代的动画不应留着订阅").toBe(0);
    }
    lastAnimation().finish();
    await flushPromises();
    expect(lastAnimation().getListenerCount()).toBe(0);
  });

  it("后一段接管时：前一段只释放自己的订阅，也不改写新段的状态", async () => {
    let hook!: Hook;
    const wrapper = await startAndSettle((created) => {
      hook = created;
      void created.start(KEY_FRAMES);
    });
    await flushPromises();
    const first = fake.createdViewAnimations[0];
    expect(hook.status.value).toBe("playing");
    expect(first.getListenerCount()).toBeGreaterThan(0);

    // 第一段还在播，直接起第二段：Driver 会在起播前同步取消上一段
    await hook.start(KEY_FRAMES);
    await letSdkStart();

    expect(fake.createdViewAnimations).toHaveLength(2);
    expect(first.getListenerCount(), "被取代的那一段必须释放自己的订阅").toBe(0);
    expect(hook.status.value, "新段的 animationstart 必须仍被观察到").toBe("playing");
    wrapper.unmount();
  });

  it("卸载停掉在飞的动画、释放订阅，Fake 侧无资源残留", async () => {
    let hook!: Hook;
    const wrapper = await startAndSettle((created) => {
      hook = created;
      void created.start(KEY_FRAMES);
    });
    await flushPromises();
    const animation = lastAnimation();
    expect(hook.status.value).toBe("playing");

    wrapper.unmount();
    await letSdkStart();

    expect(animation.cancelCalls, "卸载必须把在飞动画取消掉").toBeGreaterThanOrEqual(1);
    expect(animation.getListenerCount(), "卸载后 Driver 侧订阅必须归零").toBe(0);
    fake.diagnostics.assertNoLeaks("useBMapViewAnimation 卸载");
  });
});

/**
 * 取消失败路径（#105 评审 P1）
 *
 * `MapDriver` 的契约是「`cancelViewAnimation` 失败时动画记录**保留**，下一次
 * `stopViewAnimation` / `destroy` 仍可重试」（`driver/jsapi-v4/map.ts` 的 `cancelAllAnimations`
 * 汇总抛 `BMAP_SDK_CALL_FAILED`，且不置 `settled`）。这条契约在 hooks 侧有两个方向：
 *
 * - hooks **不能**在取消被接受之前丢掉自己那一段的归属——否则 SDK 那边还在播，hook 却已经没有
 *   重试入口了；
 * - 反过来，「本段的订阅」是本库自己的记账：一段从未起播（起播被拒）或已经卸载的动画，
 *   不能因为等一条可能不来的事件就一直挂着。
 */
describe("useBMapViewAnimation：取消失败时保留重试入口", () => {
  it("显式 cancel() 第一次失败后仍可重试，并在重试成功时结算", async () => {
    let hook!: Hook;
    const wrapper = await startAndSettle((created) => {
      hook = created;
      void created.start(KEY_FRAMES);
    });
    await flushPromises();
    const animation = lastAnimation();
    expect(hook.status.value).toBe("playing");

    animation.failNextCancel = true;
    expect(() => hook.cancel(), "取消失败必须让调用方看见").toThrow();
    expect(animation.cancelCalls).toBe(1);
    expect(hook.status.value, "没观察到 animationcancel 就不能说已停").toBe("playing");

    // 关键：第一次失败不能把 hooks 的归属清掉，否则第二次直接 no-op
    hook.cancel();
    await settleAsyncWindow();

    expect(animation.cancelCalls, "第二次必须真的把取消命令再打给 SDK").toBe(2);
    expect(animation.getListenerCount(), "重试成功后订阅归零").toBe(0);
    expect(hook.status.value).toBe("idle");
    wrapper.unmount();
  });

  it("第二次 start() 被旧段的取消失败挡住时：旧段仍在观察、新段不留订阅", async () => {
    let hook!: Hook;
    const wrapper = await startAndSettle((created) => {
      hook = created;
      void created.start(KEY_FRAMES);
    });
    await flushPromises();
    const first = lastAnimation();
    expect(hook.status.value).toBe("playing");

    first.failNextCancel = true;
    await expect(hook.start(KEY_FRAMES)).rejects.toThrow();

    const second = fake.createdViewAnimations[1];
    expect(second, "新实例已创建，但起播被拒").toBeDefined();
    expect(second.getListenerCount(), "从未起播的一段不能留着订阅").toBe(0);
    expect(first.getListenerCount(), "旧段仍在播，必须还被观察着").toBeGreaterThan(0);
    expect(first.hasPendingStart, "旧段的 SDK 启动定时器早已落地").toBe(false);

    // 旧段仍可由 hooks 重试取消（Driver 保留了它的记录）
    hook.cancel();
    await settleAsyncWindow();

    expect(first.getListenerCount()).toBe(0);
    expect(hook.status.value).toBe("idle");
    wrapper.unmount();
  });

  it("卸载时取消失败：不打断卸载、本段订阅归零，并把失败经 resource:error 交出来", async () => {
    const { wrapper, errors } = mountHookWithProbe((hook) => void hook.start(KEY_FRAMES));
    await flushPromises();
    await settleAsyncWindow();
    const animation = lastAnimation();
    expect(animation.getListenerCount()).toBeGreaterThan(0);
    expect(errors, "起播阶段没有失败可报").toEqual([]);

    animation.failNextCancel = true;
    expect(() => wrapper.unmount()).not.toThrow();
    await settleAsyncWindow();

    expect(animation.getListenerCount(), "卸载路径不能等一条可能不来的事件才释放").toBe(0);
    // `logger.warn` 在 production 会被折叠：只留它，「这段动画其实没被停掉」就不可观测
    expect(errors, "卸载期取消失败必须上诊断总线").toHaveLength(1);
    expect(errors[0]!.component).toBe("useBMapViewAnimation");
    expect(errors[0]!.error).toMatchObject({
      message: expect.stringContaining("cancelViewAnimation"),
    });
    fake.diagnostics.assertNoLeaks("useBMapViewAnimation 卸载时取消失败");
  });

  it("起播前地图已被销毁：那一段的三条订阅全部下线", async () => {
    let hook!: Hook;
    const wrapper = await startAndSettle((created) => {
      hook = created;
    });
    await flushPromises();
    const ready = await hook.ready;
    const created = fake.createdViewAnimations.length;

    // 订阅与起播之间没有任何调用方能插手的窗口，真实形态是「地图在别处被销毁」：
    // `createViewAnimation` 与 `events.on` 都只涉及动画实例本身，起播才要求地图活着
    ready.client.driver.map.destroy(ready.map);
    await expect(hook.start(KEY_FRAMES)).rejects.toThrow();

    const attempt = fake.createdViewAnimations[created];
    expect(attempt, "实例已创建，但起播被拒").toBeDefined();
    expect(attempt.getListenerCount(), "从未起播的一段不能留着任何订阅").toBe(0);
    wrapper.unmount();
  });
});

/**
 * 取消成功、但 SDK 没有派发 `animationcancel`（#105 评审第三轮 P1）
 *
 * 这是审计表 F-1 那条未取证时序的**反面**用例：Fake 默认一定派发该事件，所以「等事件再交回
 * 所有权」在这里永远不会出错。把派发关掉之后，才能看出生产实现是不是把「还在观察事件」当成了
 * 「还有资格再发一次地图级 stop」。`stopViewAnimation` 是**地图级**命令，重复发就会停掉这张图上
 * 任何人正在播的动画——包括另一个 hooks 刚起的那一段。
 *
 * 这条用例**不**主张官方一定不派发该事件；它只钉住：真不派发时本库也不越权。
 */
describe("useBMapViewAnimation：取消被接受之后不再越权", () => {
  /** 同一张地图上挂两个 hooks；`showFirst` 可以只卸载前一个（地图保持存活） */
  function mountTwoHooks() {
    const hooks: Hook[] = [];
    const showFirst = ref(true);
    const makeChild = (index: number) =>
      defineComponent({
        setup() {
          hooks[index] = useBMapViewAnimation({ duration: 10_000, delay: 0, loop: "INFINITE" });
          return () => h("div", `animator-${index}`);
        },
      });
    const First = makeChild(0);
    const Second = makeChild(1);
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(BMap, { provider: harness.provider() }, () => [
            showFirst.value ? h(First) : null,
            h(Second),
          ]),
      }),
      { attachTo: harness.container() },
    );
    return { wrapper, hooks, showFirst };
  }

  it("第一段取消成功但无 animationcancel：H1 的第二次 cancel 不能停掉 H2 的动画", async () => {
    const { wrapper, hooks, showFirst } = mountTwoHooks();
    await flushPromises();
    await letSdkStart();

    await hooks[0].start(KEY_FRAMES);
    await settleAsyncWindow();
    const first = fake.createdViewAnimations[0];
    expect(hooks[0].status.value).toBe("playing");

    first.suppressCancelEvent = true;
    expect(() => hooks[0].cancel()).not.toThrow();
    await settleAsyncWindow();
    expect(first.cancelCalls, "取消命令确实打到了 SDK").toBe(1);
    // 取消已经打到 SDK 并被本库确认交付 ⇒ 不等那条事件也收敛（#105 第六轮 P2-1）
    expect(hooks[0].status.value).toBe("idle");

    // H1 名下的动画已经被 Driver 结算掉，H2 在同一张图上正常起播
    await hooks[1].start(KEY_FRAMES);
    await settleAsyncWindow();
    const second = fake.createdViewAnimations[1];
    expect(hooks[1].status.value).toBe("playing");

    // 关键：H1 再取消一次不能越权去停 H2 那一段
    hooks[0].cancel();
    await settleAsyncWindow();
    expect(second.cancelCalls, "H1 不得对这张图再发一次地图级 stop").toBe(0);
    expect(hooks[1].status.value).toBe("playing");
    expect(second.getListenerCount(), "H2 的观察不受影响").toBeGreaterThan(0);

    // 卸载 H1 同样不能补发 stop；但它自己的订阅必须当场归零
    showFirst.value = false;
    await nextTick();
    await settleAsyncWindow();
    expect(first.getListenerCount(), "H1 的订阅在卸载时释放").toBe(0);
    expect(second.cancelCalls, "卸载 H1 也不能停掉 H2 的动画").toBe(0);
    expect(hooks[1].status.value).toBe("playing");

    // H2 自己结算与卸载一切正常
    second.finish();
    await flushPromises();
    expect(hooks[1].status.value).toBe("idle");
    expect(second.getListenerCount()).toBe(0);
    wrapper.unmount();
    fake.diagnostics.assertNoLeaks("两个 hooks 共用一张地图");
  });
});

/**
 * 取消的交付状态决定所有权（#105 第六轮）
 *
 * `MapDriver.cancelViewAnimation(map, animation)` 把这一次取消的**本库侧交付状态**报回来：
 * 还没进启动安全窗口时只是登记（`"deferred"`），已起播时才真正打到 SDK（`"canceled"`），
 * 记录早已结算则什么都不是（`"already-settled"`）。hooks 据此区分三件事：
 * 观察对象、本库自己的监听、以及**还有没有东西需要重试** —— 而不是拿「有没有收到
 * `animationcancel`」当所有权判据（F-1 说那条时序没有取证）。
 */
describe("useBMapViewAnimation：deferred 与已交付的取消走不同的收尾", () => {
  it("还没进安全窗口就 cancel、延迟取消失败：第二次 cancel 真的重试自己那一段", async () => {
    let hook!: Hook;
    const wrapper = mountHook((created) => {
      hook = created;
    });
    await flushPromises();

    await hook.start(KEY_FRAMES);
    const animation = lastAnimation();
    expect(animation.hasPendingStart, "SDK 的启动定时器还没落地").toBe(true);
    expect(hook.status.value, "没观察到 animationstart 就不算在播").toBe("idle");

    animation.failNextCancel = true;
    expect(() => hook.cancel(), "登记取消请求不该抛错").not.toThrow();
    expect(animation.cancelCalls, "登记阶段不会打到 SDK").toBe(0);

    // 安全窗口到达：Driver 补做取消，第一次失败 ⇒ 只告警、记录保留
    await letSdkStart();
    expect(animation.cancelCalls).toBe(1);
    expect(hook.status.value, "取消尚未交付：观察对象与重试入口都得留着").toBe("playing");

    // 第二次 cancel = 真重试（按实例，不碰这张图上别人的动画）
    hook.cancel();
    await settleAsyncWindow();
    expect(animation.cancelCalls, "第二次必须真的再打一次 SDK 取消").toBe(2);
    expect(animation.getListenerCount(), "重试成功后订阅归零").toBe(0);
    expect(hook.status.value).toBe("idle");
    wrapper.unmount();
  });

  it("取消已交付之后再 cancel 是幂等收尾，不重复打到 SDK", async () => {
    let hook!: Hook;
    const wrapper = await startAndSettle((created) => {
      hook = created;
      void created.start(KEY_FRAMES);
    });
    await flushPromises();
    const animation = lastAnimation();
    expect(hook.status.value).toBe("playing");

    // SDK 被调用、事件被关掉：本库仍知道自己已经把这次取消交付出去了
    animation.suppressCancelEvent = true;
    hook.cancel();
    expect(animation.cancelCalls).toBe(1);
    expect(hook.status.value, "交付确认即可收敛，不必等那条事件").toBe("idle");
    expect(animation.getListenerCount()).toBe(0);

    expect(() => hook.cancel(), "再取消不该抛错").not.toThrow();
    expect(animation.cancelCalls, "已交付过就不再补发命令").toBe(1);
    expect(hook.status.value).toBe("idle");

    wrapper.unmount();
    fake.diagnostics.assertNoLeaks("取消交付后的幂等 cancel");
  });
});

/**
 * 旧段的收尾不得改写新段（#105 第六轮 P2）
 *
 * `status` 与 `current` 是**同一个 hooks 一份**共享量，而 `finishRun` 有两个调用方（事件结算、
 * 取消交付确认）加一条异常路径（地图已销毁）。所以收尾必须按 `run` 身份收敛：被接管或已收尾的
 * 旧段只销自己的订阅，不动新段刚观察到的 `playing`。
 */
describe("useBMapViewAnimation：收尾按动画身份收敛", () => {
  it("旧段 deferred→已交付之后再起新段：新段状态不被旧段改写，且自己能重试到收敛", async () => {
    let hook!: Hook;
    const wrapper = mountHook((created) => {
      hook = created;
    });
    await flushPromises();

    await hook.start(KEY_FRAMES);
    const a = fake.createdViewAnimations[0];
    a.failNextCancel = true;
    hook.cancel();
    expect(a.cancelCalls, "还没进安全窗口：只登记，不打到 SDK").toBe(0);
    await letSdkStart();
    expect(a.cancelCalls, "安全窗口里 Driver 补做取消（这次失败）").toBe(1);
    expect(hook.status.value, "取消尚未交付：状态照旧由事件说话").toBe("playing");

    a.suppressCancelEvent = true;
    hook.cancel(); // 重试成功 ⇒ 交付确认 ⇒ 收敛，不等那条 animationcancel
    expect(a.cancelCalls).toBe(2);
    expect(hook.status.value).toBe("idle");
    expect(a.getListenerCount(), "旧段的订阅已销").toBe(0);

    await hook.start(KEY_FRAMES);
    await settleAsyncWindow();
    const b = fake.createdViewAnimations[1];
    expect(hook.status.value).toBe("playing");

    // 旧段的监听已由 `start()` 的接管逻辑释放；这里再派发一次，代表任何旧段的后续交付路径
    // （晚到的事件、重复结算）。它们都不该把新段刚观察到的 playing 抹掉。
    a.emit("animationend");
    a.emit("animationcancel");
    await flushPromises();
    expect(hook.status.value, "旧段不能把新段写成 idle").toBe("playing");
    expect(b.getListenerCount(), "新段的订阅不受旧段影响").toBeGreaterThan(0);

    // 新段自己走同一套：第一次取消失败 ⇒ 抛错、保留重试入口与 playing；第二次收敛
    b.failNextCancel = true;
    expect(() => hook.cancel()).toThrow();
    expect(b.cancelCalls).toBe(1);
    expect(hook.status.value).toBe("playing");
    hook.cancel();
    await settleAsyncWindow();
    expect(b.cancelCalls, "第二次真的重试到了 SDK").toBe(2);
    expect(hook.status.value).toBe("idle");
    expect(a.cancelCalls, "旧段保持它自己那两次，不被新段牵连").toBe(2);
    wrapper.unmount();
    fake.diagnostics.assertNoLeaks("收尾按动画身份收敛");
  });
});
