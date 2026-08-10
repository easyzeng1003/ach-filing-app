/**
 * 品牌／主題 URL 參數解析煙霧測試
 */
import assert from "node:assert/strict";
import {
  DEFAULT_APP_NAME,
  DEFAULT_BRANDING_COLORS,
  resolveBranding,
  shadeHex,
} from "../src/lib/branding";

assert.equal(shadeHex("#00695c", -0.22).length, 7);
assert.equal(shadeHex("#fff", 0), "#ffffff");

const def = resolveBranding(new URLSearchParams());
assert.equal(def.name, DEFAULT_APP_NAME);
assert.equal(def.primary, DEFAULT_BRANDING_COLORS.primary);
assert.equal(def.iconPreset, "account_balance");
assert.equal(def.iconUrl, null);

const custom = resolveBranding(
  new URLSearchParams({
    name: "我的ACH工具",
    primary: "1566c0",
    accent: "ff9800",
    icon: "build",
  }),
);
assert.equal(custom.name, "我的ACH工具");
assert.equal(custom.primary, "#1566c0");
assert.equal(custom.accent, "#ff9800");
assert.equal(custom.iconPreset, "build");
assert.ok(custom.header.startsWith("#"));

const withUrl = resolveBranding(
  new URLSearchParams({
    icon: "https://example.com/logo.png",
  }),
);
assert.equal(withUrl.iconUrl, "https://example.com/logo.png");

console.log("OK branding params:", custom.name, custom.primary, custom.iconPreset);
