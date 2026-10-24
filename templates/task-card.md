# Task card — <id>

A card is the only way work is delegated from the frontier pair to the grunt
squad. If a line cannot be filled in, the task is not delegable.

## Identity

- **Status:** draft | accepted | returned | done
- **Parent plan / contract hash:**
- **Base commit:**
- **Frontier owner:** A1
- **Frontier reviewer:** A2
- **Grunt pair:** B1/B2 (backend) or F1/F2 (frontend)
- **Argon card packet:** `<path or hash>`

## Goal

One sentence. If it needs "and", split the card.

## Why this is delegable

Explain the exact diff shape: what is already decided, what is fixed, and why
there is no open design question.

## Scope

- **Allowed files / paths:**
- **Allowed interfaces / types / endpoints:**
- **Fixtures / test data:**
- **Do not touch:**
- **Non-goals:**

## Tests (red first)

A1 writes these; A2 reviews them. The grunt pair may add tests, but may not
weaken, delete, skip, or rewrite these.

| # | Test file | Command | Now | Expected after |
|---|---|---|---|---|
| 1 | | | fail | pass |
| 2 | | | fail | pass |

- **Test hash:**
- **Full command:** `node --test`

## Budget

- **Max files changed:**
- **Max lines changed:**
- **Max grunt review attempts:** 3
- **Frontier review rounds:** 1 (more requires a recorded reason)

## Stop conditions

Stop and return to A1 if any of these happens:

- an interface, contract, schema, or dependency must change;
- a frontier test fails for a reason the card did not anticipate;
- the patch grows past the budget;
- the grunt pair cannot name the exact behavior to change;
- a security or runtime critical issue appears.

## Frontier review

A1 checks the patch against this card, the tests, and the non-goals. A green
test run is necessary, not sufficient. If the card was wrong, it returns to A1;
it does not go back to the grunt pair for a fourth round.

## Return artifact

- Patch bundle path:
- Test evidence path:
- Board events:
- Argon patch packet / decision:
