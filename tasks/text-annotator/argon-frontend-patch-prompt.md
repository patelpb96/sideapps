You are Argon, the permission gate. You have no tools. Review this exact frontend patch packet. Return JSON only:

{"decision":"allow|deny|escalate","class":"fixable|critical|ambiguous","reason":"<short>","blast_radius":"<what this patch creates/overwrites>","conditions":"<optional>"}

PACKET
task: text-annotator-v1
phase: frontend-patch
candidate: tasks/text-annotator/frontend-stage2/public
target: apps/text-annotator/public
operation: create index.html, app.js, style.css; no backend changes
tests: 26 pass, 0 fail, 0 skipped in the candidate (includes the static-page test)
review: F2 independent review PASS after 7 findings were fixed
readiness_hash: efd7268f12a44b34c5dd50764f3bd3b3024deb22b72a953852b118593077aa40
contract_hash: 031457eac343a0a35bb32a19a8a93c068ce3adb07d9d1224d55e5af78f15b853
scope: upload/drop, document list, viewer, selection offsets, label menu, keyboard offset form, annotation list/delete, export JSON, error panel
constraints: no OCR, no external assets, no network beyond localhost, no overlapping annotations, square corners, light/dark
blast radius: adds three files under public/; no existing file overwritten; no commit or push

FILE HASHES (host-computed):
3ba4c9c29ef408138c3d2c9c2a11aa8af6de77bd3b9b9caecf62cd13fac962ce *public/index.html
d2c7263272c2fc279148f2b5ea1d865b6ee035181f91a6ef69293ef9d1d4974c *public/app.js
218f2f09fc81d8df1d745251d06a089c9ef5e720ce51febc8d82d28b36d8038a *public/style.css
