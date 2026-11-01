---
"@semantask/web": patch
---

Make the Upstash user state cache fail fast. Each call now gets a 500ms timeout and no SDK retries, so an unreachable host costs a cache miss instead of about 8.7s per authenticated request.
