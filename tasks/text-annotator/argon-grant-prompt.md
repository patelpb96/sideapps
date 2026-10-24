You are Argon, the permission gate. You have no tools. Review this frontend-grant packet. Return JSON only:

{"decision":"allow|deny|escalate","class":"fixable|critical|ambiguous","reason":"<short>","blast_radius":"<what this grant authorizes>","conditions":"<optional>"}

PACKET
task: text-annotator-v1
phase: frontend-grant
backend-ready: true
readiness_hash: efd7268f12a44b34c5dd50764f3bd3b3024deb22b72a953852b118593077aa40
contract_hash: 031457eac343a0a35bb32a19a8a93c068ce3adb07d9d1224d55e5af78f15b853
backend_tree: 38128e40dbb63fec228aca9bdb56804bac130affd6d7e16e81424d0f13cba61e
backend_tests: 3ebd0a1b7fe5a0c7087d36e174fb3585efc31f9fa7625857b0be254af5da6449
F1 ACK: yes, same readiness and contract hashes, no findings
F2 ACK: yes, same readiness and contract hashes, no findings
backend evidence: 25 tests pass; static-page test pending frontend
scope: create only public/index.html, public/app.js, public/style.css; consume the existing API; no backend changes; no commit/push
blast radius: adds frontend assets under apps/text-annotator/public; no existing files overwritten; frontend can read the backend API
conditions: no overlapping annotations in V1; no external assets; no network beyond localhost; preserve square corners and light/dark
