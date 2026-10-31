---
"@semantask/task-worker": patch
---

Add `replay:classifier`, which runs a fixture of messages through the real ingress classifier and reports type, confidence, suggestion decision, latency, and pass or fail. `--runs N` checks stability across repeated runs. `--mock` uses a stub LLM, so it needs no API key.
