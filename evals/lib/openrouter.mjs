// Minimal OpenRouter chat client. Zero dependencies, Node >= 20 (native fetch).
//
// The model is PINNED by the caller and recorded in the scorecard: a lens score
// is meaningless without knowing which model produced it, and this repo has
// already been bitten once by an OpenRouter slug being retired underneath it
// (the undated anthropic/claude-sonnet-5 alias, v1.7.1).

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export class ModelError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// maxTokens must comfortably cover BOTH the reply and any reasoning tokens the
// model spends getting there. Reasoning models bill thinking against the same
// budget, so a tight cap returns an empty or half-written JSON object — which
// then reads as "the lens emitted invalid JSON" when it is really the harness
// cutting the model off. Truncation is reported separately for that reason.
export async function chat({ model, prompt, temperature = 0, maxTokens = 8000, attempts = 3, timeoutMs = 180_000 }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new ModelError("OPENROUTER_API_KEY is not set — the live eval layer cannot run.");

  let last;
  for (let i = 0; i < attempts; i++) {
    const started = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        signal: ac.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/jamescrowley321/adversarial-review",
          "X-Title": "adversarial-review evals",
        },
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        // A retired/unknown slug 404s with an HTML or JSON error body. Surface it
        // as fatal, not flaky — retrying a bad model id just burns wall-clock.
        const fatal = res.status === 400 || res.status === 401 || res.status === 404;
        throw new ModelError(
          `OpenRouter ${res.status} for model "${model}": ${text.slice(0, 300).replace(/\s+/g, " ")}`,
          { status: res.status, retryable: !fatal },
        );
      }
      let body;
      try { body = JSON.parse(text); } catch { throw new ModelError(`non-JSON response: ${text.slice(0, 200)}`, { retryable: true }); }
      if (body.error) throw new ModelError(`OpenRouter error: ${body.error.message || JSON.stringify(body.error)}`, { retryable: true });
      const choice = body.choices?.[0] ?? {};
      const content = choice.message?.content ?? "";
      const reply = typeof content === "string" ? content : JSON.stringify(content);
      const finishReason = choice.finish_reason ?? choice.native_finish_reason ?? null;
      // A 200 carrying an empty message (OpenRouter reports finish_reason
      // "error" for an upstream hiccup) is a PROVIDER failure, not a lens that
      // emitted nothing. Throw it as retryable so the loop above gets another
      // draw; if it survives all attempts the caller records it as an error
      // rather than folding it into the lens's JSON-validity score.
      if (!reply.trim()) {
        throw new ModelError(
          `provider returned an empty message for "${model}" (finish_reason=${finishReason})`,
          { retryable: true },
        );
      }
      return {
        text: reply,
        finishReason,
        usage: body.usage || null,
        servedBy: body.provider || null,
        resolvedModel: body.model || model,
        ms: Date.now() - started,
      };
    } catch (err) {
      last = err;
      const retryable = err instanceof ModelError ? err.retryable : true;
      if (!retryable || i === attempts - 1) break;
      await sleep(1500 * (i + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

/** Bounded-concurrency map — never open more than `limit` model calls at once. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}
