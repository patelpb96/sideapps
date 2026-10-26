# Program Factory - Grunt Team — supervised host

`factory/host.mjs` is the V1 facilitator. It is **not** the broker/sandbox
described in `docs/architecture.md`. It keeps a board, calls the configured roles with no tools, asks Frontier
Intelligence (Argon by default) for decisions, applies an approved bundle, and
runs the test gate. Run it supervised.

What it does not do:

- it does not isolate the model processes or intercept their tools;
- it does not make the permission decision a security boundary;
- it does not commit or push;
- it does not run unattended.

## Roles

| Role | Model | Use |
|---|---|---|
| A1 | `openai-codex/gpt-6.1-sol --thinking high` | frontier architect, task cards, tests, frontier review |
| A2 | `openai-codex/gpt-6-sol --thinking high` | frontier lead programmer and integrator |
| B1 | default `deepseek/deepseek-flash` with `--thinking max`; optional `mistral/zai-glm-5-3-flash` | backend author |
| B2 | default `deepseek/deepseek-flash` with `--thinking max`; optional `mistral/zai-glm-5-3-flash` | backend reviewer |
| F1 | `openai-codex/gpt-6-luna` | frontend author |
| F2 | `openai-codex/gpt-6-luna` | frontend reviewer |
| Astra | `openai-codex/gpt-6-astra` | optional independent code review |
| Frontier Intelligence | `google/gemini-4-argon` by default (Argon) | permission gate |

For either backend role, pass `--model mistral/zai-glm-5-3-flash` to `ask` to select the optional model. The host rejects models not listed for that role.

All calls use `--no-tools --no-mcp --no-session --no-extensions
--no-context-files`. Prompts are passed as `@file` so long packets do not hit
the shell argument limit.

## Commands

```bash
# Start a task board.
node factory/host.mjs init text-annotator tasks/text-annotator/brief.md

# Append a typed, hash-chained event.
node factory/host.mjs event text-annotator PROPOSAL B1 "Contract proposal" tasks/text-annotator/contract.md

# Call a role. The output is a FILE bundle or a review.
node factory/host.mjs ask B1 tasks/text-annotator/b1-backend-prompt.md tasks/text-annotator/b1-backend.md

# Optional independent code review (Astra). Claude is handoff-only, not via Pi.
node factory/host.mjs ask ASTRA tasks/<task>/astra-review-prompt.md tasks/<task>/astra-review.md

# Ask Argon about a packet. --bundle is the exact candidate being approved.
node factory/host.mjs gate text-annotator patch tasks/text-annotator/argon-patch-prompt.md \
  tasks/text-annotator/argon-patch.json --bundle tasks/text-annotator/b1-backend.md

# Apply only when the bundle hash has an allow token.
node factory/host.mjs apply text-annotator tasks/text-annotator/b1-backend.md

# Run the app test gate and record the evidence.
node factory/host.mjs test text-annotator apps/text-annotator

# Read the board.
node factory/host.mjs status text-annotator
node factory/host.mjs verify text-annotator
```

`gate` exit codes:

| Exit | Meaning |
|---|---|
| 0 | allow; an allow token is written for the bundle hash |
| 1 | deny + critical; stop |
| 2 | deny + fixable/ambiguous, or unparsable; revise or ask the user |

`apply` refuses to write unless `board/<task>/approvals/<bundle-hash>.json`
exists with `decision: "allow"`. It only writes under `apps/` in V1. It rejects
absolute paths, `..`, backslashes, and paths outside the repo.

## Board

`board/<task>/events.jsonl` is append-only and gitignored. Each event has:

```json
{"seq":1,"at":"...","task":"text-annotator","actor":"host","type":"TASK","message":"...","artifact":"tasks/...","prev":"genesis","hash":"sha256..."}
```

The hash covers the event body, including `prev`, so a deleted or edited line is
detectable by replaying the chain. `verify <task>` recomputes every event hash
and the `prev` link. The board is evidence, not permission. Only the Frontier Intelligence gate
writes an approval token.

## Super Team mode

The same host runs the frontier pair. A1 and A2 are `ask` roles; the task-card
gate is a normal `gate` kind. The rule is in `docs/super-team.md`:

- frontier pair owns architecture, the hard code, test design, and integration;
- no work goes to B1/B2/F1/F2 without an accepted task card;
- A1 writes the red tests, A2 reviews feasibility, Frontier Intelligence gates the card scope;
- the grunt patch still needs its own Frontier Intelligence patch packet;
- A1 reviews the grunt result against the card and tests; a vague card returns
  to A1, not to the grunt pair.

## Independent review

Astra is the default optional independent reviewer. Claude is a handoff packet
plus a fresh Claude CLI session; it is not called from Pi. The route, the
5-minute human-choice timeout, the deny rule, and the one-round degraded
fallback are in [`docs/independent-review.md`](../docs/independent-review.md).

## The text-annotator run

The first task ran the same sequence in supervised mode. The model calls used
the same launcher flags the host wraps; the board was recorded with
`host event` and `host verify`. The `ask`/`gate`/`apply` commands are the
repeatable path for the next task; `apply` was smoke-tested with a tiny bundle
and an allow token.

1. B1 proposed the contract; B2 reviewed it; Argon allowed the plan.
2. B1 produced a backend bundle; B2 found five issues; B1 fixed them; B2
   passed the fix; Argon allowed the patch.
3. The approved backend bundle was applied; 25 tests passed; readiness hashes
   were recorded; F1 and F2 ACKed the same hashes; Argon granted the frontend.
4. F1 produced the frontend; F2 found seven issues; F1 fixed them; F2 passed;
   Argon allowed the patch.
5. The approved frontend bundle was applied; 26 tests passed; browser smoke
   tests added a real annotation.

The exact decisions are in `board/text-annotator/events.jsonl` and the task
artifacts under `tasks/text-annotator/`.

## What is next

- The broker/sandbox and one-use packet enforcement in `docs/roadmap.md`.
- A `gate`/`apply` path that computes and verifies the packet from the live
  tree, not just the bundle text.
- Commit and push are manual Frontier Intelligence-gated steps; the host does not automate them.
