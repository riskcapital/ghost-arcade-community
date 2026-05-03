#!/usr/bin/env node
/**
 * fix-mojibake.mjs
 *
 * One-shot recovery for the encoding round-trip an "encoded punctuation
 * cleanup" pass left across our .svelte files. Symptoms:
 *
 *   "â—" / "â— REC"           was "●" / "● REC"   (record-button icon)
 *   "ðŸ”'" / "ðŸ"Š"          was 🔒 / 🔊         (lock + speaker emoji)
 *   "───"                 was "───"             (section dividers)
 *   "â€\""                       was "—"             (em-dash in UI strings)
 *   "×"                         was "×"             (multiplication sign)
 *
 * The corruption is "UTF-8 bytes decoded as CP-1252, then re-encoded as
 * UTF-8". Reversing it character-by-character is brittle because the
 * length of the original char (1, 2, 3, or 4 UTF-8 bytes) determines
 * how many mojibake characters it produces, AND the CP-1252 round-trip
 * eats some bytes (0x81, 0x8D, 0x8F, 0x90, 0x9D have no CP-1252 mapping
 * and silently become U+0081 etc. — Latin-1 fallthroughs).
 *
 * Algorithm: identify each corrupted *character* by its leading byte —
 * any char in the U+0080–U+00FF range that's part of a recognizable
 * mojibake sequence — and look up the original Unicode code point in a
 * precomputed table. The table is built once from the set of original
 * characters we know our codebase used (em-dash, arrows, geometric
 * shapes, the handful of emoji).
 */

import fs from 'node:fs';
import path from 'node:path';

// Original characters we expect in the codebase. For each, derive the
// mojibake form by encoding it as UTF-8, then reading those bytes as
// CP-1252 (with Latin-1 fallthrough for unmapped 0x80–0x9F bytes), then
// re-encoding as UTF-8. The resulting JS string is what the corrupted
// file contains; its replacement is the original.
const ORIGINALS = [
  // Em-dash + en-dash (most common — ~73 hits)
  '—', '–',
  // Smart quotes
  '“', '”', '‘', '’',
  // Ellipsis
  '…',
  // Box-drawing (used as section dividers in JS comments)
  '─', '═', '║', '┃', '╔', '╗', '╚', '╝',
  // Triangles for chevrons / dropdowns
  '▾', '▸', '▶', '▼', '►', '▲',
  // Geometric — REC icon, status indicators, list bullets
  '●', '○', '◆', '▪', '▫', '■', '□', '◇',
  // Bullet
  '•',
  // Arrows
  '→', '←', '↑', '↓', '↔',
  // Math
  '×', '−', '°', '±', '·',
  // Half-block / bar
  '▮', '▯',
  // Common emoji we use in UI labels
  '🔒', '🔊', '🔇', '🎛', '🔧', '🚀', '🎨', '🤖', '🔀', '🖥', '📱', '⚡', '✨', '⏵', '⏸', '⏹', '⏺', '🔴', '⚙', '⚠', '⏰', '🌟', '💾', '📁', '📂', '🌐', '🌍',
  // Music notation
  '♪', '♫', '♬', '♩',
];

// CP-1252 maps these byte values to specific characters; everything
// else in 0x80–0x9F is "undefined" and Windows treats them as Latin-1
// pass-through (U+0080–U+009F).
const CP1252_OVERRIDES = new Map([
  [0x80, '€'], [0x82, '‚'], [0x83, 'ƒ'], [0x84, '„'],
  [0x85, '…'], [0x86, '†'], [0x87, '‡'], [0x88, 'ˆ'],
  [0x89, '‰'], [0x8A, 'Š'], [0x8B, '‹'], [0x8C, 'Œ'],
  [0x8E, 'Ž'],
  [0x91, '‘'], [0x92, '’'], [0x93, '“'], [0x94, '”'],
  [0x95, '•'], [0x96, '–'], [0x97, '—'], [0x98, '˜'],
  [0x99, '™'], [0x9A, 'š'], [0x9B, '›'], [0x9C, 'œ'],
  [0x9E, 'ž'], [0x9F, 'Ÿ'],
]);

function byteToChar(b) {
  return CP1252_OVERRIDES.get(b) || String.fromCharCode(b);
}

// Build the bad → good map by simulating the corruption forward from
// each known original character.
const FIX_TABLE = new Map();
for (const original of ORIGINALS) {
  const utf8Bytes = Buffer.from(original, 'utf8');
  // Misinterpret each byte as CP-1252 (or Latin-1 fallthrough)
  let mojibake = '';
  for (const b of utf8Bytes) mojibake += byteToChar(b);
  if (mojibake !== original && !FIX_TABLE.has(mojibake)) {
    FIX_TABLE.set(mojibake, original);
  }
}

// Apply the longest patterns first so prefix collisions can't bite us
// (e.g. some 4-byte emoji mojibake starts with the same 2 chars as a
// 3-byte arrow mojibake).
const SORTED = [...FIX_TABLE.entries()].sort((a, b) => b[0].length - a[0].length);

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'public', 'ISF', 'cube shaders', 'dist-electron', '.svelte-kit'].includes(f.name)) continue;
    const full = path.join(dir, f.name);
    if (f.isDirectory()) walk(full, out);
    else if (/\.(svelte|ts|tsx|js|jsx|cjs|mjs|md|html|json|css)$/.test(f.name)) out.push(full);
  }
  return out;
}

let totalFiles = 0;
let totalReplacements = 0;
const perReplacement = new Map();

for (const f of walk('.')) {
  let s = fs.readFileSync(f, 'utf8');
  const before = s;
  for (const [bad, good] of SORTED) {
    if (s.includes(bad)) {
      const count = s.split(bad).length - 1;
      totalReplacements += count;
      perReplacement.set(`${JSON.stringify(bad)} → ${JSON.stringify(good)}`, (perReplacement.get(`${JSON.stringify(bad)} → ${JSON.stringify(good)}`) || 0) + count);
      s = s.split(bad).join(good);
    }
  }
  if (s !== before) {
    fs.writeFileSync(f, s);
    totalFiles++;
  }
}

console.log(`[fix-mojibake] Updated ${totalFiles} files, ${totalReplacements} total replacements`);
console.log('[fix-mojibake] Top replacements:');
for (const [k, n] of [...perReplacement.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${n.toString().padStart(4)} × ${k}`);
}
