# Automated / AI Code-Review Landscape — Market Analysis & Long-Term Roadmap for `adversarial-review`

> **Scope.** A current (2026) competitive analysis of the automated / AI code-review
> tool and plugin landscape, and a phased roadmap for **adversarial-review** — the
> open-source (Apache-2.0), harness-neutral, multi-lens, fail-closed PR-review gate
> in this repo.
>
> **Method & honesty note.** Figures are cited inline and collected in
> [Sources](#7-sources) (access date **2026-08-13**). Pricing, funding, and traction
> in this market move fast and most compliance claims (SOC 2, HIPAA, ISO) are vendor
> self-attestations — treated as such. Where a claim rests on one aggregator or a
> JS-rendered page we could not confirm, it is marked **(unverified)**. The point of
> this document is a *skeptical* read; adversarial-review's position is deliberately
> not overstated. **The single most important finding for positioning:** the
> "harness-neutral portable persona library" idea is **not** a defensible moat — it
> is already a crowded, proven pattern (see §5). The defensible combination is
> narrower and is spelled out honestly in §5.

---

## 1. Executive summary

1. **The category is real, large, and consolidating fast.** AI PR review went from
   novelty to funded category in ~24 months. **CodeRabbit** is the clear commercial
   leader: a **$143M round at a ~$1.5B post-money valuation announced 2026-08-12**
   (led by Atomico + Smash Capital, with NVIDIA/NVentures, Datadog, BMW i Ventures),
   on top of a **$60M Series B (Sept 2025)** — reportedly ~$40-50M ARR and 8,000-17,000+
   customers. [S1][S2][S3][S4]
2. **Every serious code host now ships native AI review**, which is the primary
   commoditization threat: **GitHub Copilot code review** (Code Quality GA
   **2026-07-20**), **GitLab Duo Code Review / Code Review Flow** (Duo Agent Platform
   GA **2026-01-15**), and **Cursor BugBot**. [S5][S6][S7][S8]
3. **But native review is advisory, not a gate.** GitHub Copilot **only posts a
   `COMMENT` review — it cannot `REQUEST_CHANGES`, cannot satisfy CODEOWNERS, and
   cannot block a merge**; GitHub even *walked back* auto-adding Copilot as a
   reviewer on **2026-08-07**. GitLab Duo and BugBot are likewise advisory by
   default. [S5][S9] **This is the gap adversarial-review is built on.**
4. **A fail-closed merge gate is the real dividing line**, and it is *not* rare —
   but it is unevenly distributed. Confident hard-gate capability: CodeRabbit
   (Pre-Merge Checks), Qodo (compliance gate + required check), CodeAnt, Codacy,
   SonarQube (Quality Gates). Advisory-by-default (blocking only if you wire it):
   Greptile, Bito, Devin Review, GitLab Duo, Copilot (can't block at all). [S1][S10][S11][S12]
5. **Model portability is the incumbents' soft underbelly.** Almost every SaaS
   reviewer is vendor-managed; **true BYO-any-model exists essentially only in
   open-source PR-Agent** and a few OSS agents. BYO-key is typically gated to
   enterprise/self-host (Greptile, CodeRabbit, Qodo, Ellipsis) or limited to two
   models (Sweep). [S13][S14]
6. **Self-hosting + data-privacy is table stakes among the serious players, not a
   unique edge.** CodeRabbit, Qodo (Enterprise), Greptile (VPC), Bito, CodeAnt
   (air-gapped + HIPAA BAA), Snyk (Local Analysis), SonarQube Server all self-host,
   and most carry SOC 2 Type II and "we don't train on your code." Adversarial-review
   must not claim privacy as a differentiator on its own. [S1][S15][S16][S17]
7. **Multi-agent / multi-persona review is now the *incumbent* architecture, not a
   novelty.** CodeRabbit (Review/Verification/Chat/Pre-Merge agents), Qodo 2.0
   (specialist agents + a "judge"), Greptile v3 (parallel sub-agents), and Baz
   (spec/security/SRE/fixer agents) all ship panels. Adversarial-review's *fresh-,
   blind-context, one-lens-per-CI-job* method is a meaningful variant, but "multiple
   agents" alone is no longer differentiating. [S1][S13][S18][S19]
8. **The security-scanner incumbents are circling code review** as an AI-triage /
   AI-fix layer: **Semgrep Assistant** (AI triage suppresses false-positive PR
   comments), **Snyk Agent Fix** (ex-DeepCode, agentic fixes, "AI Security Fabric"),
   **SonarQube AI Code Assurance + AI CodeFix** (a quality gate *designed for
   AI-generated code*). These are the natural home of an OWASP-style security gate. [S16][S17][S20]
9. **The AWS-native review path is in open lifecycle churn** — a cautionary tale
   about single-vendor lock-in. **CodeGuru Reviewer** entered maintenance (no new
   customers since **2025-11-07**) → AWS points users to **Amazon Q Developer**,
   which itself hits **end-of-support 2027-04-30** (new signups end **2026-05-15**) →
   migrate to **Kiro**. Three products in two years. [S21][S22]
10. **The OSS "adversarial / multi-persona reviewer" niche is real but immature and
    fragmented** — and adversarial-review is *not* alone in it. Closest analogs:
    `addyosmani/adverse` (MIT, harness-neutral, 3 personas, CI exit-code gate, tiny),
    `spencermarx/open-code-review` (Apache-2.0, 28 personas, 13+ harnesses, **no
    gate**), and a **same-named `robertoecf/adversarial-review`** (MIT, multi-harness,
    local/advisory). None is a mature, injection-hardened, fail-closed *CI* gate. [S23][S24][S25]
11. **"Harness-neutral portable persona library" is already a popular, proven pattern
    — not a moat.** `wshobson/agents` (MIT, **~38.8k stars**) emits native artifacts
    across six harnesses (Claude Code, Codex, Cursor, OpenCode, Copilot, Gemini) and
    includes code-review agents; `AGENTS.md` is now a Linux-Foundation-hosted
    cross-harness standard. Adversarial-review should *use* these rails, not claim to
    have invented them. [S26][S27]
12. **The genuinely thin, defensible space** is the *intersection*: an **OSS,
    self-hostable, security-hardened, fail-closed CI merge gate** built from
    **fresh-context adversarial lenses**, **BYO-any-model**, with a first-class
    **OWASP-LLM/GenAI (2026) lens** and an **injection-hardened trust boundary**
    (three-tool allowlist, no reading reviewer instructions from the untrusted
    checkout). No SaaS incumbent is OSS + BYO-any-model + injection-doc'd; no OSS
    analog is a hardened CI gate. That overlap is adversarial-review's wedge. [S28][S29]
13. **OWASP timing is favorable.** The **OWASP Top 10 for LLM Applications 2026** was
    published **2026-08-04** with **LLM01 Prompt Injection still #1** — the exact risk
    adversarial-review both *hardens against* and *reviews for*. This is a credible,
    current hook few reviewers foreground. [S28]
14. **Honest weaknesses are structural, not cosmetic:** solo-maintainer OSS; a
    runtime dependency chain on **pi** (single-maintainer OSS, ~46k stars) +
    `shaftoe/pi-coding-agent-action` (one maintainer, ~60 stars) + **OpenRouter**; no
    dashboard / analytics / "Learnings" feedback loop that CodeRabbit/Greptile/Qodo
    all ship; real per-PR token cost across 5-8 parallel lenses; a **name collision**
    with `robertoecf/adversarial-review`; and cold-start distribution against
    8k-38k-star incumbents. [S25][S30][S31]
15. **Recommended strategic path (detail in §6): stay an OSS toolkit / open-core, do
    not try to out-SaaS CodeRabbit.** Win the narrow wedge — *the hardened, portable,
    fail-closed adversarial gate* — by (a) shipping first-class Claude Code plugin +
    Codex/Cursor adapters off existing distribution rails, (b) making the security
    story (injection hardening + OWASP-LLM lens) the headline, (c) adding a
    git-native "learning loop" and base-branch trusted overrides, and (d) resolving
    the name collision and the runtime bus-factor before chasing scale.

---

## 2. Market map (categorized landscape)

### 2A. AI PR-review SaaS / GitHub Apps (the core field)

- **CodeRabbit** — Category leader. Line-by-line review + summaries + 1-click fixes,
  now positioned as "agentic change management." Multi-agent; Pre-Merge Checks can
  **block**. Self-host/SOC 2/no-train on Enterprise. Proprietary. Pro **$24**/Pro Plus
  **$48**/user-mo (annual). **$143M @ ~$1.5B (2026-08-12)** + $60M Series B (2025). [S1][S2][S3]
- **Greptile** — Indexes the whole repo as a graph, emits a 0-5 merge-confidence
  score; v3 is agentic (parallel sub-agents; a TREX agent writes/runs tests).
  Advisory by default, can be a required check. Enterprise VPC self-host + BYO-LLM.
  Pro **$30/seat-mo** (credit-metered). **$25M Series A (Sept 2025, Benchmark)**. [S13][S32]
- **Graphite (Diamond → "Graphite Agent")** — AI review inside a stacked-PR platform;
  single-reviewer framing; **GitHub-only, no self-host**; explicit "we don't train."
  "Diamond" SKU retired 2025-10-07 into Team **$40/user-mo**. **$52M Series B
  (Mar 2025, Accel + Anthropic's Anthology Fund)**. [S12][S33]
- **Qodo (Qodo Merge + open-source PR-Agent)** — Qodo Merge: multi-agent + a "judge"
  agent, compliance gate that **blocks**, on-prem + BYOK at Enterprise. **PR-Agent:
  the reference OSS AI reviewer — Apache-2.0/MIT, self-host, BYO-any-model via
  LiteLLM (incl. OpenRouter/Ollama), first-class GitHub Action** (~12.5k stars).
  Credit pricing from ~$30/mo. **$70M Series B (Mar 2026), ~$120M total**. [S10][S14][S34]
- **Ellipsis** — **Pivoted** from a $20/dev reviewer to a cloud "agents-as-code"
  platform; Claude-centric with BYO-key / BYO-cloud (Bedrock) / per-agent proxy;
  usage-based pricing; explicit injection posture (per-agent scoped tokens). YC W24,
  **$2M seed (2024)**; no newer round found. [S35]
- **Sweep** — **Pivoted away from PR review** to a JetBrains-first IDE assistant; the
  GitHub-App reviewer is deprecated (repo frozen 2025-09-18). Source-available (custom
  EE license), pre-commit/advisory only. $10-60/mo. $2M seed (2023). [S36]
- **Korbit AI** — SaaS reviewer + "AI-native SAST." **Acquired by Boost Security
  (announced 2026-05-06)** — no longer independent. Pro **$12**/Max **$18**/user-mo;
  advisory + custom policies on Max. Proprietary. [S37][S38]
- **Bito** — Broadest delivery (GitHub/GitLab/Bitbucket + IDE + OSS CLI + CI +
  self-hosted Docker). SOC 2, no-train, auto-learn from feedback; **blocks via CI**.
  Team **$12**/Pro **$20**/seat-mo. **~$8.9M total, $5.7M seed (May 2025)**. [S39]
- **Baz** — "Engineering review platform"; **explicitly multi-agent** (Spec /
  Security / SRE / Fixer); goes furthest toward automation (auto-fix, auto-merge,
  merge-readiness). Runs on Bedrock. Pro **$30/active dev-mo** + usage credits.
  **~$17M seed incl. $9M ext. (2026-06-29, Battery + Boldstart)**. [S18][S40]
- **Entelligence AI** — Review + engineering-leadership analytics; **Model Router +
  BYOK** (genuinely model-portable); teachable "Learnings." Business **~$20/user-mo
  (unverified)**. **$5M seed (2026-01-08, Mayfield + Correlation)**. [S41]
- **Panto (getpanto.ai)** — Review + security dashboard; **ISO/IEC 27001:2022**,
  zero-train, self-host/on-prem. Advisory (blocking unverified). Pricing uncertain
  (live page shows a sibling mobile-QA product). Antler pre-seed (2025). [S42]
- **Matter AI (matterai.so)** — **OSS core (MIT, self-hostable)** review agent +
  proprietary "Axon" models / hosted cloud; SOC 2 Type II; agentic auto-fix-commits.
  ~$12/mo (approx). Parent "Gravity" reportedly $7M seed **(unverified)**. [S43]
- **CodeAnt AI** — Review + full AppSec (SAST/SCA/secrets/IaC + "AI pentest");
  **quality gates block**; **SOC 2 Type II + HIPAA with BAAs**, air-gapped/VPC
  self-host. Premium **$24/user-mo**. **$2M seed (2025-05-07, YC)**. [S15][S44]
- **Codacy** — Mature quality+security platform; **AI Reviewer** + **Guardrails**
  (an MCP layer that enforces standards *inside* your AI agent — **model-agnostic, no
  lock-in**). Native quality gates **block**. SOC 2. Team **$18/dev-mo**; free
  forever tier. **~$30M total, $15M Series B (2022)**. [S11][S45]
- **Devin Review (Cognition)** — Launched **2026-01-21**; reorganizes diffs into
  explained hunks + "Ask Devin"; **optional** posted CI status check; config via
  **REVIEW.md / AGENTS.md**. Free during early release. Platform valued **~$26B
  (May 2026)**. [S19][S46]

### 2B. Platform-native (the commoditizers)

- **GitHub Copilot code review** — Native PR reviewer; Code Quality **GA 2026-07-20**.
  **Comment-only: cannot request changes, cannot block, cannot satisfy CODEOWNERS.**
  Custom instructions / coding-guidelines supported. GitHub **removed** the auto-add
  ruleset on **2026-08-07**; private-repo reviews consume Actions minutes since
  2026-06-01. Bundled in Copilot paid plans. [S5][S9]
- **GitLab Duo Code Review** — Two flavors: **Code Review Flow** (agentic, part of Duo
  Agent Platform, **$0.25/review** flat) and non-agentic **Duo Code Review** (Duo
  Enterprise add-on, ~$39/user-mo). Needs **Premium/Ultimate**. Self-managed
  supported (needs AI Gateway; air-gapped via Offline License). Advisory. Duo Agent
  Platform **GA 2026-01-15**, GitLab Credits $1/credit. [S6][S7]
- **Cursor BugBot** — Precision bug-finder on PRs (GitHub-focused; GitLab sync).
  **Usage-based since 2026-06 (~$1.00-1.50/review)** within Individual **$20**/Teams
  **$40**/user plans; `/review` runs it pre-PR. Advisory. [S8]

### 2C. Security-focused review (the OWASP-adjacent field)

- **Semgrep Assistant** — AI triage/autofix layer over Semgrep Code's SAST rules;
  classifies findings true/false-positive and **suppresses likely-FP PR comments**
  (~60% of triage automated). OSS core; self-hostable AppSec Platform; scanner can
  fail CI. Team **$35/contributor-mo** (free ≤10 contributors). [S20]
- **Snyk (Snyk Code + "Snyk Agent Fix", ex-DeepCode AI)** — Security-first SAST/SCA
  with agentic fixes (35k expert-fix corpus, upgraded May 2026), automated fix PRs,
  **Local Analysis** (code stays in perimeter) for Enterprise, and the **"AI Security
  Fabric"** repositioning (Feb 2026). Snyk Code Team **$25/dev-mo** (100 free tests). [S16]
- **Amazon CodeGuru Reviewer → Amazon Q Developer → Kiro** — **In lifecycle churn.**
  CodeGuru Reviewer: **maintenance mode, no new customers since 2025-11-07**; AWS
  routes new repos to **Amazon Q Developer**, which reaches **end-of-support
  2027-04-30** (new signups end **2026-05-15**), pointing users to **Kiro**. The
  canonical warning against single-vendor review lock-in. [S21][S22]
- **SonarQube Cloud / Server (Sonar)** — Mature deterministic quality+security engine
  plus **AI Code Assurance** (a quality gate *designed for AI-generated code*) and
  **AI CodeFix** (autofix). **Quality Gates block merges at PR time** — a real
  fail-closed gate. Cloud from **$34/mo** (free 50k LOC); **Server self-hosts**. [S17]

### 2D. OSS frameworks / plumbing (the rails)

- **Danger JS** — MIT; deterministic `Dangerfile` policy scripting in CI; `fail()`
  **blocks** via branch protection. **No AI** — the archetypal harness-neutral gate a
  reviewer can ride. [S47]
- **Reviewdog** — MIT; transports any linter/analyzer output into diff-scoped PR
  comments; `-fail-on-error` **blocks**. **No AI**. [S48]
- **Qodo PR-Agent** — (see 2A) the batteries-included **OSS** AI reviewer; single-pass
  / single-persona and Git-host-centric, not a portable multi-lens panel. [S14]
- **aider** — Apache-2.0 pair-programming CLI; BYO-any-model; **no dedicated review
  mode or merge gate** — a comparator/substrate, not a reviewer. [S49]

### 2E. OSS multi-persona / adversarial reviewers (direct analogs — the honest mirror)

- **`addyosmani/adverse`** — MIT; "multi-agent adversarial code review for any coding
  agent." Harness-neutral (shells to any CLI), 3 fixed personas + a cross-examination
  round, **CI exit-code gate**. **The closest single analog** — but tiny (~49 stars,
  3 lenses, no injection hardening). [S23]
- **`spencermarx/open-code-review`** — Apache-2.0 (~331 stars); **28 personas**,
  auto-configures **13+ harnesses**; debate + synthesis — but **posts comments only,
  no fail-closed gate**. [S24]
- **`robertoecf/adversarial-review`** — MIT (~8 stars); **same name**; multi-harness
  (Claude Code, Codex, pi, Grok), routes critique to the *other* host; **interactive
  / advisory only, no CI gate, no documented injection defense**. [S25]
- **`wshobson/agents`** — MIT (**~38.8k stars**); multi-harness plugin *marketplace*
  emitting native artifacts for six harnesses, incl. code-review agents; local
  dev-time, **not a gate**. Proof the "portable persona library" pattern is popular
  and solved. [S26]
- **Claude Code `pr-review-toolkit`** (official marketplace) — multi-subagent PR
  review (bug detection, convention compliance, history); local, advisory. [S50]

### 2F. Harness / distribution ecosystems (how a portable reviewer ships)

- **Claude Code plugins & marketplaces** — since **2025-10-09**; a plugin bundles
  skills, subagents (`agents/`), slash commands, hooks, MCP; distributed via git-repo
  marketplaces (official + community). The native channel for the Claude Code form of
  adversarial-review. [S51]
- **OpenAI Codex CLI** — Apache-2.0 (~100k+ stars); built-in **`/review`**, config via
  `AGENTS.md` + profiles, custom `model_providers`, and `codex-action` for CI. [S52]
- **Cursor rules + AGENTS.md** — `.cursor/rules/*.mdc` + native `AGENTS.md` support.
  **AGENTS.md** (donated to the Linux Foundation's Agentic AI Foundation, Dec 2025) is
  the closest cross-harness "shared instructions" standard — but it's inert text, not
  an orchestrator or a gate. [S27]
- **pi (pi.dev)** — the reviewer runtime; **MIT OSS by Mario Zechner** (~46k stars),
  model-portable (esp. via OpenRouter). `shaftoe/pi-coding-agent-action` runs it in CI
  (one maintainer, ~60 stars). [S30][S31]
- **OpenRouter** — one OpenAI-compatible endpoint fronting 100+ models with BYOK —
  what makes "swap the model by changing a string" real. [S53]

---

## 3. Comparison table

Dimensions: **Delivery** · **Model portability** · **Multi-agent** · **Gate** (Advisory / **Blocking** = can be a fail-closed required check) · **Custom rules / learning** · **Self-host** · **OSS** · **Pricing (2026, USD)** · **Traction / funding**. Cells are terse; this table is wide — scroll horizontally. All figures per §7 (access 2026-08-13); "?" = unverified.

| Tool | Category | Delivery | Model portability | Multi-agent | Gate | Custom rules / learning | Self-host | OSS | Pricing | Traction / funding |
|---|---|---|---|---|---|---|---|---|---|---|
| **adversarial-review** | OSS gate | GitHub **Action** + CC plugin + local CLI | **BYO-any (OpenRouter)** | **Yes — 8 fresh-context lenses, 1/CI job** | **Blocking (fail-closed)** | Static per-repo overrides; **no learning loop** | **Yes (fully)** | **Apache-2.0** | Free (you pay tokens) | Solo OSS, pre-traction |
| CodeRabbit | SaaS | App (GH/GL/ADO/BB) + IDE + CLI | Vendor-managed; BYO on Ent. | Yes | **Blocking** (Pre-Merge Checks) | `.coderabbit.yaml`, AST rules, **Learnings** | Enterprise | No | Pro $24 / Plus $48 /user-mo | **$143M @ ~$1.5B (Aug 2026)** |
| Greptile | SaaS | App (GH/GL) + API + MCP | Vendor; BYO on Ent./self-host | Yes (v3) | Advisory → check | Custom rules + Learning | Enterprise VPC | No | $30/seat-mo (credits) | $25M Series A (2025) |
| Graphite (Agent) | SaaS | **GitHub-only** App + CLI | Vendor (Claude/OpenAI) | No | Advisory | Plain-lang rules; learns | **No** | No | Team $40/user-mo | $52M Series B (2025) |
| Qodo Merge | SaaS | App (GH/GL/BB/ADO) + IDE | Managed; **BYOK on Ent.** | **Yes + judge** | **Blocking** (compliance gate) | Standards + **Rule Miner** | On-prem (Ent.) | No | ~$30/mo (credits) | $70M Series B (2026) |
| **Qodo PR-Agent** | **OSS** | **Action**/CLI/Docker/webhook | **BYO-any (LiteLLM)** | No (single-pass) | Advisory → check | `best_practices.md`, prompts | **Yes** | **Apache/MIT** | Free (tokens) | ~12.5k★ |
| Ellipsis | SaaS (pivoted) | App + CLI + API | Claude-centric; BYO-key/cloud | Platform yes; review 1 | Advisory? | NL rules; learns style | AWS self-host | No | Usage-based | $2M seed (2024) |
| Sweep | IDE (pivoted) | JetBrains plugin | 2 models (BYOK) | No | Advisory (pre-commit) | — | No | Source-available | $10-60/mo | $2M seed (2023) |
| Korbit | SaaS | App (GH/GL/BB) | Undisclosed | No | Advisory + policies | Custom policies (Max) | Enterprise | No | Pro $12 / Max $18 | **Acq. by Boost (2026)** |
| Bito | SaaS | App + IDE + **CLI** + CI | Multi-model; BYOK? | No (+ scanners) | **Blocking** (via CI) | Guidelines + auto-learn | Yes (Docker) | CLI OSS | Team $12 / Pro $20 | $5.7M seed (2025) |
| Baz | SaaS | App (GH/GL) | Bedrock (managed) | **Yes** | **Blocking / auto-merge** | Custom agents (CLAUDE.md) | Private VC (Ent.) | No | $30/dev-mo + credits | $17M seed (2026) |
| Entelligence | SaaS | App + IDE + CLI | **Model Router + BYOK** | No? | Advisory (check) | Guidelines + Learnings | Self-host? | No | ~$20/user-mo? | $5M seed (2026) |
| Panto | SaaS | App (GH/GL/BB/ADO) | Managed | No | Advisory? | Custom rules + RL | On-prem | No | Uncertain | Antler pre-seed |
| Matter AI | SaaS + OSS | App + CLI + IDE + MCP | Gravity key / Axon | "Agentic" | Advisory? | Anti-patterns | **Yes** | **MIT core** | ~$12/mo? | $7M seed? |
| CodeAnt | SaaS | App (4 hosts) + IDE + CI | Managed | No (+ SAST/SCA) | **Blocking** (quality gates) | Org standards | **Air-gapped/VPC** | No | $24/user-mo | $2M seed YC (2025) |
| Codacy | SaaS | App + **Guardrails (MCP)** | **Guardrails model-agnostic** | No (hybrid) | **Blocking** (quality gates) | Coding Standards | No (cloud) | CLI/MCP OSS | Team $18/dev-mo | ~$30M total |
| Devin Review | SaaS | Web + CLI + PR trigger | Platform choice; review ? | No | Advisory (**opt. check**) | REVIEW.md/AGENTS.md; globs | Targets GHE/self-GL | No | Free (early) | Platform ~$26B |
| GitHub Copilot review | Native | GitHub PR | GitHub models | No | **Advisory — cannot block** | Custom instructions | GHES | No | In Copilot plans | GitHub/Microsoft |
| GitLab Duo review | Native | GitLab MR | Vendor | Agentic flow | Advisory | Instructions | Self-managed (gateway) | No | $0.25/review; Prem/Ult | GitLab |
| Cursor BugBot | Native/App | GitHub PR + `/review` | Vendor (Anthropic etc.) | No | Advisory | Rules/AGENTS.md | No | No | ~$1-1.50/review | Anysphere |
| Semgrep Assistant | Security | Scanner + PR triage | Vendor triage | No | **Blocking** (SAST in CI) | Rules (Semgrep) | **Yes** | OSS core (LGPL) | Team $35/contrib-mo | Semgrep Inc. |
| Snyk (Code + Agent Fix) | Security | Scanner + fix PRs | Vendor | Agentic fix | **Blocking** (fail on new vulns) | Policies | **Local Analysis (Ent.)** | No | Team $25/dev-mo | Snyk |
| SonarQube (Sonar) | Security/quality | Cloud + **Server** | Vendor | No (hybrid) | **Blocking** (Quality Gates) | Quality profiles + AI Assurance | **Yes (Server)** | Community ed. | Cloud $34/mo+ | Sonar |
| **addyosmani/adverse** | **OSS analog** | CLI (any agent) + CC skill | **Model-agnostic** | **Yes (3)** | **Blocking (exit code)** | 3 fixed personas | **Yes** | **MIT** | Free | ~49★ |
| **open-code-review** | **OSS analog** | 13+ harnesses | Model-agnostic | **Yes (28)** | **Advisory (no gate)** | 28 personas | **Yes** | **Apache-2.0** | Free | ~331★ |
| **robertoecf/adversarial-review** | **OSS analog** | CC/Codex/pi/Grok | Model-agnostic | Cross-host | Advisory (local) | Routing policy | **Yes** | **MIT** | Free | ~8★ (name clash) |

---

## 4. Trends & threats

1. **Commoditization from the platforms is the #1 threat — but it stops at the
   gate.** GitHub, GitLab, and Cursor will give every team a "free enough" AI
   reviewer. The durable limitation is that **native review is advisory**: Copilot
   *structurally cannot block a merge*, and GitHub even retreated from auto-adding it
   (2026-08-07). Any product whose only value was "an LLM comments on your PR" is
   dead; a product whose value is **enforcement + independence + hardening** survives
   the commoditization wave. [S5][S9]
2. **Consolidation and capital concentration.** CodeRabbit's ~$1.5B round, Devin's
   ~$26B platform, Qodo's $70M, Baz's raise, and the **Korbit acquisition (2026-05)**
   show the money and the exits clustering. Sub-scale point tools get bought,
   pivoted, or starved. Two of the six "classic" reviewers already **pivoted**
   (Ellipsis → agent platform; Sweep → IDE). Betting on a *paid* head-to-head with
   this field is unwise for a solo OSS project. [S3][S37][S35][S36]
3. **Where the SaaS incumbents are genuinely weak (adversarial-review's openings):**
   - **Single-model / vendor lock-in.** BYO-any-model is nearly absent outside OSS
     PR-Agent; most BYO-key is enterprise-gated. A PHI/regulated shop that must route
     to a specific compliant endpoint (Bedrock, a private model) is poorly served. [S13][S14]
   - **No fail-closed gate in the "free" tiers / native tools.** The enforcement most
     regulated teams actually need is paywalled or absent. [S5]
   - **Learning loops & dashboards are proprietary lock-in surfaces**, but they're
     also where the incumbents are strong — a double-edged trend (see §5 weaknesses).
   - **Prompt-injection posture is largely undocumented.** The reviewer is itself an
     LLM app ingesting untrusted PR content (the "lethal trifecta"); almost no vendor
     publishes a threat model. adversarial-review does. [S29]
4. **The AI-generated-code explosion is reshaping the buyer's problem.** Vendors now
   pitch "governing AI-written code" (CodeRabbit's change-management framing; Sonar's
   **AI Code Assurance** gate for AI-generated code; Qodo's "verification"). The
   review target is shifting from human PRs to *agent* PRs — which is exactly where a
   **fail-closed gate + AI-provenance/Compliance lens + OWASP-LLM lens** is most
   defensible. [S1][S17][S28]
5. **Security scanners are moving up into review, and reviewers down into security.**
   Semgrep/Snyk/Sonar add AI triage/fix; CodeRabbit/CodeAnt/Baz bundle SAST/SCA. The
   middle — "an OWASP-aware *review gate*, self-hostable, model-portable" — is
   contested but not owned. [S16][S17][S20]
6. **Single-vendor lifecycle risk is now a demonstrated pattern** (AWS CodeGuru → Q →
   Kiro in ~2 years). This is a *tailwind* for a portable, self-hostable, OSS gate
   that no vendor can EOL out from under a regulated team. [S21][S22]
7. **Distribution has standardized around a few rails** — Claude Code plugin
   marketplaces, `AGENTS.md`, Codex/Cursor config, GitHub Actions. The moat is no
   longer "we run across harnesses" (solved: `wshobson/agents`, 38.8k stars) but
   *what* you run and *whether it enforces*. [S26][S27]

---

## 5. Where adversarial-review fits — honest differentiation

### 5.1 The defensible wedge (what is actually rare)

Adversarial-review's edge is **not** any single attribute — each is matched somewhere
in the field. It is the *specific intersection*, which no competitor occupies:

- **OSS (Apache-2.0) + self-hostable + BYO-any-model + fail-closed CI merge gate.**
  SaaS gates (CodeRabbit, Qodo, CodeAnt, Codacy, Sonar) are proprietary and
  vendor-model. OSS analogs with a gate (`adverse`) are tiny and 3-lens with no
  injection defense. OSS reviewers that are portable (`open-code-review`,
  `wshobson/agents`) **have no fail-closed gate**. adversarial-review is the only one
  combining all four. [S1][S14][S23][S24][S26]
- **A documented, injection-hardened trust boundary as a design centerpiece**, not an
  afterthought: a strict **three-tool allowlist** (`get_pr_diff`,
  `get_issue_or_pr_thread`, `create_pull_request_review` — no shell/file/network), a
  deterministic gate that reads the review *state* (not model text), **no secrets on
  fork PRs**, and a hard rule that CI **never reads reviewer instructions from the
  untrusted PR checkout** (overrides load only from the trusted base). The security
  doc maps controls to **OWASP LLM 2026** LLM01/LLM06. Practically no competitor
  publishes this. [S29]
- **A first-class OWASP-LLM/GenAI (2026) lens plus OWASP Web (2021)** — riding the
  freshly-published **2026** list (LLM01 Prompt Injection still #1, 2026-08-04). Sonar
  has an AI-Code-Assurance gate and Snyk an AI-security fabric, but a *self-hostable,
  model-portable review lens* explicitly structured on the LLM Top 10 is distinctive. [S28]
- **The fresh-, blind-context method as parallel independent CI jobs.** Incumbent
  "multi-agent" panels run in one orchestrated session sharing context; adversarial-
  review runs each lens as a **cold, separate agent that sees only the diff**, which
  is a genuinely different bias profile — and its **fail-loud, per-lens attribution**
  (a flaky lens fails itself, never silently miscounts) is an operational nicety
  incumbents rarely expose. [README][S18]
- **Harness-neutral persona library** — real and useful, but explicitly **table
  stakes**, not the moat (see 5.3). Its value here is *distribution*, letting the same
  lenses ship as a CI Action **and** a Claude Code plugin **and** Codex/Cursor
  adapters. [S26][S27]
- **Provenance fit for regulated / PHI contexts** — self-host + BYO-model + no data
  retention + AI-provenance Compliance lens is a coherent story for a
  healthcare-diagnostics buyer. But note (5.2) privacy alone is not unique.

### 5.2 Honest weaknesses (do not paper over)

- **Solo-maintainer OSS vs. funded fields.** Competing attention against 8k-38k-star
  projects and $50M-$200M-funded vendors. Bus factor of one. [S3][S26]
- **A three-link runtime dependency chain**, each a single point of failure:
  **pi** (one-maintainer OSS), **`shaftoe/pi-coding-agent-action`** (one maintainer,
  ~60 stars, bundled `dist/index.js`), and **OpenRouter** (a third-party gateway). A
  regression or abandonment in any breaks the CI gate. Incumbents own their stack. [S30][S31]
- **No learning loop, dashboard, or analytics.** CodeRabbit "Learnings," Greptile
  Learning, Qodo Rule Miner, Entelligence Learnings all improve from feedback and
  give managers dashboards. adversarial-review's tuning is **static per-repo override
  files** — deliberately, for injection safety, but it means it does not get smarter
  and has no reporting surface. [S1][S13][S10]
- **Self-host + privacy is not a differentiator on its own.** CodeRabbit, Qodo,
  CodeAnt (HIPAA + BAA), Snyk (Local Analysis), Sonar Server all self-host with SOC 2
  / no-train. adversarial-review must lead with *enforcement + hardening + OSS/BYO*,
  not "we're private." [S1][S15][S16]
- **Per-PR token cost is real and visible.** 5-8 parallel lenses × provider tokens on
  every PR; incumbents amortize into a per-seat price and optimize aggressively
  (BugBot cut cost-per-run 22%). Cost control is on the consumer (diff caps, fewer
  lenses, preflight gating). [S8][README]
- **Cold-start distribution + a name collision.** `robertoecf/adversarial-review`
  (MIT, multi-harness, same name) already exists on GitHub — a discoverability and
  branding hazard that should be resolved early. [S25]
- **No SaaS UX / one-click onboarding.** Setup requires a caller workflow, an
  OpenRouter key, and branch-protection config — friction vs. a GitHub-App "install"
  button.
- **"Multi-agent" and "multi-persona" are no longer novel** — the messaging must
  stress *fresh-context + fail-closed + hardened*, or it reads as me-too. [S13][S18]

### 5.3 The claim to retire

**Do not market "harness-neutral portable persona library" as the core innovation.**
`wshobson/agents` (38.8k stars, six harnesses, includes review agents),
`open-code-review` (13+ harnesses), and the `AGENTS.md` standard already own that
pattern. Position portability as *plumbing you exploit for distribution*, and let the
**hardened, fail-closed, OWASP-aware adversarial gate** carry the pitch. [S26][S27][S24]

---

## 6. Long-term roadmap (Now / Next / Later)

Guiding thesis: **win the narrow, defensible wedge — the OSS, self-hostable,
injection-hardened, fail-closed *adversarial gate* — and ride existing distribution
rails rather than building a SaaS.** Each bet ties to a differentiator (§5.1) or a
competitive gap (§4).

### NOW (0-3 months) — harden the wedge, remove own-goals

- **Ship the Claude Code plugin to the community marketplace** (the branch this repo
  is on). Distribution is the binding constraint; the plugin rail exists and is free.
  *→ gap: cold-start distribution.* [S51]
- **Resolve the name collision.** Decide: coexist with a strong scoped identity
  (`jamescrowley321/adversarial-review`, a distinct tagline) or rename the OSS brand.
  A same-named competitor is a self-inflicted wound. *→ weakness 5.2.* [S25]
- **Make the security story the headline**, not a footnote: a one-page "why a
  *hardened* reviewer" pitch built on the injection threat model + **OWASP LLM 2026**
  (LLM01 #1). This is the message no incumbent leads with. *→ diff 5.1.* [S28][S29]
- **Ship the planned Unicode/zero-width strip (control C7) and a diff sanitizer**, and
  publish a short "prompt-injection test-suite / red-team fixtures" result. Turn the
  threat model into demonstrable evidence. *→ diff 5.1.* [S29]
- **De-risk the runtime chain now:** pin pi + the pi-action to SHAs, document a
  fallback (e.g., a Claude Code / Codex adapter that runs the same lenses without the
  shaftoe action), and state a support policy if a dependency lapses. *→ weakness 5.2.* [S30][S31]
- **Publish a cost calculator / guidance** (tokens per lens per PR, preflight gating,
  diff caps) so the visible per-PR cost is a managed decision, not a surprise. *→
  weakness 5.2.* [README]

### NEXT (3-9 months) — close the two real capability gaps

- **A git-native "learning loop" that stays injection-safe.** Let a repo accumulate
  *maintainer-authored* accepted/rejected-finding records on the **protected base
  branch** (never from the PR checkout) that lenses read as trusted context — the
  planned "base-branch trusted overrides" step. This narrows the biggest functional
  gap (incumbent Learnings/Rule-Miner) without breaking the trust boundary. *→
  weakness 5.2; the injection-safe split is the differentiator.* [S1][S10][S29]
- **First-class Codex and Cursor adapters** off the shared `lenses/` + `AGENTS.md`, so
  the *same* persona library runs in Claude Code, Codex `/review`, Cursor, pi/CI. This
  is the honest, defensible form of "harness-neutral": one hardened lens set, many
  hosts, one fail-closed gate in CI. *→ diff 5.1; rail: AGENTS.md.* [S27][S52]
- **OWASP rule packs as `compliance_rules_file` presets** (Web 2021 + LLM/GenAI 2026 +
  Agentic ASI), shipped as versioned, citeable checklists — the "OWASP-aware gate"
  becomes a concrete, updatable artifact as the lists change. *→ diff 5.1; trend §4.4.* [S28]
- **A lightweight, self-hosted findings summary** (a generated markdown/HTML report
  artifact per PR, or a GitHub Check summary) — *not* a hosted dashboard, but enough
  reporting to answer "what did the gate catch this month" without a SaaS backend. *→
  weakness 5.2.*
- **A PHI/regulated reference profile** (Sentinel tuned for PHI/PII/tenant isolation +
  Compliance for AI provenance + a Bedrock/private-model routing recipe) — a concrete,
  documented config for the origin use case that also serves any regulated buyer. *→
  diff 5.1; gap §4.3.*

### LATER (9-18 months) — decide the business model deliberately

- **Strategic fork A — OSS toolkit vs. hosted layer (recommended: stay OSS / thin
  open-core).** Do **not** build a per-seat SaaS to fight CodeRabbit/Qodo head-on —
  they are funded 100-1000×. If any managed offering, keep it minimal and aligned
  with the values: an *optional* hosted **key-broker + budget-cap + findings-history**
  service for teams that can't self-run, sold as convenience, with the gate itself
  always fully OSS and self-hostable. Monetization, if pursued at all, is
  support/priced-support + hosted-convenience, not locking the enforcement behind a
  paywall. *→ trend §4.2.*
- **Strategic fork B — GitHub Marketplace App? (recommended: no, or only as a thin
  installer).** A hosted App means holding customer tokens and running spend — the
  opposite of the self-host/BYO-key value and a support burden for a solo maintainer.
  Better: a one-command "setup" that wires the Action + branch protection, keeping the
  self-hosted, per-consumer-billed model. Revisit only if adoption clearly demands it.
  *→ diff 5.1; weakness 5.2.*
- **Strategic fork C — breadth of harness adapters (recommended: depth over breadth).**
  Support the harnesses your users actually run (Claude Code, Codex, Cursor, pi/CI);
  resist chasing all six that `wshobson/agents` covers. Portability is a means
  (distribution + no lock-in), not the product. *→ §5.3.* [S26]
- **Governance & longevity:** recruit co-maintainers / a small governance model to
  fix the bus-factor; consider donating the persona/gate spec to a neutral home
  (OpenSSF-adjacent) so regulated adopters trust its longevity — turning weakness 5.2
  into a credibility asset, in direct contrast to the CodeGuru→Q→Kiro churn. *→ trend
  §4.6.* [S21]

**Recommended path, in one line:** *Stay an OSS, self-hostable, injection-hardened
fail-closed adversarial gate; lead with security + enforcement + no-lock-in; ride the
Claude Code / Codex / Cursor / Actions rails for distribution; add a base-branch-safe
learning loop and OWASP rule packs; and fix the name, the runtime bus-factor, and the
cost-visibility before chasing scale or a hosted layer.*

---

## 7. Sources

All accessed **2026-08-13**. Vendor pricing/funding/traction and compliance claims are
self-reported unless a second source is cited; items marked (unverified) rest on a
single or non-primary source.

1. [S1] CodeRabbit — pricing / docs / architecture / self-hosted: https://www.coderabbit.ai/pricing ; https://docs.coderabbit.ai/overview/architecture ; https://www.coderabbit.ai/legal/self-hosted
2. [S2] CodeRabbit $60M Series B (2025-09-16): https://www.businesswire.com/news/home/20250916401011/en/
3. [S3] CodeRabbit $143M @ ~$1.5B (2026-08-12): https://www.axios.com/pro/enterprise-software-deals/2026/08/12/code-review-coderabbit-datadog-raise ; https://techstartups.com/2026/08/12/coderabbit-raises-143m-at-1-5b-valuation-to-manage-the-ai-generated-code-explosion/ ; https://www.bloomberg.com/news/articles/2026-08-12/nvidia-backed-startup-coderabbit-valued-at-1-5-billion-in-round
4. [S4] CodeRabbit ARR/traction estimate: https://sacra.com/c/coderabbit/
5. [S5] GitHub Copilot code review — docs (comment-only, cannot block/CODEOWNERS): https://docs.github.com/copilot/using-github-copilot/code-review/using-copilot-code-review
6. [S6] GitLab Duo Code Review docs (agentic + non-agentic): https://docs.gitlab.com/user/gitlab_duo/code_review ; https://docs.gitlab.com/user/gitlab_duo/code_review_classic/
7. [S7] GitLab agentic code review $0.25 flat-rate + Duo Agent Platform GA: https://about.gitlab.com/blog/agentic-code-reviews-with-flat-rate-pricing/
8. [S8] Cursor BugBot pricing/perf (usage-based since 2026-06): https://getoptimal.ai/blog/cursor-bugbot-pricing ; https://www.digitalapplied.com/blog/cursor-bugbot-90-second-reviews-june-2026-release
9. [S9] GitHub changelog — Code Quality no longer adds Copilot as reviewer (2026-08-07): https://github.blog/changelog/2026-08-07-github-code-quality-no-longer-adds-copilot-as-a-reviewer/
10. [S10] Qodo Merge compliance gate / multi-agent: https://qodo-merge-docs.qodo.ai/tools/compliance ; https://www.qodo.ai/blog/single-agent-vs-multi-agent-code-review
11. [S11] Codacy AI Reviewer / Guardrails / pricing: https://www.codacy.com/ai-reviewer ; https://www.codacy.com/guardrails ; https://www.codacy.com/pricing
12. [S12] Graphite Agent + pricing (Diamond retired 2025-10-07): https://graphite.com/blog/introducing-graphite-agent-and-pricing ; https://graphite.com/pricing
13. [S13] Greptile v3 agentic review / pricing / security: https://www.greptile.com/blog/greptile-v3-agentic-code-review ; https://www.greptile.com/pricing ; https://www.greptile.com/security
14. [S14] Qodo PR-Agent (OSS, BYO-any-model, Action): https://github.com/qodo-ai/pr-agent ; https://www.qodo.ai/blog/qodo-is-handing-pr-agent-over-to-the-community
15. [S15] CodeAnt AI pricing/security (HIPAA/BAA, air-gapped): https://www.codeant.ai/pricing ; https://www.codeant.ai
16. [S16] Snyk Code / Snyk Agent Fix (ex-DeepCode) / Local Analysis: https://docs.snyk.io/scan-with-snyk/snyk-code/manage-code-vulnerabilities/fix-code-vulnerabilities-automatically ; https://appsecsanta.com/snyk
17. [S17] SonarQube AI Code Assurance / AI CodeFix / Quality Gates / pricing: https://www.sonarsource.com/plans-and-pricing/ ; https://leaveit2ai.com/ai-tools/code-development/sonarqube
18. [S18] Baz multi-agent + Bedrock AgentCore: https://baz.ai ; https://aws.amazon.com/blogs/machine-learning/ (Baz + Bedrock AgentCore)
19. [S19] Devin Review (Cognition, launched 2026-01-21): https://cognition.com/blog/devin-review ; https://docs.devin.ai/work-with-devin/devin-review
20. [S20] Semgrep Assistant overview + pricing: https://semgrep.dev/docs/semgrep-assistant/overview ; https://semgrep.dev/products/semgrep-code/assistant/
21. [S21] Amazon CodeGuru Reviewer maintenance (no new customers 2025-11-07); CodeGuru Security EOS: https://docs.aws.amazon.com/codeguru/latest/security-ug/end-of-support.html ; https://github.com/hashicorp/terraform-provider-aws/issues/44723
22. [S22] Amazon Q Developer end-of-support (2027-04-30; new signups end 2026-05-15 → Kiro): https://aws.amazon.com/blogs/devops/amazon-q-developer-end-of-support-announcement/
23. [S23] addyosmani/adverse (OSS multi-agent adversarial review, CI exit-code gate): https://github.com/addyosmani/adverse
24. [S24] spencermarx/open-code-review (28 personas, 13+ harnesses, no gate): https://github.com/spencermarx/open-code-review
25. [S25] robertoecf/adversarial-review (same name, multi-harness, local/advisory): https://github.com/robertoecf/adversarial-review
26. [S26] wshobson/agents (multi-harness marketplace, ~38.8k stars): https://github.com/wshobson/agents
27. [S27] Cursor rules + AGENTS.md standard: https://cursor.com/docs/rules ; https://agents.md
28. [S28] OWASP Top 10 for LLM Applications 2026 (published 2026-08-04; LLM01 #1): https://genai.owasp.org/llm-top-10/ ; https://cybersecuritynews.com/owasp-genai-llm-top-10-2026/
29. [S29] adversarial-review security-hardening doc (this repo): `docs/security-hardening.md` ; Simon Willison, "The lethal trifecta" (2025): https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
30. [S30] pi coding agent (MIT, Mario Zechner): https://pi.dev/ ; https://github.com/badlogic/pi-mono
31. [S31] shaftoe/pi-coding-agent-action (CI runtime for pi): https://github.com/shaftoe/pi-coding-agent-action
32. [S32] Greptile $25M Series A (Benchmark, 2025): https://www.thesaasnews.com/news/greptile-raises-25-million-series-a ; https://sacra.com/c/greptile
33. [S33] Graphite $52M Series B (Accel + Anthropic Anthology, 2025-03): https://graphite.com/blog/series-b-diamond-launch ; https://techcrunch.com/2025/03/18/
34. [S34] Qodo $70M Series B (Qumra, 2026-03-30, ~$120M total): https://techcrunch.com/2026/03/30/qodo-bets-on-code-verification-as-ai-coding-scales-raises-70m/ ; https://www.qodo.ai/blog/qodo-70m-series-b-shift-to-artificial-wisdom/
35. [S35] Ellipsis pricing/security/seed: https://www.ellipsis.dev/pricing ; https://www.ellipsis.dev/docs/security ; https://www.ellipsis.dev/blog/ellipsis-raises-a-2m-seed-round
36. [S36] Sweep pricing/docs/license (pivot to JetBrains): https://sweep.dev/pricing ; https://github.com/sweepai/sweep
37. [S37] Korbit acquired by Boost Security (2026-05-06): https://boostsecurity.io/blog/announcing-two-acquisitions-and-a-funding-round
38. [S38] Korbit pricing: https://www.korbit.ai/pricing.html
39. [S39] Bito AI Code Review Agent / pricing / seed: https://bito.ai/pricing ; https://bito.ai/product/ai-code-review-agent ; https://bito.ai/blog/bito-fundraising-2025
40. [S40] Baz $9M seed extension (2026-06-29, Battery + Boldstart): https://siliconangle.com/2026/06/29/ ; https://baz.ai/pricing
41. [S41] Entelligence $5M seed (2026-01-08, Mayfield + Correlation): https://entelligence.ai/blogs/entelligence-ai-raises-5m ; https://docs.entelligence.ai
42. [S42] Panto (getpanto.ai) security/pricing/raise: https://getpanto.ai/security ; https://getpanto.ai/pricing ; https://getpanto.ai/blog/we-raised-were-building-harder
43. [S43] Matter AI (matterai.so) OSS core + pricing: https://matterai.so/pricing ; https://github.com/MatterAIOrg/matter-ai
44. [S44] CodeAnt $2M seed (2025-05-07, YC): https://www.finsmes.com/2025/05/codeant-ai-raises-2m-in-seed-funding.html ; https://www.thesaasnews.com/news/codeant-ai-raises-2-million-in-seed-round
45. [S45] Codacy $15M Series B (2022) / total funding: https://www.thesaasnews.com/news/codacy-raises-15-million-in-series-b ; https://www.crunchbase.com/organization/codacy
46. [S46] Devin platform funding (~$26B, 2026-05): https://techcrunch.com/2026/05/27/ ; https://devin.ai/pricing
47. [S47] Danger JS: https://danger.systems/js/ ; https://github.com/danger/danger-js
48. [S48] Reviewdog: https://github.com/reviewdog/reviewdog
49. [S49] aider: https://aider.chat
50. [S50] Claude Code code-review / pr-review-toolkit: https://code.claude.com/docs/en/code-review
51. [S51] Claude Code plugins & marketplaces: https://code.claude.com/docs/en/plugins ; https://code.claude.com/docs/en/plugin-marketplaces
52. [S52] OpenAI Codex CLI (Apache-2.0, /review, AGENTS.md): https://github.com/openai/codex ; https://developers.openai.com/codex/cli
53. [S53] OpenRouter (model-routing gateway, BYOK): https://openrouter.ai/docs

> **Freshness caveats.** Pricing and funding for this market change monthly (CodeRabbit,
> Greptile, Qodo, Cursor BugBot, GitLab Duo all shifted to credit/usage models in
> 2025-2026; Ellipsis dropped per-seat; Graphite retired "Diamond"; Korbit was
> acquired; Ellipsis and Sweep pivoted away from PR review). Re-verify any load-bearing
> figure before external use. Startup pricing for Entelligence, Panto, and Matter AI is
> JS-rendered or points at sibling products and is marked (unverified). pi's star count
> (~46k) is approximate. adversarial-review's own capabilities are cited to this repo's
> `README.md`, `docs/security-hardening.md`, and `lenses/`.
