/**
 * 瓦片加载观察面（issue #97）
 *
 * 依据（真实 4.0 实测，`scripts/probe-layer-events.mts`）：
 * - 官方这批网络图层的类声明里没有事件成员，十个候选事件名在请求确实发生过时**一个都不触发**；
 * - `tileLoadFunction` 是**接管式**的：设了它、函数里什么都不做 ⇒ 那块瓦片最终 `naturalWidth = 0`；
 * - 在它里面自己赋 `tile.src = url` ⇒ 那块瓦片 `naturalWidth = 256`（加载真的发生了）。
 *
 * 所以本模块的两条契约必须被钉住：**给了观察者就要替用户完成加载**、**没给就什么都不做**（不表态）。
 */
import { describe, expect, it, vi } from "vitest";
import {
  createTileLoadFunction,
  defaultTileLoad,
  type TileLoadObserver,
} from "./tileLoadObserver";

/** 造一块「假瓦片」：只看 `src` 有没有被赋，以及事件能不能派发。 */
function makeTile(): HTMLImageElement {
  const tile = document.createElement("img");
  // happy-dom 不会真的去取图：`src` 只是属性，事件由用例显式派发，这正是我们要观察的两件事。
  return tile;
}

describe("[#97] 瓦片加载观察面", () => {
  it("两个输入都没有 ⇒ 返回 undefined（本库不表态，SDK 走自己的默认路径）", () => {
    expect(createTileLoadFunction(() => ({}))).toBeUndefined();
    expect(createTileLoadFunction(() => ({ observer: undefined, takeover: undefined }))).toBeUndefined();
  });

  it("只给观察者 ⇒ 本库完成默认加载（tile.src = url），并回调 onRequest", () => {
    const onRequest = vi.fn();
    const load = createTileLoadFunction(() => ({ observer: { onRequest } }))!;
    const tile = makeTile();

    load(tile, "https://tiles.example/1/2/3.png");

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest.mock.calls[0]![0]).toMatchObject({ url: "https://tiles.example/1/2/3.png", tile });
    expect(tile.getAttribute("src"), "接管式钩子下必须由本库完成加载，否则瓦片不会出现").toBe(
      "https://tiles.example/1/2/3.png",
    );
  });

  it("元素派发 load / error ⇒ 分别回调 onLoaded / onError，且 url 取元素当前的 src", () => {
    const onLoaded = vi.fn();
    const onError = vi.fn();
    const load = createTileLoadFunction(() => ({ observer: { onLoaded, onError } }))!;
    const tile = makeTile();

    load(tile, "https://tiles.example/a.png");
    tile.dispatchEvent(new Event("load"));
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded.mock.calls[0]![0].url).toBe("https://tiles.example/a.png");

    // 同一个元素换一张图（SDK 复用元素）：事件按**元素**归属，url 读的是元素当前的 src。
    load(tile, "https://tiles.example/b.png");
    tile.dispatchEvent(new Event("error"));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0].url).toBe("https://tiles.example/b.png");
  });

  it("同一个元素多次加载 ⇒ 结果监听只挂一次（不随加载次数堆积）", () => {
    const onLoaded = vi.fn();
    const load = createTileLoadFunction(() => ({ observer: { onLoaded } }))!;
    const tile = makeTile();

    load(tile, "https://tiles.example/1.png");
    load(tile, "https://tiles.example/2.png");
    load(tile, "https://tiles.example/3.png");
    tile.dispatchEvent(new Event("load"));

    expect(onLoaded, "挂了三次就回调三次的话，长生命周期图层的监听器会无限增长").toHaveBeenCalledTimes(1);
  });

  it("给了接管函数 ⇒ 交给它加载，本库不碰 tile.src，但仍在旁边观察", () => {
    const onRequest = vi.fn();
    const takeover = vi.fn();
    const load = createTileLoadFunction(() => ({
      observer: { onRequest },
      takeover,
    }))!;
    const tile = makeTile();

    load(tile, "https://tiles.example/x.png");

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(takeover).toHaveBeenCalledWith(tile, "https://tiles.example/x.png");
    expect(tile.getAttribute("src"), "接管时加载由调用方负责，本库不得替他决定").toBeNull();
  });

  it("观察者抛错不得影响加载（在旁边看，不是链路的一环）", () => {
    const load = createTileLoadFunction(() => ({
      observer: {
        onRequest: () => {
          throw new Error("observer boom");
        },
      },
    }))!;
    const tile = makeTile();

    expect(() => load(tile, "https://tiles.example/y.png")).not.toThrow();
    expect(tile.getAttribute("src"), "回调抛错后仍要完成默认加载").toBe("https://tiles.example/y.png");
  });

  it("换一个观察者立即生效（每次调用重新读，不需要重建图层）", () => {
    let current: TileLoadObserver = { onRequest: vi.fn() };
    const load = createTileLoadFunction(() => ({ observer: current }))!;
    const tile = makeTile();
    load(tile, "https://tiles.example/1.png");
    expect(current.onRequest).toHaveBeenCalledTimes(1);

    const next = { onRequest: vi.fn() };
    current = next;
    load(tile, "https://tiles.example/2.png");
    expect(next.onRequest, "SDK 手上那个函数身份不变，但它转发到最新观察者").toHaveBeenCalledTimes(1);
  });

  it("两个包装器依次用同一块元素 ⇒ 事件只回调**当前**的观察者（归属会转移）", () => {
    // 回归：去重状态若只是「这块元素登记过没有」并把第一个观察者 getter 捕获进闭包，
    // 后来的拥有者就永远收不到结果（图层重建 / 多个网络图层复用同一块元素时），
    // 而已卸载的那一方反而还在被回调。现在的语义是「监听器只挂一次，归属每次更新」。
    const first = vi.fn();
    const second = vi.fn();
    const loadA = createTileLoadFunction(() => ({ observer: { onLoaded: first } }))!;
    const loadB = createTileLoadFunction(() => ({ observer: { onLoaded: second } }))!;
    const tile = makeTile();

    loadA(tile, "https://tiles.example/from-a.png");
    loadB(tile, "https://tiles.example/from-b.png");
    tile.dispatchEvent(new Event("load"));

    expect(second, "当前拥有者收到结果").toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0]![0].url).toBe("https://tiles.example/from-b.png");
    expect(first, "前一个包装器不再是拥有者，不该再被回调").not.toHaveBeenCalled();
  });

  it("归属转移之后仍然「每个元素只挂一次监听」（不会随包装器数量增长）", () => {
    const calls: number[] = [];
    const tile = makeTile();
    for (let index = 0; index < 5; index += 1) {
      const load = createTileLoadFunction(() => ({ observer: { onLoaded: () => calls.push(index) } }))!;
      load(tile, `https://tiles.example/${index}.png`);
    }
    tile.dispatchEvent(new Event("load"));
    expect(calls, "五次加载只挂一份监听 ⇒ 只回调一次（最后那个拥有者）").toEqual([4]);
  });

  it("defaultTileLoad 就是把 URL 交给图片元素（实测能恢复与不设钩子时相同的加载结果）", () => {
    const tile = makeTile();
    defaultTileLoad(tile, "https://tiles.example/z.png");
    expect(tile.getAttribute("src")).toBe("https://tiles.example/z.png");
  });
});
