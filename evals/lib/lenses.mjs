// Lens registry, read from the SOURCE OF TRUTH rather than duplicated.
//
// The display names come out of action.yml's own NAMES table and the persona
// names come out of the lenses/*.md H1s. Duplicating either here would let the
// evals drift from the action — and a drifted eval passes while CI breaks.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./harness.mjs";

/** Parse the `const NAMES = { ... }` table straight out of action.yml. */
export function lensNames(yml = readFileSync(join(ROOT, "action.yml"), "utf8")) {
  const m = yml.match(/const NAMES = \{([\s\S]*?)\n\s*\};/);
  if (!m) throw new Error("action.yml: could not find the `const NAMES = {…}` lens table");
  const names = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^\s*"?([a-z0-9-]+)"?:\s*"([^"]+)",?\s*$/);
    if (kv) names[kv[1]] = kv[2];
  }
  if (!Object.keys(names).length) throw new Error("action.yml: NAMES table parsed empty");
  return names;
}

export const LENS_KEYS = Object.keys(lensNames());
export const lensName = (key) => lensNames()[key];

export const personaPath = (key) => join(ROOT, "lenses", `${key}.md`);
export const readPersona = (key) => readFileSync(personaPath(key), "utf8");
export const readShared = () => readFileSync(join(ROOT, "lenses", "shared-instructions.md"), "utf8");

/** The persona's H1 — what a model most often echoes back as `lens`. */
export function personaHeading(key) {
  const first = readPersona(key).split("\n").find((l) => l.startsWith("# "));
  return first ? first.replace(/^#\s*/, "").trim() : null;
}

/** Every lens key the library ships, from the one registry that defines them. */
export function shippedLensKeys() {
  return lensManifest().lenses.map((l) => l.key).sort();
}

/** The lens registry — the single source of truth for which lenses exist. */
export function lensManifest() {
  return JSON.parse(readFileSync(join(ROOT, "lenses", "manifest.json"), "utf8"));
}
