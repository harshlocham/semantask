---
"@semantask/services": minor
"@semantask/task-worker": minor
---

Add `requeue:dead-letter-messages`, which moves dead-lettered `message.created` outbox events back to pending with attempts reset. Pass `--dry-run` to count them without writing.
