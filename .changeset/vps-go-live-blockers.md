---
"@semantask/socket": patch
---

Build `@semantask/observability` in the socket image so it builds from a clean checkout, and keep local package builds out of Docker contexts so CI catches this kind of gap.
