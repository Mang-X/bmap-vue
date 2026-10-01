/**
 * 组件 manifest 生成器的**纯函数**部分（issue #45）
 *
 * 单独成文件而不是留在 `generate-manifest-artifacts.mts` 里，是为了能**被用例直接
 * import**：那个脚本是顶层脚本（没有 `main()` 保护），用例 import 它就会连带执行
 * 整段生成逻辑并写盘。`docs-brand-boundary.mts` / `raw-sdk-boundary.mts` /
 * `api-forgotten-boundary.mts` 是同一理由的先例。
 *
 * 之所以要有纯函数这个形态：发布身份门禁需要断言「volar.d.ts 里的 `typeof import(...)`
 * 指向当前包名」，而**不应该**去读磁盘上那个文件——它是 gitignore 的生成物，另一个
 * 用例（`manifest-check.test.ts`）会 `rmSync` 它来验证「缺失时也能重新生成」，两个
 * test file 在不同 worker 并行时那构成真实竞态。断言逻辑与文件系统解耦之后就没有窗口。
 *
 * 文件是否真的被打进包，继续由 `check:pack-contents` 与 CI 的 package job 负责。
 */

/**
 * 生成 `volar.d.ts` 的**纯函数**形式（输入组件名 + 发布包名，输出文件内容）。
 *
 * 抽出来是为了让「发布身份是否正确」这条门禁**不需要碰磁盘上的共享文件**：
 * 原先身份测试只能去读/生成 `packages/bmap-vue/volar.d.ts`，而那个文件是 gitignore
 * 的生成物，另一个用例（`manifest-check.test.ts`）会 `rmSync` 它来验证「缺失时也能
 * 重新生成」。两个 test file 在不同 worker 并行时，那构成一个真实的竞态窗口：
 * 身份测试刚生成完、还没读，manifest-check 把它删了——于是随机报「未生成」。
 *
 * 纯函数让断言与文件系统解耦。**文件是否真的被打进包**继续由
 * `check:pack-contents` 与 CI 的 package job 负责——那才是真实消费路径的判据。
 *
 * 包名必须从参数传入而非在这里读 manifest：读 manifest 就又把 I/O 拖回来了。
 */
export function renderVolarDts(componentNames: readonly string[], packageName: string): string {
  const componentsLines = componentNames.map(
    (name) => `    ${name}: typeof import('${packageName}')['${name}']`,
  )
  return [
    '// Generated file. Do not edit directly.',
    "declare module 'vue' {",
    '  export interface GlobalComponents {',
    ...componentsLines,
    '  }',
    '}',
    "declare module '@vue/runtime-core' {",
    '  export interface GlobalComponents {',
    ...componentsLines,
    '  }',
    '}',
    'export {}',
    '',
  ].join('\n')
}

