---
"bmap-vue": patch
---

第三方假设清理 #128（F-2 / F-3 / F-4）：remove-first + 仅对仍属契约的第三方行为取证

- **F-2（JSONP 回调全局名占用 / foreign 捕获）— 保留 + 取证 + gate**：新增 `pnpm probe:jsonp-callback`
  与判定层 `probe-jsonp-callback-verdicts.mts`；live 读数固化在
  `tests/behavior/fixtures/probe-jsonp-callback.live.json`；可回归 gate =
  `probe-jsonp-callback-verdicts.test.ts` 的 COMPLETE ↔ live 漂移守卫 +
  `ScriptLoader.test.ts` 的 foreign 单测。`SharedLoadTask` 模块头补齐 guarantee 措辞
  （本库保证 install/release 可靠 vs 官方行为可改），仅作用于显式高级 `customScriptV4Provider`
  路径，**不进 Stable 承诺**。
- **F-3（destroy/dispose 幂等 + 销毁期回调）— 保留 + 取证**：新增 `pnpm probe:destroy-idempotency`
  （必须 chrome-headless-shell，系统 Chrome 会挂死 `setId`）与判定层；
  live 读数见 `tests/behavior/fixtures/probe-destroy-idempotency.live.json`。
  **与先前占位假说相反、以读数为准**：Map 第二次 `destroy()` 抛错（重复销毁不是 no-op）、
  Autocomplete 重复 `dispose()` 本轮不抛、Panorama 首次 `destroy()` 即抛 `START`、
  销毁期会触达 Map destroy 事件（count=1）。契约措辞仍一律「本库保证」；
  `driver-contract.ts` 的 F-3 注释按真实读数更新。
- **F-4（原生 `addEventListener` 去重）— 生产中性，不 probe**：注释改写为「夹具记账」，
  不再把 Fake 侧行为冒充官方去重语义。

审计表 F-2 / F-3 行升级为 PROBED（2026-09-24），F-4 维持 remove-first 不取证。
