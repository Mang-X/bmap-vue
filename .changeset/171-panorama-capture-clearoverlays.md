---
"@mangax/bmap-vue": minor
---

# #171 item I：`Panorama.capture()` / `Panorama.clearOverlays()`

`driver/types/panorama.ts` 曾把这两条列为**刻意不加**的官方成员，理由是「当前没有任何组件
或 composable 会调用它们」。该结论被推翻：官方 React 参考实现的 `PanoramaRef` 两条都暴露，
2026-09 的 live probe 也确认**运行时真的可调用**（`capture()` 返回了 1,639 字节的 data URL，
`clearOverlays()` 不抛错），而 `clearOverlays` 补的正是「逐个摘除」做不到的那条路。

> ⚠️ 一条**方法学更正**：此前有一次 live probe 读 `BMap.Panorama.prototype` 拿到全 `false`，
> 结论写成「成员不存在」。那**是读的方法不对，不是成员不存在**——`Panorama` 的成员挂在
> **实例**上，不在原型上。要复测请读**实例**。`getLinks` 当初也是因此被误判的。

## 改了什么

- `PanoramaViewerDriver` 新增 `capture(viewer, options?)` 与 `clearOverlays(viewer)`，
  `PanoramaCaptureOptions`（`quality?` / `type?`，逐键照抄官方内联声明）随之为新导出类型。
- `<Panorama ref>` 新增 `capture(options?)` 与 `clearOverlays()`。
- Fake v4：`FakeV4Panorama#capture` + `screenshot` / `failNextCapture`（`clearOverlays` 此前
  已有，补了记账口径的注释）。

## 三条口径

1. **`capture()` 是读命令，返回 `string | null`**。官方声明是 `string | undefined`（「当前
   渲染器不支持截图时返回 undefined」），Driver 归一成 `null`，与读取面其余成员一致。
2. **未就绪 / 已释放时抛 `BMAP_RESOURCE_DISPOSED`，不是 `null`、不是静默 no-op**。这是它与
   `getLinks()`（未就绪给空数组）的**唯一**分歧，理由：`getLinks` 的空与非空不承载语义，而
   `capture` 的 `null` 是一条**有后果的判断**——静默降级会让已卸载的组件被读成「这个环境截不了图」。
3. **不镜像成组件状态、不做命令 ⇄ props 同步**。`options` 才是主模型。

`clearOverlays()` **不销账、不代替摘除路径**：组件卸载时每个 `<PanoramaLabel>` 仍走自己的
`removeLabel()`（否则同一个标注会被销账两次）。

## 顺带关掉的一个 Fake 保真缺口

`FakeV4PanoramaService` 的 `byId` / `byLocation` 回包此前**不带 `links`**，而官方
`PanoramaData` 把 `links: PanoramaLink[]` 声明成**非可选**。后果是「Driver 丢弃 `links`」那条
断言一直是**在一条本来就没有该字段的回包上通过的**——判别力为零。回包已补上 `links`，并由
单测钉住「`PanoramaDataInfo` 确实不透出 `links`」。`tiles` 仍不透出（官方 `PanoramaTileData`
是瓦片贴图，属渲染内部）。

## 刻意没做：剩下 16 个官方事件

`<Panorama>` 订阅官方 24 个事件中的 8 个。**本票不补剩下的**——判据是「事件要有可核对的
消费者与载荷语义」，不是「官方有」。详见 `driver/types/panorama.ts` 的说明与报告。
