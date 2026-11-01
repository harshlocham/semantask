---
"@semantask/services": minor
"@semantask/task-worker": minor
---

Stop treating an LLM timeout or error at ingress as a final regex classification.

The worker now allows 15 seconds per classifier call and retries retryable failures up to twice with backoff. If the LLM still fails, the message stays unclassified and the `message.created` outbox event is retried. A missing API key still uses regex, and `shadow` and `regex` modes are unchanged.
