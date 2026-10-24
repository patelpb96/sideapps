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

- `factory/host.mjs`: hash-chained board, model calls with no tools, Argon gate, bundle-hash allow tokens, apply under `apps/`, test gate.
- Board: `board/text-annotator/events.jsonl` (22 events, gitignored).
- Task artifacts: `tasks/text-annotator/` (contract, B1/B2/F1/F2 bundles and reviews, Argon decisions, readiness, evidence).

**Committed**

- Initial local commits `d29e925` and `2e55157` (83 files). Pushed to <https://github.com/patelpb96/sideapps> on `main`.

**Still absent**

- OS sandbox, real broker, per-event capabilities, commit/push automation, unattended mode.

**Next**

1. Read `docs/architecture.md`, `docs/flowchart.md`, and `factory/README.md`.
2. Harden Phase 1: isolated scratch, live packet validation, per-event capabilities.
3. Then the broker/sandbox and the commit/push gates. The `sandbox-floor` warnings are still accurate.
