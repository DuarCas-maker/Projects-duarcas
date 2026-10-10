import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postcss from "postcss";

const root = new URL("../", import.meta.url);
const files = ["app/globals.css", "app/project-os.css"];
const css = (await Promise.all(files.map(file => readFile(new URL(file, root), "utf8")))).join("\n");
const ast = postcss.parse(css);
const tokens = new Map();
ast.walkRules(":root", rule => rule.walkDecls(declaration => tokens.set(declaration.prop, declaration.value)));
const palette = {
  "--brand-black": "#000000", "--brand-white": "#FFFFFF",
  "--brand-wine": "#722F37", "--brand-purple": "#2A0D3A",
};
for (const [name, hex] of Object.entries(palette)) assert.equal(tokens.get(name)?.toUpperCase(), hex);
const resolve = (value, seen = new Set()) => {
  if (/^#[\da-f]{6}$/i.test(value)) return value;
  const token = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  assert.ok(token && !seen.has(token), `Invalid or circular palette token: ${value}`);
  return resolve(tokens.get(token), new Set([...seen, token]));
};
const luminance = color => {
  const rgb = color.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb.reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
};
const contrast = (foreground, background) => {
  const pair = [luminance(resolve(foreground)), luminance(resolve(background))].sort((a, b) => b - a);
  return (pair[0] + .05) / (pair[1] + .05);
};
for (const [foreground, background] of [
  ["var(--brand-white)", "var(--brand-wine)"],
  ["var(--brand-white)", "var(--wine-hover)"],
  ["var(--brand-white)", "var(--brand-purple)"],
  ["var(--brand-wine)", "var(--wine-soft)"],
  ["var(--brand-purple)", "var(--purple-soft)"],
  ["var(--muted-copy)", "var(--paper)"],
  ["var(--on-dark-muted)", "var(--brand-black)"],
]) assert.ok(contrast(foreground, background) >= 4.5, `${foreground} / ${background} needs readable contrast`);
assert.equal(tokens.get("--primary"), "var(--brand-wine)");
assert.equal(tokens.get("--sidebar-accent"), "var(--brand-purple)");
assert.equal(tokens.get("color-scheme"), "light");
assert.ok(!css.includes("prefers-color-scheme"), "System dark mode must not replace the institutional palette");
assert.ok(!/#(?:b8ff38|b7ff34|7894ff|7bb700|eaf5d6|0b1613)\b/i.test(css), "Legacy brand colors remain");
const rootTokens = new Set(tokens.keys());
ast.walkDecls(declaration => {
  for (const match of declaration.value.matchAll(/var\((--[\w-]+)/g)) {
    assert.ok(rootTokens.has(match[1]) || match[1] === "--project-accent", `Undefined theme token ${match[1]}`);
  }
});
for (const accent of ["lime", "blue", "violet", "orange", "cyan", "pink", "yellow", "red", "gray", "green"])
  assert.ok(css.includes(`.accent-${accent}`), `Existing project accent ${accent} must remain supported`);
assert.ok(!css.includes(".project-monogram::first-line"), "Project initials must not override the accessible white foreground");
const declarations = selector => {
  const values = new Map();
  ast.walkRules(selector, rule => rule.walkDecls(declaration => values.set(declaration.prop, declaration.value)));
  return values;
};
assert.equal(declarations(".login-screen").get("background"), "var(--brand-black)", "Only the login backdrop uses solid black");
assert.equal(declarations(".login-card").get("background"), "var(--brand-white)", "The login card stays white");
assert.equal(tokens.get("--paper"), "#FAFAFA", "The rest of the application keeps its light surfaces");
const login = await readFile(new URL("app/login/login-form.tsx", root), "utf8");
assert.ok(login.includes('className="login-wordmark">DUARCAS</span>'), "The login wordmark must display DUARCAS in uppercase");
assert.equal(declarations(".login-brand").get("place-items"), "center", "The login wordmark must be centered");
assert.equal(declarations(".login-brand > svg").get("position"), "absolute", "The lock icon must not shift the wordmark's center");
assert.ok(!login.includes("<span>OS</span>") && !login.includes("Accede con tu correo y contraseña de Supabase"), "Old login badge and helper copy must be removed");
assert.ok(login.includes('type="email"') && login.includes('type="password"') && login.includes('action: "login"'), "Owner authentication form must remain intact");
const manifest = JSON.parse(await readFile(new URL("public/manifest.webmanifest", root), "utf8"));
assert.equal(manifest.background_color, palette["--brand-white"]);
assert.equal(manifest.theme_color, palette["--brand-black"]);
const icon = await readFile(new URL("public/favicon.svg", root), "utf8");
for (const hex of icon.match(/#[\da-f]{6}/gi)) assert.ok(Object.values(palette).includes(hex.toUpperCase()));
console.log("Palette passed: exact brand colors, valid CSS/tokens, readable primary/status contrast, legacy project IDs and PWA branding. Live API calls: 0.");
