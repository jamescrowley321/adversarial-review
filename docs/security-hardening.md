# Security hardening & OWASP roadmap

Adversarial Review is itself an LLM application: it runs an AI agent (pi) over
**untrusted pull-request content** with access to a provider API key and a
`GITHUB_TOKEN` that can post reviews. So the OWASP **Top 10 for LLM Applications
2026** applies to *this action*, not just to the code it reviews — above all
**LLM01 Prompt Injection** and **LLM06 Unbounded Consumption**.

The guiding principle from that list: *you cannot build a model that can't be
fooled, so build the system around it so that when it is fooled, nothing
important breaks.* Every control below bounds the blast radius of a successful
injection rather than pretending to prevent one.

## Threat model

The lens agent **ingests untrusted content** (the diff, PR title/description/
comments, file contents), holds a **provider key + network egress**, and can
**post reviews** and read the repo — Simon Willison's "lethal trifecta." Two
attacker goals:

1. **Prompt-inject a lens** (LLM01) to suppress findings, forge an approval, or
   exfiltrate the provider key / repo contents (LLM02 Sensitive Info Disclosure).
2. **Burn API budget** (LLM06) by opening many PRs or pushing many commits.

## Prompt injection — controls (LLM01)

Defense-in-depth; assume the instruction boundary *will* be bypassed.

| # | Control | Status | Maps to |
|---|---------|--------|---------|
| C1 | **No secrets to untrusted PRs.** Triggered by `pull_request` (never `pull_request_target`); fork PRs get a read-only token and **no `OPENROUTER_API_KEY`**, so lenses can't run on them. This is the load-bearing control. | ✅ shipped | mitigation #4 |
| C2 | **Only trusted authors trigger the model.** `author_association ∈ {OWNER,MEMBER,COLLABORATOR}` gate on the lens jobs, plus the repo setting *Settings → Actions → "Require approval for all outside collaborators"*. | ✅ workflow gate shipped · ⚙️ repo setting = manual | limits delivery surface |
| C3 | **Least-privilege token.** Jobs request only `contents: read` + `pull-requests: write`; no other secrets in the job env. | ✅ shipped | mitigation #4, Rule of Two (#8) |
| C4 | **Constrain the agent's tools.** `loaded_tools` allowlist pins the lens agent to exactly `get_pr_diff`, `get_issue_or_pr_thread`, `create_pull_request_review` — no shell, file-write, push, or create/update-PR tools (pi defaults to `loaded_tools: all`, which includes those). A landed injection therefore can't read the provider key from env or mutate the repo. | ✅ shipped (`loaded_tools` input) | mitigation #1/#4 |
| C5 | **Deterministic gate.** The merge decision is computed in `github-script` from each review's **state** (`CHANGES_REQUESTED`), not from trusting model text — an injection can't make the gate pass by writing "gate: pass". | ✅ shipped | mitigation #2, LLM10 |
| C6 | **Hardened trust boundary in the prompt** — treat all content as data; embedded instructions are a MUST FIX finding; ignore invisible/zero-width Unicode and encoded payloads; the only permitted action is posting one review. | ✅ shipped (`lenses/shared-instructions.md`) | mitigation #1/#5/#6 |
| C7 | **Strip invisible / zero-width / tag-block Unicode** from the diff before the model sees it (defense against ASCII-smuggling). | 🔭 planned enhancement | mitigation #5 |
| C8 | **Budget-capped, scoped provider key** so a leaked key has a hard ceiling and no access beyond the one model. | ⚙️ set on OpenRouter | LLM02 blast radius |

**Residual risk:** a successful injection can still make one lens *under-report*
(a false negative). This is mitigated, not eliminated, by running several
independent lenses and by treating all AI output as **advisory until a human
attests** — never as sign-off. LLM01 is intrinsic to current models.

### What if the code under review *contains* prompt-injection payloads?

This is the normal case, not the exception — the diff **is** untrusted input
(indirect prompt injection, LLM01). Three outcomes, by design:

1. **Intended:** the lens treats the payload as data, does not obey it, and — for
   the security lenses — *reports it as a finding* ("this input reaches the model
   / renders unsanitized; it's an injection vector"). A repo that ships prompt
   handling should *want* that flagged.
2. **If a payload still steers a lens** (LLM01 is intrinsic; the boundary can be
   bypassed): the blast radius is bounded by the three-tool allowlist (C4) — no
   shell, no file/env read, no push — so it cannot exfiltrate the provider key or
   change the repo. The worst it can do is make **that one lens** under-report or
   post the wrong event; the deterministic gate (C5) and the other independent
   lenses still stand, and all output is advisory until a human attests.
3. **Benign injection-looking content** (this repo's own persona files, security
   test fixtures, docs about prompt injection) can trip false positives. That is
   accepted noise for a security tool; tune it per-repo via the Compliance lens
   rules or by scoping paths.

The scenario an attacker cannot reach at all: a **stranger's** malicious PR never
reaches the paid model (no secret on forks + the trusted-author gate, C1/C2).

## Budget / abuse — controls (LLM06 Unbounded Consumption)

> *"How do I stop someone raising a bunch of PRs and eating my budget?"*

The primary answer is **C1 + C2**: strangers' PRs never reach the paid model
(no secret on forks; the author gate + "require approval for outside
collaborators" setting mean an outside PR's workflows don't run until you click
approve). On top of that:

- **Skip bots** (`dependabot[bot]`) — no tokens on lockfile churn.
- **`concurrency: cancel-in-progress`** — pushing many commits to one PR cancels
  superseded runs instead of stacking them.
- **Per-lens `timeout-minutes: 5`** — caps a runaway session.
- **Diff caps** (`diff_max_lines` / `diff_max_bytes`) and `diff_ignore_patterns`
  — bound tokens per run; add `paths:` filters to skip docs-only PRs.
- **Provider-side hard cap** — a dedicated OpenRouter key with a monthly credit
  limit (the one you just created); cheap default model (`z-ai/glm-5.2`).
- **Draft PRs excluded** (trigger on `ready_for_review`, not `draft`); optionally
  gate on a `review:ai` label so runs are opt-in.
- **Fewer lenses** — trim the matrix + gate `lenses` for lower-risk repos.

## OWASP integration roadmap

The security lenses already cover much of the **OWASP Web Top 10 (2021)** —
Sentinel and Viper hit injection, broken access control, SSRF, crypto misuse.
The plan makes that explicit and adds LLM coverage:

- **Phase 1 — Annotate Sentinel** with OWASP Web Top 10 (2021) category IDs
  (A01–A10) so findings cite the canonical class. Low effort, in-persona.
- **Phase 2 — Add an opt-in `llm-top-10` lens** for repos that *build* LLM/agent
  features, covering the GenAI/LLM Top 10 2026: LLM01 Prompt Injection, LLM02
  Sensitive Information Disclosure, LLM03 Excessive Agency, LLM04 Supply Chain,
  LLM05 Data & Model Poisoning, LLM06 Unbounded Consumption, LLM07
  Misinformation, LLM08 Hidden Context Exposure, LLM09 Vector & Embedding
  Weaknesses, LLM10 Improper Output Handling. Pair with the OWASP **Agentic
  (ASI) Top 10** when the code lets a model act with tools/memory.
- **Phase 3 — Ship OWASP rule packs** as `compliance_rules_file` presets, so any
  repo can enforce an OWASP checklist through the Compliance lens without
  changing the action.
- **Reflexive check:** run the `llm-top-10` lens on *this* repo — LLM01 and LLM06
  are exactly the controls above, and this document is the residual-risk record.

### References

- OWASP Top 10 for LLM Applications — **2026** (LLM01–LLM10), OWASP GenAI
  Security Project.
- OWASP Top 10 for Agentic Applications (ASI) — 2026.
- OWASP Top 10 (Web) — 2021.
- Simon Willison, "The lethal trifecta" (2025).
