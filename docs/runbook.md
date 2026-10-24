# Runbook

This is the manual operating procedure. For the V1 supervised host, use `factory/host.mjs` and see `factory/README.md`; this runbook remains the target sequence for the broker/sandbox era.

The V1 host keeps a hash-chained board, calls the roles with no tools, checks a Frontier Intelligence allow token for a bundle hash, applies under `apps/`, and runs tests. It is **not** a sandbox, does not isolate model processes, and does not make the permission decision enforcement.

Argon below is the default **Frontier Intelligence** instance; the role is Frontier Intelligence. Super Team mode is documented in `docs/super-team.md`. A1/A2 are `ask` roles; a task card is approved with `gate <task> task-card ...` before delegation. The card's grunt patch still follows the per-patch procedure below.

Commit and push are **manual Frontier Intelligence-gated steps**, not host automation. The operator stages, gates, commits, gates the push, and verifies the remote OID. The future broker will automate this; until then, follow section 11.

## 0. Before a task

- Use a dedicated task ID, for example `task-2026-10-23-a`.
- Create `board/<task-id>/` for the append-only event log and supervisor-only scratch. This directory is gitignored and is not source.
- Keep the board and scratch out of any patch. Workers never write them.
- Confirm the canonical repository root:

```bash
git -C program-factory rev-parse --show-toplevel
```

It must be the inner `program-factory` root, not `smallapps`.

## 1. Write the brief

Fill in `templates/program-brief.md`. Keep it short. The brief must name:

- the goal and the non-goals;
- the users and the inputs/outputs;
- acceptance criteria a test can check;
- data and secret rules;
- the frontend's needs and the backend contract questions;
- what would make the task stop.

The brief is a board event, not a project file. If you persist it under `board/<task-id>/`, it is covered by the board capability, not by a source patch.

## 2. Ask Argon for the board capability

Interim, using the existing guard:

```bash
python ~/.agents/skills/deepseek-operator/assets/guard.py ask \
  --action overwrite \
  --target "<inner-repo>/board/<task-id>" \
  --reason "Create a task-scoped append-only board and supervisor-only scratch for <task-id>. No existing content is overwritten; the target is verified absent. Workers cannot write this path." \
  --evidence "<paste: test ! -e target; canonical root; parent status clean; planned event files>" \
  --project "<inner-repo>" \
  --agent "pi/host"
```

The guard is an interim policy check. It does not create the hash-chained board, authenticate agents, or enforce per-event capabilities. Those are future host work.

State the blast radius explicitly in the evidence. The guard deterministically downgrades an `allow` with an empty `blast_radius` to `escalate`, and an escalation is the human's call, not a retry.

## 3. Run the four agents

Each agent is a separate `pi -p` process with no tools, no session, no extensions, and no context files. Paste the relevant snapshot into the prompt. The smallest prompt is the safest prompt.

### B1 / B2 — backend, DeepSeek Flash at max thinking

```bash
pi -p --model deepseek/deepseek-flash --thinking max \
  --no-tools --no-mcp --no-session --no-extensions --no-context-files \
  --system-prompt "You are B1, backend author. You have no tools. Return a proposal or a unified diff only." \
  -- "$PROMPT"
```

Use the same command for B2 with a reviewer system prompt and the exact diff/spec/evidence. B2 must not see B1's private rationale, only the artifact under review.

### F1 / F2 — frontend, GPT-6 Luna

```bash
pi -p --model openai-codex/gpt-6-luna \
  --no-tools --no-mcp --no-session --no-extensions --no-context-files \
  --system-prompt "You are F1, frontend author. You have no tools. Return a proposal or a unified diff only." \
  -- "$PROMPT"
```

Use the same command for F2 with a reviewer system prompt and the exact diff/spec/evidence.

If you give an agent `--tools read` for convenience, that is not a sandbox: `read` can reach paths outside the repo. Prefer `--no-tools` and paste the snapshot.

## 4. Board events

The host appends one JSON object per line. Workers do not write the board. Example:

```json
{"event_id":"evt-0001","sequence":1,"prev_hash":"sha256:genesis","task_id":"task-2026-10-23-a","actor":"B1","role":"backend-author","type":"PROPOSAL","thread":"contract-v1","reply_to":null,"artifact_hash":"sha256:...","contract_version":null,"contract_hash":null,"base_revision":"sha256:...","owner":"B1","reviewer":"B2","status":"open","supersedes":null,"at":"2026-10-23T12:00:00Z"}
```

The host computes the hash chain. An ACK must name the exact artifact/contract/fixture/test hashes. A board decision is evidence; it does not authorize a patch.

## 5. Plan gate

1. One agent authors the plan as a board `PROPOSAL`.
2. A different agent posts a `DECISION` with findings.
3. If the plan is accepted, send a bounded digest to Argon:

```bash
python ~/.agents/skills/deepseek-operator/assets/consult.py \
  --brief board/<task-id>/brief.txt \
  --state board/<task-id>/state.json \
  --results board/<task-id>/plan-digest.txt \
  --out board/<task-id>/decisions.jsonl
```

Read the verdict, not just the label:

- `ok` — the plan is usable; proceed.
- `drift` — revise the quoted line, have the other agent re-review, and resubmit. Up to three Argon plan rounds. The third denial escalates to the user.
- `violation` — inspect it. A security or runtime violation is a hard stop; a fixable specification violation is revised and resubmitted like `drift`.

Do not resubmit the same plan unchanged. This is an interim plan review, not the future one-use plan packet.

## 6. Backend patch loop

1. B1 returns a unified diff. The host writes it to `board/<task-id>/patches/patch-NNN.diff` (supervisor-only scratch).
2. B2 reviews the exact diff and posts review evidence.
3. The host tests the exact candidate in scratch. Do not test by applying to the target first.

```bash
# Read-only check against the target
git -C "<inner-repo>" apply --check board/<task-id>/patches/patch-NNN.diff

# Test in a fresh throwaway copy, not the target
CANDIDATE="$(mktemp -d)"
cp -r "<inner-repo>/." "$CANDIDATE/"
git -C "$CANDIDATE" apply board/<task-id>/patches/patch-NNN.diff
# run the pinned test command in the candidate
# leave the temp directory for the OS; do not rm -rf it without approval
```

4. If review or tests fail, B1 revises. At most three review/test attempts. A repeated finding or exhausted attempts escalates to the user.
5. Build the packet: root, paths, base tree, diff hash, contract/fixture hashes, test evidence, nonce, expiry, conditions.
6. Ask Argon and apply only on allow. A denial with findings is iterative: revise, re-review, re-test, rebuild the packet, and resubmit. Up to three Argon rounds; the third denial escalates to the user. Only a critical security/runtime issue is a hard stop.

The guard exits matter:

- `0` — allow; run the command.
- `1` — deny. Read the reason. If it names fixable findings, revise the patch and resubmit; do not resubmit the same patch. If it names a critical security/runtime issue, stop.
- `2` — escalate; the user decides.
- `3` — reviewer unreachable; stop. No review happened.

```bash
python ~/.agents/skills/deepseek-operator/assets/guard.py run \
  --action overwrite \
  --target "<inner-repo>" \
  --reason "Apply the reviewed backend patch after candidate tests. The packet names the exact paths, base, diff hash, and test evidence." \
  --evidence board/<task-id>/patch-packet.txt \
  --project "<inner-repo>" \
  --agent "pi/host" \
  -- git -C "<inner-repo>" apply board/<task-id>/patches/patch-NNN.diff
```

This is not the future hash-bound broker. The guard checks the stated target and reason, not the diff hash. Record that limitation in the board.

7. Verify the applied result against the packet. A mismatch stops and preserves state. Do not repair or clean up without a new approval.

## 7. Readiness

After the backend is applied and tests pass:

```bash
git -C "<inner-repo>" rev-parse HEAD^{tree}
sha256sum "<inner-repo>/contract.json" "<inner-repo>"/fixtures/* "<inner-repo>"/test/*
```

Build a readiness manifest with the backend tree, contract version/hash, fixtures, test evidence, docs/examples, and readiness hash. Post it as a `READINESS` event.

Then:

1. B1 posts an attestation bound to those hashes.
2. B2 posts an approval bound to the same hashes.
3. F1 and F2 each post an individual `ACK` bound to the same readiness, contract, fixture, and test hashes.
4. No NACK, no missing ACK. A missing ACK blocks; it is not consent.

Only after all four are present does the frontend grant gate open.

## 8. Frontend grant

Argon separately grants frontend scope, bound to the exact backend tree, readiness, contract, and fixture hashes. In the manual pilot, use `consult.py` with the readiness packet as the digest and treat `ok` as the grant; record the limitation. The future broker has a dedicated one-use grant.

If the grant is denied with findings, fix the readiness issue, re-ACK the same hashes, and re-request. Up to three grant requests; the third denial escalates to the user. A critical security/runtime issue is a hard stop; a normal grant denial is not.

Before this, F1/F2 may only post requirements, flows, state matrices, acceptance, fixture needs, and read-only contract reviews. No persistent frontend artifacts or UI code.

## 9. Frontend loop

Same per-patch gate as backend. F1 authors, F2 reviews, the host tests the candidate, Argon approves the exact patch, the broker applies, the host verifies. Every integration fix is a new patch.

## 10. Change control

If any gating hash changes:

1. stop affected frontend work;
2. post a `CHANGE_REQUEST` with old/new hashes, semver class, affected tasks, tests, and migration;
3. if the user's scope changed, get user reauthorization;
4. backend reworks, re-tests, and re-attests;
5. derive a new readiness event;
6. F1 and F2 re-ACK the new hashes;
7. Argon issues a fresh frontend grant.

No stale ACK, grant, or patch approval is reused.

## 11. Commit and push

The host does not automate these. They are manual, one-use Argon-gated steps.

1. Stage the exact tree. Verify no `board/` or `apps/*/data/` runtime state is staged. Compute `git write-tree`.
2. Gate the commit: root, parent, tree hash, exact message, ref, identity, no amend, no hooks. Allow only.
3. Commit with the approved tree. Recompute `git write-tree`; if it changed, stop.
4. Gate the push: resolved remote URL, one explicit `src:dst` ref, exact commit, expected remote OID. Allow only.
5. Verify the remote OID before pushing (fast-forward / expected-OID lease). Push one ref with no tags, force, delete, prune, mirror, or multi-ref.
6. Read back the remote OID. A mismatch or unknown state stops and is reconciled.

Credentials stay in the git/gh credential helper; never in the repo. The future broker will do this with a one-use token; until then, the manual gate is the record.

## 12. Stop checklist

A normal plan or patch denial is a review result, not a task failure.

**Revise and resubmit.** Argon returns findings on a plan, patch, or grant. Revise the artifact, have a different agent re-review, rerun the tests, and resubmit. Up to three Argon rounds. Do not resubmit unchanged.

**Escalate to the user.** Third Argon denial; missing or late ACK; unresolved NACK; repeated review finding; three exhausted review/test attempts; unavailable Argon; unresolved technical disagreement.

**Hard stop.** Major security or runtime issue only: path escape, secret exposure, sandbox escape, destructive out-of-scope action, credential misuse, or unrecoverable runtime corruption. Preserve evidence; do not resubmit automatically.

**Halt and preserve state.** A post-apply mismatch, an unknown remote state, or an uncertain push result. The user decides what happens next.

For any stop, report the exact state. Do not clean up, repair, or retry without a new approval.
