# Flowcharts

The diagrams are authored as Flow specs and rendered with the Flow engine in the parent `smallapps` repository. Edit the JSON, not the SVG.

These diagrams describe the target gate sequence. The V1 implementation is `factory/host.mjs`, a supervised facilitator: it keeps the board, calls the roles with no tools, checks an Argon allow token for a bundle hash, and applies under `apps/`. It is not the broker/sandbox shown in the diagrams.

| Diagram | Spec | Rendered |
|---|---|---|
| End-to-end pipeline | `docs/flow.pipeline.json` | `docs/flowchart.svg` |
| Team and authority topology | `docs/flow.team.json` | `docs/flowchart-team.svg` |
| Plan gate loop | `docs/flow.plan.json` | `docs/flowchart-plan.svg` |
| Patch gate loop | `docs/flow.patch.json` | `docs/flowchart-patch.svg` |

All three are **design-only**. Nothing in them is implemented or enforced.

## Main flow, in text

```
User: brief + scope + budget
  -> four agents: share needs, ideas, acceptance on the board
  -> contract + task split agreed?  -- no --> block; user resolves
  -> plan: one author, different reviewer
  -> Argon: plan gate
       -- findings --> revise plan + re-review (<=3) --> Argon again
                        -- 3rd denial --> user
                        -- critical --> STOP
       -- allow --> backend pair: contract, primitives, tests
  -> per patch: author -> different reviewer -> candidate tests
  -> Argon: exact patch gate
       -- findings --> revise patch + re-review/test (<=3) --> Argon again
                        -- 3rd denial --> user
                        -- critical --> STOP
       -- allow --> broker applies + verifies
                    -- mismatch --> HALT, preserve state; user decides
  -> backend ready: hashes + B1/B2 attest + F1/F2 ACKs
                                    -- missing/NACK --> block; user resolves
  -> Argon: frontend grant
       -- findings --> fix readiness + re-ACK (<=3) --> Argon again
                        -- 3rd denial --> user
                        -- critical --> STOP
       -- allow --> frontend pair: UI against frozen contract
  -> per patch + integration tests
  -> contract/gating hash changed?  -- yes --> invalidate ACKs/grants
                                              --> backend rework, re-ready, re-ACK
  -> Argon: commit gate             -- no --> HOLD, work stays local
  -> Argon: push gate               -- no --> HOLD, commit stays local
  -> done
```

## Reading the main diagram

The main diagram has four lanes:

- **User** — scope, blocking decisions, holds.
- **Four agents** — the technical work: discussion, plan, backend, readiness, frontend.
- **Argon (permission)** — the gates. Argon is not in the technical lane.
- **Host / broker** — candidate tests, apply, verify, stop paths.

The first half is backend-heavy on purpose. The frontend pair does not appear in the implementation lane until after the readiness gate and the separate Argon grant. Before that, its work is board-only requirements and read-only contract review, which the diagram compresses into the first "four agents" step.

The long width is the cost of a swimlane flow with explicit gates. Open the SVG in a browser and scroll; the left-to-right order is the phase order.

## Reading the team diagram

`flowchart-team.svg` answers "who can do what" without the phase detail:

- the user sets scope;
- Argon grants capability and can deny; a denial goes to `Deny: revise + resubmit (≤3)`, not an immediate stop; an unavailable or critical gate stops;
- the host owns the board and the broker;
- B1/B2 and F1/F2 are peers on one board;
- B1 -> B2 and F1 -> F2 are the default author/reviewer pairs;
- B2 -> F1 is the readiness handoff.

There is no fifth supervisor node. That is deliberate.

## Reading the plan gate

`flowchart-plan.svg` isolates the plan loop:

- one agent drafts the plan;
- a different agent reviews it;
- Argon allows it, denies it with findings, or flags a critical issue;
- findings go back to `Back to plan: revise + re-review (≤3)`, then the reviewer and Argon again;
- the third denial escalates to the user;
- a critical security/runtime issue goes to STOP.

The back edge from the loop box to the reviewer is drawn. A denial is a review result, not a task failure. Argon must classify it as **fixable** or **critical**; an ambiguous denial goes to the user.

## Reading the patch gate

`flowchart-patch.svg` is the cycle that repeats for every backend and frontend patch. It is the most important diagram for safety:

- author proposes in memory;
- a different reviewer inspects the exact diff;
- the host tests the exact candidate in isolated scratch;
- on a review/test finding: revise and re-review, up to three attempts; a repeated finding or exhausted attempts escalates to the user;
- Argon reviews the exact one-use packet:
  - allow → the broker applies and verifies;
  - findings → revise and re-review, then Argon again; up to three Argon rounds;
  - third denial → escalate to the user;
  - critical security/runtime issue → STOP;
- a post-verify mismatch halts and preserves state; the user decides.

The two loop nodes draw the return path back to the reviewer: `rev` for review/test findings and `rev-argon` for Argon findings. A denial is a review result, not a task failure. Only a critical security or runtime issue is a hard stop.

The patch gate is the same for both pairs. Backend and frontend differ in *what* they build, not in *how* a patch is authorized.

## The generated warnings

The Flow engine reports hazards on the specs. Three are worth naming:

- **`sandbox-floor`** — accurate. The design has no isolation boundary yet. The broker and sandbox are future work. Do not read "Argon approved" as "sandboxed".
- **`approval-fatigue`** — a real tension. The pipeline has many checkpoints because every persistent patch is gated. The mitigation is not fewer gates; it is making each packet cheap, bounded, and mostly machine-generated, and watching whether the human/Argon review becomes a rubber stamp. The packet is small by design.
- **`no-error-path`** (team diagram only) — the topology diagram is not a process. Failure paths live in the pipeline and patch diagrams.

## Regenerate

From the parent `smallapps` repository:

```bash
node scripts/flow-render.js \
  --spec program-factory/docs/flow.pipeline.json \
  -o program-factory/docs/flowchart.svg

node scripts/flow-render.js \
  --spec program-factory/docs/flow.team.json \
  -o program-factory/docs/flowchart-team.svg
```

```bash
cd program-factory
node docs/build-flow.mjs docs/flow.patch.json docs/flowchart-patch.svg
```

The plan and patch specs are hand-positioned so their revision loops stay compact. `build-flow.mjs` preserves the authored lane rows, which the parent `flow-render.js --spec` path strips during normalization. It imports the same Flow renderer, so the output is the same visual language.

Render the plan gate the same way:

```bash
cd program-factory
node docs/build-flow.mjs docs/flow.plan.json docs/flowchart-plan.svg
```

Add `--theme dark` to `flow-render.js`, or pass `dark` as the third argument to `build-flow.mjs`. The specs are plain JSON; the renderer validates unknown primitives, unknown lanes, duplicate edges, and dangling references, and reports what it had to change.
