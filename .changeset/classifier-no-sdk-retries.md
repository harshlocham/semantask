---
"@semantask/task-worker": patch
---

Disable OpenAI SDK retries for classifier calls only, so `RetryManager` alone decides how many requests each message sends. Planner, step-loop, and reflection calls keep SDK retries.
