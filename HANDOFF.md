# Handoff

## 2026-10-23 — bootstrap

**State**

- Local nested repository created at `program-factory` inside `smallapps`.
- Branch `main`, no commits, no remote.
- Contents were design only at bootstrap: docs, Flow specs, rendered SVGs, role config, brief template.
- The parent `smallapps` repo is untouched and shows this directory as untracked.

**Permission note**

Argon allowed the bootstrap, but the deterministic guard downgraded the decision to `escalate` because Argon returned an empty `blast_radius`. The user's explicit in-session request to create the repo was treated as the human authorization. The action was recorded as `unreviewed` in `~/handoff/argon-guard.jsonl`, with the reason. Only new files under the target were created; nothing existing was overwritten; no commit or push occurred.

## 2026-10-23 — denial loops

Plan, patch, and frontend-grant denials are iterative:

- Argon returns findings → the author revises, a different reviewer re-reviews, the tests rerun, and the packet is rebuilt.
- Up to three Argon rounds. The third denial escalates to the user.
- Only a major security or runtime issue is a hard stop.
- Unavailable Argon is a stop because no review can happen.

The detailed plan and patch diagrams draw their back edges. The main pipeline uses loop boxes as shorthand, with a `returns_to` prop naming the step each loop returns to.

## 2026-10-23 — V1 text annotator

**Built**

- `apps/text-annotator`: Node ESM, zero dependencies, 26/26 tests pass.
- TXT/MD/DOCX/PDF text-layer extraction; no OCR. PDF uses `pdftotext`.
- Upload, document list, viewer, span selection, label menu, keyboard offset form, annotation list/delete, export JSON, light/dark UI.
- Browser smoke: opened `sample.txt`, added a `Person` annotation at offsets 0–5, one `<mark>` with `First`.

**Factory V1**

- `factory/host.mjs`: hash-chained board, model calls with no tools, Frontier Intelligence (Argon default) gate, bundle-hash allow tokens, apply under `apps/`, test gate.
- Board: `board/text-annotator/events.jsonl` (gitignored; `verify` checks the chain).
- Task artifacts: `tasks/text-annotator/` (contract, B1/B2/F1/F2 bundles and reviews, Argon decisions, readiness, evidence).

**Committed**

- Local commits `d29e925`, `2e55157`, and `2ab53f1` (83 files). Pushed to <https://github.com/patelpb96/sideapps> on `main`.

**Still absent**

- OS sandbox, real broker, per-event capabilities, commit/push automation, unattended mode.
- Independent review is a manual policy, not an automated gate.

## 2026-10-24 — Grunt Team name, Super Team, review policy

**Name**

- The working project is **Program Factory - Grunt Team**. The GitHub repo slug remains `sideapps`.

**Super Team design**

- Frontier pair: A1 `openai-codex/gpt-6.1-sol` (architect, cards, tests, frontier review) and A2 `openai-codex/gpt-6-sol` (lead programmer, integrator).
- Grunt squad remains B1/B2/F1/F2. No grunt work without a curated task card.
- Task card: exact files/interfaces, no open design, red tests from A1, budget, named pair, stop conditions. Frontier Intelligence gates the card scope.
- Docs: `docs/super-team.md`, `templates/task-card.md`, `docs/flowchart-super.svg`.
- A1/A2 roles are added to `factory/host.mjs`; no Super Team pilot has run.

**Permission role**

- The permission gate is **Frontier Intelligence**, default instance Argon (`google/gemini-4-argon`). It must approve the plan, each patch, the task card, commit, and push. It is not a code reviewer.

**Independent code review**

- Default optional reviewer: Astra (`openai-codex/gpt-6-astra`) via `ask ASTRA`.
- Claude is handoff-only: packet + fresh Claude CLI session; not called from Pi.
- Human choice between Astra and Claude: wait at most 300 seconds; no reply → Astra; Astra exhausted → deny the review.
- If review cannot be performed: local checkpoint (no push) → one degraded round by the active project model → mark `degraded-not-independent` → stop → leave notes in `tasks/<task>/review-packets/`.
- **Priority 1 when the user returns**: run the independent review before integration/commit/push.
- No independent review is pending now.

**Next**

1. Run a Super Team pilot: one accepted task card and one rejected-as-not-narrow card.
2. Harden Phase 1: isolated scratch, live packet validation, per-event capabilities.
3. Then the broker/sandbox and commit/push automation. The `sandbox-floor` warnings are still accurate.
