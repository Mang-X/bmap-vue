import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../packages/bmap-vue/package.json"), "utf8"),
);

export const versionDefine = {
  __VERSION__: JSON.stringify(packageJson.version),
};
