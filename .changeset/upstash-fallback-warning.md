---
"@semantask/web": patch
---

Log a warning, at most once a minute for each of the rate limiter and the user state cache, when either falls back because Upstash timed out or returned an error.
