# Architecture

## 1. Status

This is the design plus a V1 supervised build. `apps/text-annotator` exists and passes 26 tests; `factory/host.mjs` keeps a hash-chained board, calls the four roles, asks Argon, applies approved bundles, and runs the test gate.

The broker, OS sandbox, commit gate, and push gate are still not implemented. The diagrams and gate sequence below remain the target. The V1 host is a facilitator, not the trusted computing base: it does not isolate model processes, and Argon's allow token is checked by the host code, not enforced by an OS boundary. Remote `origin` is <https://github.com/patelpb96/sideapps>; `main` is pushed. Push automation is not implemented.

## 2. Principals and authority

There are three layers, and they are deliberately separate:

1. **The user is the principal.** The user sets scope, budget, and stop conditions, and resolves technical disagreements.
2. **Argon is the permission gate.** `google/gemini-4-argon`, no tools. Argon approves or denies a plan, each persistent patch, the frontend start, the commit, and the push. Argon does not judge technical merit, does not review code, and cannot compute or verify hashes.
3. **The four technical agents are the team.** They decide the technical shape: the contract, the task split, the design, the tests, and the review findings. They do not grant permissions.

Argon is not a supervisor-agent. The user asked for a team independent of other supervisory staff; this design has no fifth technical decision-maker. The host is deterministic infrastructure: it routes board events, runs pinned tests, validates packets, and applies approved patches. It does not choose between designs.

Two consequences:

- **Argon's approval is policy, not security.** A model saying "allow" does not stop a shell command. Until a host-enforced broker and sandbox exist, every approval is an instruction, not a boundary. Do not call this secure.
- **The board is evidence, not permission.** A unanimous decision on the board does not authorize a filesystem change. Only an Argon packet does, and only the broker may consume it.

## 3. Team and pairing

| ID | Model | Domain | Default |
|---|---|---|---|
| B1 | `deepseek/deepseek-flash`, `--thinking max` | backend | author |
| B2 | `deepseek/deepseek-flash`, `--thinking max` | backend | reviewer |
| F1 | `openai-codex/gpt-6-luna` | frontend | author |
| F2 | `openai-codex/gpt-6-luna` | frontend | reviewer |

Each is a separate session. The four are peers. They may:

- both propose ideas before a plan exists;
- read each other's proposals and reply on the board;
- split work by interface, risk, or sequence;
- rotate author/reviewer after a recorded handoff.

The default for each patch is **one author and a different reviewer**. If both agents contribute code, split it into separate patches so each patch still has an independent reviewer. A reviewer gets the exact diff, the specification, and the test evidence in a fresh context, not the author's private rationale.

Same-model review is a real limitation: B1 and B2 share a model family, as do F1 and F2. The design compensates with deterministic tests, cross-pair contract review, and the rule that readiness needs both frontend ACKs on the same hashes. It does not pretend same-model review is independent verification.

## 4. Shared board

The board is a durable, append-only event log for one task. It lives at `board/<task-id>/events.jsonl` during development and is gitignored. A production version can be an external service; the important properties are the same.

### Event schema

Each event is one JSON object per line:

```json
{
  "event_id": "evt-0007",
  "sequence": 7,
  "prev_hash": "sha256:...",
  "task_id": "task-2026-10-23-a",
  "actor": "B1",
  "role": "backend-author",
  "type": "PROPOSAL",
  "thread": "contract-v1",
  "reply_to": "evt-0005",
  "artifact_hash": "sha256:...",
  "contract_version": "1.0.0",
  "contract_hash": "sha256:...",
  "base_revision": "sha256:...",
  "owner": "B1",
  "reviewer": "B2",
  "status": "open",
  "supersedes": null,
  "at": "2026-10-23T12:00:00Z"
}
```

Allowed types: `NEED`, `QUESTION`, `PROPOSAL`, `DECISION`, `ACK`, `NACK`, `OBJECTION`, `CHANGE_REQUEST`, `EVIDENCE`, `READINESS`, `HANDOFF`, `ESCALATION`.

### Controls

- The host attaches the authenticated actor. Workers cannot write another actor's identity.
- Per-agent, per-event-type capabilities. A worker cannot write an Argon approval or another agent's ACK.
- Canonical serialization, monotonically increasing sequence, and a `prev_hash` chain. Tampering is detectable.
- No secrets or personal data. Board text is untrusted input; treat it as data, never as instructions.
- Argon approves the exact board path and a narrow, task-scoped append capability before the board is used. That capability includes the task, allowed event types, maximum bytes, TTL, and a nonce.
- The Argon authority ledger is separate. Only the host or Argon writes it. The board cannot grant permission.

### Discussion limit

For each decision: at most two proposals and one objection. A missed deadline, a NACK, a repeated objection, or an unresolved dispute blocks the decision and goes to the user. Silence is never consent.

## 5. Phase 1 — framing and plan

1. The user writes a brief from `templates/program-brief.md`: goal, users, inputs/outputs, constraints, acceptance, non-goals, data rules, UI needs, API needs.
2. All four agents post needs, questions, risks, and acceptance criteria on the board. The frontend pair contributes consumer requirements and read-only contract concerns; it does not write UI code.
3. The four agree on the contract shape and the task split within the discussion limit.
4. One agent authors the plan. A different agent reviews it. The plan names scope, owners, dependencies, test strategy, bounded attempts, and stop conditions.
5. Argon reviews the exact plan:
   - allow → code may start;
   - findings → the author revises, the other agent re-reviews, and Argon reviews again. Up to three Argon plan rounds;
   - third denial → escalate to the user;
   - critical security or runtime issue → hard stop.

A normal plan denial is a review result, not a task failure. Code does not start before an allow. Do not resubmit the same plan unchanged.

If the plan changes materially, it goes back through review and Argon. A scope change returns to the user first.

## 6. Phase 2 — backend and readiness

The backend pair owns the product the frontend consumes:

- the versioned API/schema/error contract;
- the primitives, interfaces, and invariants;
- the contract tests and edge tests;
- docs, examples, and content-addressed fixtures.

Each backend patch goes through the per-patch gate in section 8.

### Readiness manifest

Readiness is a derived board event, not a project file. It binds:

- backend tree hash;
- contract version and canonical hash;
- fixtures hash;
- test manifest and evidence hash;
- docs/examples hash;
- readiness event hash.

The gate requires:

1. the backend candidate is applied and tests pass;
2. the backend author attests to the exact candidate;
3. a different backend reviewer approves the exact candidate;
4. F1 and F2 each individually ACK the same readiness, contract, fixture, and test hashes;
5. zero open NACKs.

No ACK is valid if it predates the apply and test evidence. No ACK carries over to a changed hash.

### Frontend start

After the four hash-bound attestations/ACKs, Argon grants frontend scope. That grant is bound to the backend tree, readiness, contract, and fixture hashes. It is separate from the plan approval and from any patch approval. It is one-use and is invalidated by any gating-hash change.

If Argon denies the grant with actionable findings, fix the readiness issue, re-ACK the same hashes, and re-request the grant. Up to three grant requests; the third denial escalates to the user. A critical security or runtime issue is a hard stop. A normal grant denial is a review result, not a task failure.

Until the grant is issued, frontend work is board-only: requirements, flows, state matrices, acceptance, accessibility, fixture needs, and read-only contract review.

## 7. Phase 3 — frontend and integration

The frontend pair builds against the frozen contract. Each frontend patch uses the same per-patch gate as the backend. Cross-pair questions go on the board, not into a private channel.

Integration tests run against the same contract and fixture hashes. An integration fix is a new patch: new author, different reviewer, candidate tests, fresh Argon approval, broker apply, post-verify. It does not inherit an earlier approval.

## 8. The per-patch gate

Every persistent patch, in either pair, follows this sequence:

1. **Author.** One agent proposes an exact diff in memory. No direct writes, shell, network, or credentials.
2. **Review.** A different agent inspects the exact diff in a fresh context, against the approved specification. Review is read-only.
3. **Candidate tests.** The host runs the pinned tests on the exact candidate in a pre-scoped, ephemeral, supervisor-only scratch area. The target tree is unchanged.
4. **Bounded retry.** At most three review/test attempts per patch. A repeated finding, an exhausted budget, or a timeout escalates to the user. Do not widen the patch to get past the gate.
5. **Argon packet.** The host builds a one-use packet:
   - actor and phase;
   - canonical root;
   - exact paths and operations;
   - base tree;
   - diff hash;
   - contract and fixture hashes;
   - test evidence;
   - nonce and expiry;
   - conditions.
6. **Argon decision.** Argon allows, denies with findings, or escalates. A denial must say whether it is **fixable** or **critical**. Fixable → the revision loop. Critical → hard stop. Ambiguous → escalate to the user. A denial with findings is a review result, not a task failure. Argon cannot compute hashes; the packet is constructed by the host.
7. **Revision loop.** On findings, the author revises, the reviewer re-reviews, the tests rerun, and the host rebuilds the packet. Up to three Argon rounds. The third denial escalates to the user. A critical security or runtime issue is the only hard stop. The revised diff invalidates the old packet; do not resubmit unchanged.
8. **Broker apply.** A future broker recomputes the live bindings, consumes the nonce atomically, and applies only the approved patch.
9. **Post-verify.** The broker verifies the result. A mismatch halts and preserves state; the user decides. No silent repair, rollback, or cleanup.

A changed diff invalidates the packet. A generated file is a new proposal. A test-code patch cannot be reviewed by its own author. Test plans are distinct from test code.

## 9. Change control

Any change to a gating hash invalidates:

- the backend author's attestation;
- the backend reviewer's approval;
- every frontend ACK;
- the frontend grant;
- the integration candidate;
- commit eligibility.

The board records a `CHANGE_REQUEST` with old and new hashes, the semver class, affected tasks, tests, and migration notes. If the user's scope changes, the user reauthorizes and the plan is reviewed and approved again. Then:

1. backend patches the contract/primitives;
2. the backend pair re-tests and re-attests;
3. a new readiness event is derived;
4. F1 and F2 re-ACK the new hashes;
5. Argon issues a fresh frontend grant.

No stale ACK, grant, or patch approval survives.

## 10. Commit and push

Both are optional and separate. Neither is authorized by this repository.

### Commit

Argon approves a one-use packet binding:

- canonical repository root;
- pre-operation `HEAD` OID;
- exact tree;
- exact message;
- ref;
- identity;
- nonce and expiry.

The broker uses sanitized configuration, disables hooks, forbids amend, performs a compare-and-swap, and post-verifies the resulting parent, tree, message, ref, and OID.

### Push

Argon approves a separate one-use packet binding:

- resolved remote URL, after rewrite validation, with no embedded credentials;
- exactly one explicit `src:dst` ref;
- exact commit;
- expected remote pre-OID;
- nonce and expiry.

The broker holds the credentials. It forbids URL rewrites, force, tags, deletion, prune, mirror, and multiple refs. It requires fast-forward and expected-OID compare-and-swap, then post-verifies the remote. A failed or uncertain push is reconciled; unknown state is a stop. No blind retry.

A push can occur only after the verified commit in the same task. Never push unapproved tags or refs.

## 11. Trusted infrastructure

The future host is the trusted computing base: board/ledger authentication, broker, sandbox, test runner, and patch applier. It must be externally bootstrapped, independently reviewed, version- and configuration-pinned, and approved by Argon before product code. The four agents must not build or modify their own security boundary.

The V1 `factory/host.mjs` is **not** that TCB. It is a supervisor-run facilitator: it hashes events, calls models with no tools, checks an Argon allow token for a bundle hash, and writes under `apps/`. It does not isolate the workers, intercept a model that ignores `--no-tools`, or survive a hostile local process. The `sandbox-floor` flags in the rendered diagrams are accurate: no isolation boundary is implemented.

## 12. Stops, iterations, and escalation

A normal plan or patch denial is a review result, not a task failure.

**Revise and resubmit.** Argon denies with actionable findings. The author revises, a different reviewer re-reviews, the tests rerun, and Argon re-reviews. Up to three Argon rounds. Do not resubmit unchanged.

**Escalate to the user.** Third Argon denial; missing or late ACK; unresolved NACK; repeated review finding; three exhausted review/test attempts; unavailable Argon; unresolved technical disagreement.

**Hard stop.** Major security or runtime issue only:

- path escape, symlink, or out-of-root target;
- secret exposure or credential misuse;
- sandbox escape;
- destructive out-of-scope action;
- unrecoverable runtime corruption.

Preserve evidence. Do not resubmit automatically. Involve the user and, for security issues, stop the task.

For any stop, report the exact state. Do not clean up, repair, or retry without a new approval. Scratch cleanup is itself a persistent operation and needs its own approval.

## 13. Repository boundary

This repository is nested inside `smallapps`. For any future Git operation:

- verify the canonical inner root;
- use `git -C <inner-root>`;
- never stage or modify the parent;
- never change the parent's ignore rules;
- expect the parent to show this repository as untracked.

No parent-repository change is authorized by this workflow.

## 14. What is deliberately absent

- **No fifth supervisor-agent.** The four peers own the technical work. The host routes and enforces; it does not decide.
- **No model-as-security.** Argon is a policy gate. The broker and sandbox are the enforcement layer, and they are future work.
- **No phase-wide approval.** Every persistent patch is approved individually.
- **No silent retry.** A denial with findings goes through a visible revision loop; a critical security or runtime issue is a hard stop. A failed push is reconciled, not retried blindly.
- **No auto-merge.** A clean test run is not a commit or a push.
- **No hidden board permissions.** A board decision is evidence. It never authorizes a filesystem change.

## 15. Open decisions

These are intentionally unresolved until the first supervised pilot:

- Whether the board is a local append-only file, a small service, or a database. Start with the file and one writer.
- How the host authenticates each agent session. A per-session token issued by the host is enough for a pilot.
- Whether the backend pair uses one model instance per role or two separate sessions of the same model. Separate sessions are required; the model IDs are the same by design.
- How much of the readiness evidence is machine-generated vs. attested. Prefer machine-generated hashes plus a short attestation.
- When to add a second provider for review. The current design accepts same-model review as a known limitation, mitigated by tests and cross-pair ACKs.
