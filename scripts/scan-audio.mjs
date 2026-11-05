#!/usr/bin/env node
/**
 * Builds public/audio/manifest.json from the files in public/audio.
 *
 * Drop audio files into public/audio (subfolders become categories, unless
 * meta.json says otherwise), then run:  npm run scan-audio
 *
 * Optional metadata lives in public/audio/meta.json:
 * {
 *   "categories": [{ "id": "funny", "name": "Funny expressions" }],
 *   "sounds": {
 *     "funny_001.mp3": { "title": "...", "subtitle": "...", "category": "funny", "difficulty": "easy" }
 *   }
 * }
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const AUDIO = path.join(ROOT, "public", "audio");
const META = path.join(AUDIO, "meta.json");
const OUT = path.join(AUDIO, "manifest.json");

const EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac"]);

function walk(dir, base = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) {
      // skip node-style folders, keep normal ones
      out.push(...walk(path.join(dir, entry.name), rel));
    } else if (EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push(rel);
    }
  }
  return out;
}

function duration(file) {
  try {
    const raw = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        file,
      ],
      { encoding: "utf8" }
    ).trim();
    return Math.round(Number(raw) * 100) / 100;
  } catch {
    return 2;
  }
}

function slug(s) {
  return s
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const meta = fs.existsSync(META) ? JSON.parse(fs.readFileSync(META, "utf8")) : {};
const metaSounds = meta.sounds || {};
const categories = meta.categories || [];
const files = walk(AUDIO).filter((f) => !f.endsWith("manifest.json"));

const sounds = files.map((rel) => {
  const fileName = path.basename(rel);
  const folder = path.dirname(rel);
  const m = metaSounds[rel] || metaSounds[fileName] || {};
  const category = m.category || (folder !== "." ? slug(folder) : "misc");
  return {
    id: m.id || slug(fileName),
    title: m.title || slug(fileName).replace(/_/g, " "),
    subtitle: m.subtitle || "",
    category,
    file: rel.split(path.sep).join("/"),
    duration: duration(path.join(AUDIO, rel)),
    difficulty: m.difficulty || "medium",
  };
});

// make sure every category used by a sound exists
const known = new Set(categories.map((c) => c.id));
for (const s of sounds) {
  if (!known.has(s.category)) {
    known.add(s.category);
    categories.push({
      id: s.category,
      name: s.category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    });
  }
}

const manifest = { categories, sounds };
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + "\n");

console.log(`Scanned ${sounds.length} sound(s)`);
for (const s of sounds) {
  console.log(`  ${s.duration.toFixed(2)}s  ${s.category.padEnd(12)} ${s.file}`);
}
console.log(`Wrote ${path.relative(ROOT, OUT)}`);
