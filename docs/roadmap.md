# Roadmap

Phase 0 is done. Phase 1 is partially done as a supervised facilitator, not the full trusted host. Phase 5 has one supervised pilot: the text annotator.

## Phase 0 — design (done)

- Roles, authority, board protocol, backend-first readiness, patch gate, change control, commit/push gates.
- Four Flow specs and rendered SVGs.
- Declarative role/gate config and a brief template.
- No remote, commit, or push.

## Phase 1 — host runner and board (partial)

`factory/host.mjs` currently provides the board, role calls, Argon gate, bundle apply, and test gate. Still missing: per-event capabilities, isolated scratch, live packet validation, and a real broker. Deliver the rest of the host that can:

- append hash-chained board events with host-attached actor identity;
- issue per-agent, per-event-type capabilities;
- read a task directory and a fixed brief;
- compute hashes (tree, files, fixtures, test manifest);
- run a pinned test command in an isolated scratch copy;
- stop on timeout, non-zero exit, missing evidence, or hash mismatch.

Start with one writer (the host) and one task at a time. Do not add a web UI.

**Exit test:** replay a task from the event log; the host reconstructs the same state and refuses a forged ACK.

## Phase 2 — broker and sandbox

Deliver the trusted computing base:

- a broker that is the only process allowed to write the project tree;
- a sandbox that denies network, credentials, and writes outside the scratch area by default;
- a one-use packet format for patches: root, paths, base, diff hash, evidence, nonce, expiry;
- atomic consumption and post-apply verification;
- an append-only authority ledger separate from the board.

This is the first phase where "Argon approved" can be enforced rather than merely recorded.

**Exit test:** a stale packet, a swapped diff, a path escape, a symlink, and a replayed nonce are all refused. A denied action leaves the tree unchanged.

## Phase 3 — automated patch gate

Wire the cycle into the runner:

- author proposal -> different reviewer -> candidate tests -> packet -> Argon -> broker -> verify;
- a three-attempt cap with a repeated-finding stop;
- test-code authorship and review separation;
- generated diffs as new proposals;
- scratch cleanup as a separately approved operation.

**Exit test:** a patch that fails once and passes on attempt two is applied exactly once; a patch that fails three times stops with the target untouched.

## Phase 4 — commit and push

Add dedicated one-use gates:

- commit: root, pre-HEAD, tree, message, ref, identity; no amend or hooks; CAS and post-verify;
- push: resolved credential-free URL, one explicit ref, commit, expected remote pre-OID; broker-only credentials; fast-forward and expected-OID CAS; post-verify and reconcile.

Do not reuse a patch approval for a commit or a commit approval for a push.

**Exit test:** a remote moved between approval and push is detected and stopped; a force, tag, delete, mirror, or multi-ref push is refused.

## Phase 5 — supervised pilot

Run one small program end to end with a human watching:

- measure time per phase, Argon calls, model cost, and review rounds;
- record every stop and every time a gate was bypassed or unavailable;
- check whether the board is being used for real design or only for ceremony;
- check whether the frontend starts before readiness (it should not).

**Exit test:** one complete run with zero unreviewed persistent writes, zero stale approvals, and a readiness handoff that both frontend agents accept on the same hashes.

## Phase 6 — hardening

Only after the pilot:

- consider a second provider for review where same-model bias matters;
- add a bounded retry policy and a spend meter;
- add a dashboard for open tasks, gates, and invalidations;
- decide whether the board stays a local file or becomes a service;
- write the operator guide from the actual run, not the design.

Unattended operation is out of scope until the broker, sandbox, and commit/push gates have been validated against adversarial tests.

## Phase 7 — Super Team pilot (design)

The frontier pair is declared in `config/roles.json` and accepted by
`factory/host.mjs`; no Super Team task has run. The pilot should:

- run A1/A2 on a real task with a contract and a frontier core;
- produce at least two task cards, one accepted and one rejected as not narrow
  enough;
- run the accepted card through the grunt pair, the card tests, the Argon
  patch gate, and A1's frontier review;
- record every time the grunt pair stopped because the card was wrong;
- measure frontier tokens vs grunt tokens per accepted card;
- exercise the independent review route: Astra default, Claude handoff, the
  5-minute human-choice timeout, and the one-round degraded fallback.

**Exit test:** one accepted card passes A1 review without a contract change;
one rejected card stays on the frontier track; the grunt pair never weakens a
frontier test; a vague card is returned to A1, not to the grunt pair.
