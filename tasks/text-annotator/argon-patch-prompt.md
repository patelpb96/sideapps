You are Argon, the permission gate. You have no tools. Review this exact backend patch packet. Return JSON only:

{"decision":"allow|deny|escalate","class":"fixable|critical|ambiguous","reason":"<short>","blast_radius":"<what this patch creates/overwrites>","conditions":"<optional>"}

PACKET
task: text-annotator-v1
phase: backend-patch
candidate: tasks/text-annotator/stage2
target: apps/text-annotator
operation: create 8 new backend files; tests already exist; public/ remains empty
tests: 25 pass; 1 expected failure for missing public/index.html (frontend not granted yet)
review: B2 independent review PASS after fixing unsorted validation, DOCX parser complexity/bounds, PUT ordering, annotation metadata
conditions from plan gate: strict store IDs; static path containment; PDF temp cleanup; no frontend files before grant
blast radius: adds package.json, server.mjs, src/*.mjs under apps/text-annotator; no existing product file is replaced; no commit or push
hard stop check: no path escape, no secret access, no network, no destructive out-of-scope action

FILE HASHES (host-computed):
6262121982c88255c2e955af8370f478a41274dd17418f97d121c619274098a8 *package.json
e5fa13a007031ecf275efb7d24ee39cf63713b0fcc392a8a88269820d858320b *server.mjs
6239370ab60314d2f9425c3c8c4a634872cac9f3ee6f3afdb6ac846e8e019d74 *src/docx.mjs
4638f13aff4e1ccafb4dff9261e4fdef59a95826824b829a9173b478be0682fa *src/extract.mjs
1c212923d9da2bde4c2c7cda67bbfedc2a7cc24e2ce549135b51ede61fb6518b *src/id.mjs
17a159fd405bace3dc153bd9069a859b2cb0e9b873d9594172f7e45d54d76765 *src/pdf.mjs
4087ec188748d6a5d0da8edb89846af3460e7dc40f0cbbe0ae6c0ad106bac4ca *src/store.mjs
581a72927561e34ca795c5a808a39324b19f461f02711dbf2d7a245d7213b20e *src/validate.mjs
