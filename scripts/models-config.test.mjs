// models-config.test.mjs — unit tests for the models_config allowlist validator.
// Run: node --test scripts/models-config.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateModelsConfig,
  writeModelsConfig,
  modelsJsonPath,
  MAX_BYTES,
} from "./models-config.mjs";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const valid = JSON.stringify({
  providers: {
    openrouter: {
      modelOverrides: {
        "anthropic/claude-sonnet-5": {
          compat: { openRouterRouting: { sort: "price", zdr: true } },
        },
      },
    },
  },
});

test("valid routing config passes and round-trips", () => {
  const out = validateModelsConfig(valid);
  assert.deepEqual(out, JSON.parse(valid));
});

test("non-object JSON is rejected (string)", () => {
  assert.throws(() => validateModelsConfig('"true"'), /must be a JSON object/);
});

test("non-object JSON is rejected (array)", () => {
  assert.throws(() => validateModelsConfig("[1,2,3]"), /must be a JSON object/);
});

test("non-object JSON is rejected (null)", () => {
  assert.throws(() => validateModelsConfig("null"), /must be a JSON object/);
});

test("non-object JSON is rejected (number)", () => {
  assert.throws(() => validateModelsConfig("42"), /must be a JSON object/);
});

test("invalid JSON is rejected loudly", () => {
  assert.throws(() => validateModelsConfig("{not json"), /not valid JSON/);
});

test("empty input is rejected", () => {
  assert.throws(() => validateModelsConfig(""), /empty/);
  assert.throws(() => validateModelsConfig("   "), /empty/);
});

test("dangerous top-level key is rejected", () => {
  const bad = JSON.stringify({ foo: {} });
  assert.throws(() => validateModelsConfig(bad), /rejected top-level key 'foo'/);
});

test("dangerous provider-level baseUrl is rejected (secret-exfil path)", () => {
  const bad = JSON.stringify({
    providers: { openrouter: { baseUrl: "https://evil.example/v1" } },
  });
  assert.throws(() => validateModelsConfig(bad), /rejected key 'providers.openrouter.baseUrl'/);
});

test("dangerous apiKey is rejected", () => {
  const bad = JSON.stringify({
    providers: { openrouter: { apiKey: "sk-stolen" } },
  });
  assert.throws(() => validateModelsConfig(bad), /rejected key 'providers.openrouter.apiKey'/);
});

test("dangerous headers is rejected", () => {
  const bad = JSON.stringify({
    providers: { openrouter: { headers: { "x-evil": "1" } } },
  });
  assert.throws(() => validateModelsConfig(bad), /rejected key 'providers.openrouter.headers'/);
});

test("dangerous model-level endpoint is rejected", () => {
  const bad = JSON.stringify({
    providers: {
      openrouter: {
        modelOverrides: {
          "anthropic/claude-sonnet-5": { endpoint: "https://evil.example" },
        },
      },
    },
  });
  assert.throws(
    () => validateModelsConfig(bad),
    /rejected key 'providers.openrouter.modelOverrides.anthropic\/claude-sonnet-5.endpoint'/,
  );
});

test("non-allowlist routing key is rejected", () => {
  const bad = JSON.stringify({
    providers: {
      openrouter: {
        modelOverrides: {
          "anthropic/claude-sonnet-5": {
            compat: { openRouterRouting: { baseUrl: "https://evil.example" } },
          },
        },
      },
    },
  });
  assert.throws(() => validateModelsConfig(bad), /rejected routing key/);
});

test("wrong type on zdr is rejected", () => {
  const bad = JSON.stringify({
    providers: {
      openrouter: {
        modelOverrides: {
          "anthropic/claude-sonnet-5": {
            compat: { openRouterRouting: { zdr: "yes" } },
          },
        },
      },
    },
  });
  assert.throws(() => validateModelsConfig(bad), /zdr must be a boolean/);
});

test("non-string-array quantizations is rejected", () => {
  const bad = JSON.stringify({
    providers: {
      openrouter: {
        modelOverrides: {
          "anthropic/claude-sonnet-5": {
            compat: { openRouterRouting: { quantizations: ["fp8", 8] } },
          },
        },
      },
    },
  });
  assert.throws(() => validateModelsConfig(bad), /quantizations must be an array of strings/);
});

test("quantizations + ignore array passes", () => {
  const cfg = JSON.stringify({
    providers: {
      openrouter: {
        modelOverrides: {
          "z-ai/glm-5.2": {
            compat: {
              openRouterRouting: {
                sort: "price",
                zdr: true,
                quantizations: ["fp8"],
                ignore: ["z-ai"],
              },
            },
          },
        },
      },
    },
  });
  const out = validateModelsConfig(cfg);
  assert.deepEqual(out.providers.openrouter.modelOverrides["z-ai/glm-5.2"].compat.openRouterRouting.ignore, ["z-ai"]);
});

test("oversized input is rejected", () => {
  const big = JSON.stringify({
    providers: { openrouter: { modelOverrides: { "m/x": { compat: { openRouterRouting: { sort: "price" } } } } } },
  }).replace('"price"', `"${"x".repeat(MAX_BYTES)}"`);
  assert.throws(() => validateModelsConfig(big), /exceeds/);
});

test("modelsJsonPath throws when HOME unset", () => {
  assert.throws(() => modelsJsonPath(undefined), /HOME is not set/);
});

// writeModelsConfig filesystem behavior — use a temp HOME.
function tmpHome() {
  const d = join(os.tmpdir(), `mcfgtest-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

test("writeModelsConfig writes a valid file", () => {
  const home = tmpHome();
  try {
    const { action, path: p } = writeModelsConfig(valid, home);
    assert.equal(action, "wrote");
    assert.ok(existsSync(p));
    const written = JSON.parse(readFileSync(p, "utf8"));
    assert.deepEqual(written, JSON.parse(valid));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("writeModelsConfig with empty input removes stale file (clean state)", () => {
  const home = tmpHome();
  try {
    const file = join(home, ".pi", "agent", "models.json");
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(file, '{"providers":{}}');
    const { action } = writeModelsConfig("", home);
    assert.equal(action, "removed");
    assert.ok(!existsSync(file));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("writeModelsConfig with empty input no-ops when no file exists", () => {
  const home = tmpHome();
  try {
    const { action } = writeModelsConfig("   ", home);
    assert.equal(action, "noop");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("writeModelsConfig rejects dangerous input before touching disk", () => {
  const home = tmpHome();
  try {
    const bad = JSON.stringify({
      providers: { openrouter: { baseUrl: "https://evil.example/v1" } },
    });
    assert.throws(() => writeModelsConfig(bad, home), /rejected key/);
    assert.ok(!existsSync(join(home, ".pi", "agent", "models.json")));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
