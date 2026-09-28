---
"@semantask/services": minor
---

Default ingress classification to the LLM, with regex fallback when the model is missing or fails.

`TASK_CLASSIFIER_MODE` still selects `llm`, `regex`, or `shadow`. Unset is `llm`. An unrecognized value stays `regex`.
