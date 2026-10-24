#!/usr/bin/env node
/**
 * Render a manually positioned Flow spec.
 *
 * The parent `flow-render.js --spec` strips lane geometry during
 * normalization, which is fine for auto-laid-out specs but breaks a
 * hand-positioned loop diagram. This wrapper keeps the authored lane rows
 * and hands the spec straight to the same renderer.
 *
 *   node docs/build-flow.mjs docs/flow.patch.json docs/flowchart-patch.svg
 *   node docs/build-flow.mjs docs/flow.patch.json docs/flowchart-patch-dark.svg dark
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { normalizeSpec } from '../../src/flow/index.js';
import { renderSVG } from '../../src/flow/render.js';

const [specPath, outPath, themeArg] = process.argv.slice(2);
if (!specPath || !outPath) {
  console.error('usage: node docs/build-flow.mjs <spec.json> <out.svg> [dark]');
  process.exit(2);
}

const raw = JSON.parse(readFileSync(specPath, 'utf8'));
const { spec, issues } = normalizeSpec(raw);

// normalizeSpec keeps node x/y/w/h but intentionally drops lane geometry.
const authoredLanes = new Map((raw.lanes || []).map((lane) => [lane.id, lane]));
for (const lane of spec.lanes) {
  const authored = authoredLanes.get(lane.id);
  if (!authored) continue;
  if (Number.isFinite(authored.y)) lane.y = authored.y;
  if (Number.isFinite(authored.height)) lane.height = authored.height;
}

const width = Number.isFinite(raw.width) ? raw.width : 2400;
const height = Number.isFinite(raw.height) ? raw.height : 900;
const theme = themeArg === 'dark' ? 'dark' : 'light';
const svg = renderSVG(spec, { width, height, theme });
writeFileSync(outPath, svg, 'utf8');

const warnings = issues.filter((issue) => issue.level !== 'warn');
console.log(`${outPath} ${width}x${height} ${theme}`);
if (warnings.length) console.error(warnings.map((issue) => issue.message).join('\n'));
