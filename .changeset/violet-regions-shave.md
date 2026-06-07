---
"@chat/services": patch
"@chat/task-worker": patch
"@chat/web": patch
---

Enhance execution lease management and task processing.

- Added execution lease validation before task processing begins.
- Improved handling of lease contention with a dedicated execution lease busy error.
- Refined task action ID generation for more consistent task tracking.
- Cleaned up task-related API code and removed unused imports.