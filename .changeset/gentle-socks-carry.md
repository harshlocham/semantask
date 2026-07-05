---
"@semantask/services": major
"@semantask/task-worker": major
"@semantask/redis": major
"@semantask/types": major
"@semantask/auth": major
"mobile": major
"@semantask/socket": major
"@semantask/db": major
"@semantask/web": major
---

Rebrand from chat-app / @chat to Semantask / @semantask.
- Product name: AgentMesh AI → Semantask
- npm scope: @chat/* → @semantask/*
- Default MongoDB database: chat-app → semantask
- VPS deploy path example: /opt/chat-app → /opt/semantask

Breaking for anyone still importing @chat/* or using the old DB/deploy paths.
Existing Mongo data in `chat-app` is unchanged; update MONGODB_URI or migrate data.