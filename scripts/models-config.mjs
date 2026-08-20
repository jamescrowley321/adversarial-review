// models-config.mjs — validate + normalize caller-supplied pi models.json config.
//
// Extracted from action.yml so the security-relevant validation is unit-tested
// (scripts/models-config.test.mjs) and reusable. The action's "Write pi
// models.json" step calls `writeModelsConfig(raw, home)`.
//
// SECURITY: this config is written to ~/.pi/agent/models.json and consumed by pi
// to configure the provider requests that carry the caller's API key (e.g.
// OPENROUTER_API_KEY). A models.json that overrides a provider `baseUrl` /
// `endpoint` / `headers` / `apiKey` could redirect those key-bearing requests to
// an attacker-controlled host. This is a public reusable action — we cannot
// control how a caller sources `models_config` — so we enforce a STRICT
// ALLOWLIST and reject anything outside it, loudly. Only the shape the action is
// meant to support is accepted: per-model OpenRouter routing preferences under
// providers.<provider>.modelOverrides.<model>.compat.openRouterRouting.

import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

// Cap input size so a runaway/abusive value can't OOM JSON.parse or fill disk.
// models.json for routing preferences is a few hundred bytes; 64 KiB is generous.
export const MAX_BYTES = 64 * 1024;

// Allowed keys at each level of the accepted shape. Anything else is rejected.
const ALLOWED = {
  top: ["providers"],
  provider: ["modelOverrides"],
  model: ["compat"],
  compat: ["openRouterRouting"],
  openRouterRouting: [
    "zdr",
    "sort",
    "quantizations",
    "ignore",
    "order",
    "allow_fallbacks",
    "max_price",
    "only",
    "require_parameters",
  ],
};

const TYPES = {
  zdr: "boolean",
  sort: "string",
  allow_fallbacks: "boolean",
  max_price: "scalar", // number or string
  require_parameters: "boolean",
  quantizations: "array",
  ignore: "array",
  order: "array",
  only: "array",
};

function isObj(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStr(v) {
  return typeof v === "string";
}
function isArr(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Validate caller-supplied JSON for pi's models.json against the strict allowlist.
 * Returns a normalized plain object safe to write. Throws Error on any violation.
 * @param {string} raw - the raw models_config input
 */
export function validateModelsConfig(raw) {
  if (typeof raw !== "string") {
    throw new Error("models_config is not a string");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("models_config is empty");
  }
  if (Buffer.byteLength(trimmed, "utf8") > MAX_BYTES) {
    throw new Error(
      `models_config exceeds ${MAX_BYTES} bytes (got ${Buffer.byteLength(trimmed, "utf8")})`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    throw new Error(`models_config is not valid JSON: ${e.message}`);
  }
  if (!isObj(parsed)) {
    throw new Error(
      `models_config must be a JSON object (got ${parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed})`,
    );
  }

  // Walk and reject any key outside the allowlist. We rebuild a clean object so
  // nothing unexpected is ever written, even if a future pi field looks safe.
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!ALLOWED.top.includes(k)) {
      throw new Error(`models_config: rejected top-level key '${k}' (allowed: ${ALLOWED.top.join(", ")})`);
    }
    if (!isObj(v)) {
      throw new Error(`models_config: '${k}' must be an object`);
    }
    out[k] = {};
    for (const [provName, provVal] of Object.entries(v)) {
      if (!isStr(provName) || !provName) {
        throw new Error(`models_config: provider name must be a non-empty string`);
      }
      if (!isObj(provVal)) {
        throw new Error(`models_config: providers.${provName} must be an object`);
      }
      out[k][provName] = {};
      for (const [pk, pv] of Object.entries(provVal)) {
        if (!ALLOWED.provider.includes(pk)) {
          throw new Error(
            `models_config: rejected key 'providers.${provName}.${pk}' (allowed: ${ALLOWED.provider.join(", ")})`,
          );
        }
        if (!isObj(pv)) {
          throw new Error(`models_config: providers.${provName}.${pk} must be an object`);
        }
        out[k][provName][pk] = {};
        // pv is a map of modelId -> { compat: {...} }. modelId is arbitrary
        // (e.g. "anthropic/claude-sonnet-5"), NOT allowlisted — only the keys
        // inside its value are.
        for (const [modelId, modelVal] of Object.entries(pv)) {
          if (!isStr(modelId) || !modelId) {
            throw new Error(`models_config: model id must be a non-empty string`);
          }
          if (!isObj(modelVal)) {
            throw new Error(`models_config: providers.${provName}.${pk}.${modelId} must be an object`);
          }
          out[k][provName][pk][modelId] = {};
          for (const [mk, mv] of Object.entries(modelVal)) {
            if (!ALLOWED.model.includes(mk)) {
              throw new Error(
                `models_config: rejected key 'providers.${provName}.${pk}.${modelId}.${mk}' (allowed: ${ALLOWED.model.join(", ")})`,
              );
            }
            if (!isObj(mv)) {
              throw new Error(`models_config: providers.${provName}.${pk}.${modelId}.${mk} must be an object`);
            }
            out[k][provName][pk][modelId][mk] = {};
            for (const [ck, cv] of Object.entries(mv)) {
              if (!ALLOWED.compat.includes(ck)) {
                throw new Error(
                  `models_config: rejected key 'providers.${provName}.${pk}.${modelId}.${mk}.${ck}' (allowed: ${ALLOWED.compat.join(", ")})`,
                );
              }
              if (!isObj(cv)) {
                throw new Error(`models_config: ...${ck} must be an object`);
              }
              out[k][provName][pk][modelId][mk][ck] = {};
              for (const [rk, rv] of Object.entries(cv)) {
                if (!ALLOWED.openRouterRouting.includes(rk)) {
                  throw new Error(
                    `models_config: rejected routing key '...${ck}.${rk}' (allowed: ${ALLOWED.openRouterRouting.join(", ")})`,
                  );
                }
                const want = TYPES[rk];
                if (want === "boolean" && typeof rv !== "boolean") {
                  throw new Error(`models_config: ${ck}.${rk} must be a boolean`);
                }
                if (want === "string" && typeof rv !== "string") {
                  throw new Error(`models_config: ${ck}.${rk} must be a string`);
                }
                if (want === "array" && !isArr(rv)) {
                  throw new Error(`models_config: ${ck}.${rk} must be an array of strings`);
                }
                if (want === "scalar" && typeof rv !== "number" && typeof rv !== "string") {
                  throw new Error(`models_config: ${ck}.${rk} must be a number or string`);
                }
                out[k][provName][pk][modelId][mk][ck][rk] = rv;
              }
            }
          }
        }
      }
    }
  }
  return out;
}

/**
 * Resolve the pi models.json path for a given home directory.
 * @param {string|undefined} home
 */
export function modelsJsonPath(home) {
  if (!home || typeof home !== "string") {
    throw new Error("HOME is not set; cannot locate ~/.pi/agent/models.json");
  }
  return join(home, ".pi", "agent", "models.json");
}

/**
 * Write validated models_config to ~/.pi/agent/models.json, or — when raw is
 * empty/whitespace — remove any pre-existing file so behavior never depends on
 * stale runner state (matters on non-ephemeral runners). Throws on any error.
 * @param {string} raw - the raw models_config input
 * @param {string|undefined} home - process.env.HOME
 * @returns {{path: string, action: "wrote"|"removed"|"noop"}} info
 */
export function writeModelsConfig(raw, home) {
  const file = modelsJsonPath(home);
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    // Clean state: remove any models.json left by a prior job so "omit the
    // input and nothing changes" is literally true on persistent runners.
    if (existsSync(file)) {
      unlinkSync(file);
      return { path: file, action: "removed" };
    }
    return { path: file, action: "noop" };
  }
  const validated = validateModelsConfig(raw);
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(file, JSON.stringify(validated, null, 2) + "\n");
  return { path: file, action: "wrote" };
}

// CLI entrypoint for the action step: `node models-config.mjs` reads MODELS_CONFIG
// and HOME from env, writes (or cleans), and prints a GitHub Actions summary.
// Exits non-zero on any validation error (loud failure).
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { path: p, action } = writeModelsConfig(process.env.MODELS_CONFIG || "", process.env.HOME);
    if (action === "wrote") console.log(`Wrote ${p}`);
    else if (action === "removed") console.log(`Removed stale ${p}`);
    else console.log(`No models_config supplied; no ${p} to remove.`);
  } catch (e) {
    console.log(`::error::${e.message}`);
    process.exit(1);
  }
}
