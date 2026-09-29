import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const literal = source.match(/const colorPresets=(\[[^;]+\]);/)?.[1];
assert.ok(literal, 'Color presets exist');
const presets = Function(`return ${literal}`)();
assert.equal(presets.length, 10);
for (const [color, label] of presets) {
  assert.match(color, /^#[0-9a-f]{6}$/i, 'The button value must be a valid CSS color');
  assert.ok(label && !label.startsWith('#'), 'The visible text must be a color name');
}
