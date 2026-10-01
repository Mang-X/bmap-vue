/**
 * 发布身份的派生规则（issue #45）
 *
 * 1.0 把包名从无 scope 的 `bmap-vue` 迁到 `@mangax/bmap-vue`（npm 上 `bmap-vue`
 * 归他人所有，`1.0.0` 那个版本号也已被占用）。
 *
 * 这些函数存在的唯一理由：**改包名只需要改 `packages/bmap-vue/package.json` 一个字段**。
 * 散落在各脚本里的字面量是「改一处、漏三处」的来源——漏掉的那处不会报错，只会让门禁
 * 静默不生效。所以这里逐条钉住派生规则，特别是 npm 那两个**不一致**的命名口径。
 */
import { describe, expect, it } from "vitest";
import {
  isOwnTarball,
  importSpecifier,
  releaseIdentityOf,
} from "../../scripts/release-identity.mts";

describe("#45 发布身份派生", () => {
  it("读出当前包名与版本", () => {
    const id = releaseIdentityOf({ name: "@mangax/bmap-vue", version: "1.0.0-rc.0" });
    expect(id.name).toBe("@mangax/bmap-vue");
    expect(id.version).toBe("1.0.0-rc.0");
    expect(id.isScoped).toBe(true);
  });

  it("无 scope 名也算合法身份（迁移前的形态，且迁移随时可能回退）", () => {
    // 不写成「只认 scoped」：那条判据在 scope 撤销时会反过来挡住正确的包。
    const id = releaseIdentityOf({ name: "bmap-vue", version: "1.0.0" });
    expect(id.isScoped).toBe(false);
    expect(id.installedDirName).toBe("bmap-vue");
  });

  describe("tarball 文件名：npm 去掉前导 @", () => {
    it("scoped 包打出来**不带**前导 @", () => {
      // 实测 `npm pack @mangax/bmap-vue@1.0.0-rc.0` → `mangax-bmap-vue-1.0.0-rc.0.tgz`。
      // 与下面的 `installedDirName` 规则**不一致**，那是 npm 的既有行为，两个都要钉。
      const id = releaseIdentityOf({ name: "@mangax/bmap-vue", version: "1.0.0-rc.0" });
      expect(isOwnTarball("mangax-bmap-vue-1.0.0-rc.0.tgz", id)).toBe(true);
      expect(isOwnTarball("@mangax-bmap-vue-1.0.0-rc.0.tgz", id)).toBe(false);
    });

    it("不误认别的东西", () => {
      const id = releaseIdentityOf({ name: "@mangax/bmap-vue", version: "1.0.0-rc.0" });
      for (const other of [
        "bmap-vue-1.0.0-rc.0.tgz", // 换名前的旧包名
        "vue-3.5.0.tgz",
        "mangax-bmap-vue-1.0.0-rc.0.tgz.map",
        "mangax-bmap-vue.tgz",
      ]) {
        expect(isOwnTarball(other, id), other).toBe(false);
      }
    });

    it("**同包名但版本不同**不得被认领（PR 评审 P2）", () => {
      // 前缀匹配会让 `rc.9` 也命中，而 `findTarball()` 按字符串排序取「最后一个」——
      // `rc.9` 排在 `rc.0` 之后，于是验证了旧包。CI 因前置 `rm -rf .artifacts` 不易
      // 撞上，但 `pack:package` 不清理目录，本地 `pack:package && verify:package` 会中招。
      const id = releaseIdentityOf({ name: "@mangax/bmap-vue", version: "1.0.0-rc.0" });
      for (const other of [
        "mangax-bmap-vue-1.0.0-rc.9.tgz", // 更高 rc
        "mangax-bmap-vue-1.0.0-rc.10.tgz",
        "mangax-bmap-vue-1.0.0.tgz", // 正式版
        "mangax-bmap-vue-0.9.0.tgz", // 旧版本线
      ]) {
        expect(isOwnTarball(other, id), other).toBe(false);
      }
      expect(isOwnTarball("mangax-bmap-vue-1.0.0-rc.0.tgz", id)).toBe(true);
    });

    it("版本匹配是全等而非字典序（rc.10 不等于 rc.1）", () => {
      const id = releaseIdentityOf({ name: "@mangax/bmap-vue", version: "1.0.0-rc.10" });
      expect(isOwnTarball("mangax-bmap-vue-1.0.0-rc.10.tgz", id)).toBe(true);
      // 「rc.1」不是「rc.10」的前缀——字典序取最后一个会把这两个搞混
      expect(isOwnTarball("mangax-bmap-vue-1.0.0-rc.1.tgz", id)).toBe(false);
    });

    it("旧包名的 tarball 不再被认领（迁移后不该误取）", () => {
      const old = releaseIdentityOf({ name: "bmap-vue", version: "1.0.0-rc.0" });
      expect(isOwnTarball("bmap-vue-1.0.0-rc.0.tgz", old)).toBe(true);
      const now = releaseIdentityOf({ name: "@mangax/bmap-vue", version: "1.0.0-rc.0" });
      expect(isOwnTarball("bmap-vue-1.0.0-rc.0.tgz", now)).toBe(false);
    });
  });

  it("node_modules 里的目录名保留 @scope/name 原样", () => {
    // 与 tarball 文件名规则**不同**：npm 把 scoped 包装成 `node_modules/@scope/name`。
    const id = releaseIdentityOf({ name: "@mangax/bmap-vue", version: "1.0.0" });
    expect(id.installedDirName).toBe("@mangax/bmap-vue");
  });

  it("import 说明符带子路径", () => {
    const id = releaseIdentityOf({ name: "@mangax/bmap-vue", version: "1.0.0" });
    expect(importSpecifier(id)).toBe("@mangax/bmap-vue");
    expect(importSpecifier(id, "/ui-kit")).toBe("@mangax/bmap-vue/ui-kit");
  });

  it("manifest 缺字段时不崩（门禁要给出可读的错误，不是 TypeError）", () => {
    for (const bad of [{}, { name: 123 }, { name: "x", version: null }]) {
      const id = releaseIdentityOf(bad as { name?: unknown; version?: unknown });
      expect(id.name, JSON.stringify(bad)).toBeTypeOf("string");
      expect(id.isScoped).toBe(false);
    }
  });
});