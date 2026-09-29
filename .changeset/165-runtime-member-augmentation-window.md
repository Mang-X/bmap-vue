---
"bmap-vue": patch
---

# #165 复核：官方控件成员面「晚 ~150ms 补齐」的窗口，以及三条被推翻的审计结论

## 一、修正认知：#165 审计的三个 🔴 里，两条的**前提**是错的

原审计（`docs/zh-CN/contributing/165-runtime-audit-2026-09-27.md`）把
`CityListControl` 的命令面与 `CopyrightControl#removeCopyright` 记成「运行时不存在」，
并据此建议删掉 `CityListCommandApi` 的两个公开 API。**复核否掉了这个前提**：

官方 4.0.5 的**控件成员面是分阶段就位的**。`BMap.Map` 与全部控件构造器先到位，
控件的完整成员面**晚约 150ms 才挂上原型**（窗口 126–167ms，4 次独立复跑）。
稳定态读数：

- `CityListControl.prototype` **26** 个成员，`toggle` / `getCityName` / `open` / `close` /
  `getTriggerDom` **全部在位且真调得动**（`getCityName()` → `"中国"`）；
- `CopyrightControl.prototype` **16** 个成员，`removeCopyright` **在位且调得动**。

⇒ `toggle()` / `getCityName()` **不是**「必然失败的公开 API」，**保留**。
取证工具：`scripts/probe-165c-surface.mts`（可重跑）。

## 二、真正的缺陷：卸载落在那个窗口里

窗口内 `addCopyright` / `getCopyright` / `getCopyrightCollection` **已经可用**（先到的批次），
而 `removeCopyright` **还不在**（后补的批次）⇒ **挂载成功、卸载抛
`BMAP_SDK_CALL_FAILED`**，且 `removeCopyrightControlIfEmpty` 排在抛错之后
⇒ 共享控件**永远不从地图上摘除**、位置缓存条目**永不淘汰**。

窗口**可达**：补齐不是被建图触发的（不建图纯等也会补齐），而本库正是从官方 loader
判就绪那一刻开始建图建控件。

**处置**：`ControlDriver.canRemoveCopyright()`（新增，结构性判据）+ `CopyrightControl.vue`
的 `deferCopyrightRemoval()`——摘不到时**延后**到成员补齐之后再摘（4 次 × 50ms），
而不是静默跳过（那会让版权项永久残留在 SDK 上）。延后确定会生效，因为补齐是**追溯**的
（被补的是原型，已存在的实例自动获得成员）。

另修正一处顺序缺陷：`removeCopyrightControlIfEmpty` 判空时**排除本组件自己那条**
（它此刻还在 SDK 上），否则「稍后会被摘掉的一条」会把共享控件永久留在图上。

## 三、Fake：不是「严格超集」，而是**无法表达窗口**

`FakeV4CityListControl` / `FakeV4CopyrightControl` 的这四个成员与稳定态运行时**一致**，
Fake 没有多实现。真实缺陷是：它**没法表达那 ~150ms 的窗口**（成员要么永远在、要么永远不在），
于是「窗口内卸载会失败」根本进不去测试。

新增 `packages/test-utils/fake-bmap-v4/runtime-member-shape.ts`：
`installDeferredRuntimeMembers()` 卸下后补批次、`resetRuntimeMemberShape()` 装回。
门禁见 `tests/behavior/control-runtime-member-window.test.ts`（9 条）。

## 四、注释 / 文档更正（无行为变化）

- `Marker.anchor` 仍是 `recreate`，但**理由换了**：`setAnchor` / `getAnchor` 在实例上**在**
  （原注释「等异步标注模块加载才挂 setter」是错的）；真正理由是 `getAnchor()` 返回
  **当前值**（未设时 `null` = SDK 内置默认锚点，无从构造出来再传回去）⇒「值变回
  `undefined`」没有落点。
- `CustomOverlay` 的 `setZIndex` / `setMinZoom` / `setMaxZoom` / `setOptions`：
  官方 `CustomOverlay.d.ts` **也没有**声明它们（不是「声明有、运行时无」）。描述符的
  `recreate` 分类**本来就正确**，补上 live 复核依据。

## 五、未决（按硬证据规则记「无法验证」）

`<CityListControl>.expand` 是否真的能展开面板**本轮无法判定**：headless 下该控件
**始终不渲染面板 DOM**（`getTriggerDom()` 恒 `undefined`，构造期 `expand: true` 也不出面板），
所以「调用前后 DOM 无变化」**不是**「调用是空操作」的证据。`choice` 分类**按官方声明保留**，
不改成 `recreate`——参考实现虽把它归为 `ctorOnlyProps`，但本仓库 ADR 明确把手抄数组列为
不该照抄的东西，且本轮读数既不支持也不否证。**证伪或证实之前不要动它。**
