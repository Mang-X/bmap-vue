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
