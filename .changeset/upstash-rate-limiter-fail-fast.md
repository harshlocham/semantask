---
"@semantask/web": patch
---

Make the Upstash rate limiter fail fast. Each call now gets a 500ms timeout and no SDK retries, including the block check in `enforceAuthRateLimit`. A timeout or error falls back to the in-memory limiter, so a host that stops answering no longer allows requests without a limit or leaves auth requests waiting.
