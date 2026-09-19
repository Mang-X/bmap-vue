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
import { defineComponent, h } from "vue";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
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

  it("卸载时取消失败：不打断卸载、本段订阅仍然归零", async () => {
    const wrapper = await startAndSettle((hook) => void hook.start(KEY_FRAMES));
    await flushPromises();
    const animation = lastAnimation();
    expect(animation.getListenerCount()).toBeGreaterThan(0);

    animation.failNextCancel = true;
    expect(() => wrapper.unmount()).not.toThrow();
    await settleAsyncWindow();

    expect(animation.getListenerCount(), "卸载路径不能等一条可能不来的事件才释放").toBe(0);
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
