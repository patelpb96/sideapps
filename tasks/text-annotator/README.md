# Task — Text Annotator V1

The first program built by the Grunt Team. The app lives at
`apps/text-annotator`.

## Artifacts

| File | What |
|---|---|
| `brief.md` | user brief and acceptance criteria |
| `contract.md` | backend-first contract; frontend consumed it |
| `readiness.json` | backend tree, tests, contract, evidence, readiness hashes |
| `b1-backend.md` | B1 backend bundle |
| `b2-backend-review.md` | B2 findings on the first backend candidate |
| `b1-backend-fix.md` | B1 fix bundle |
| `b2-fix-review2.md` | B2 PASS on the fixes |
| `f1-frontend.md` | F1 frontend bundle |
| `f2-frontend-review.md` | F2's seven findings |
| `f1-frontend-fix.md` | F1 fix bundle |
| `f2-frontend-recheck.md` | F2 PASS |
| `argon-plan.json` | Argon plan decision |
| `argon-patch.json` | Argon backend patch decision |
| `argon-grant.json` | Argon frontend grant |
| `argon-frontend-patch.json` | Argon frontend patch decision |
| `f1-ack.json`, `f2-ack.json` | frontend ACKs on the readiness hashes |
| `evidence/backend-tests.txt` | 25-test backend run |
| `evidence/full-tests.txt` | 26-test full run |
| `evidence/browser-smoke.json` | offset-form browser smoke |
| `evidence/browser-selection.json` | mouse-selection smoke after a mark |
| `evidence/ui.png` | the running UI |

The append-only board is `board/text-annotator/events.jsonl` (gitignored).

## Status

- Backend: 25 tests pass before the frontend; the full suite is 26/26 after.
- PDF: text-layer extraction with `pdftotext`; no OCR.
- Frontend: upload/drop, document list, viewer, span selection, label menu,
  keyboard offset form, annotation list/delete, export JSON, error panel.
- Browser smoke: opened `sample.txt`, added a `Person` annotation for offsets
  0–5, rendered one `<mark>` with text `First`.
- Pushed to <https://github.com/patelpb96/sideapps> on `main`.

## Reproduce

```bash
cd apps/text-annotator
node server.mjs
node --test
```

To rerun the factory process, start a fresh board and use
`factory/host.mjs` as described in `factory/README.md`. The prompts are checked
in beside the bundles; the Argon packets and decisions are checked in too.
