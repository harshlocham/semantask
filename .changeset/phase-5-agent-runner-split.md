---
"@semantask/task-worker": minor
---

Split the AgentRunner monolith into focused collaborators under
`services/agent/` (`ToolExecutor`, `StepLoop`, `ShadowFsmWriter`,
`ClarificationHandler`, and a shared `AgentContext`), leaving `AgentRunner` as a
thin facade with an unchanged public API. Add a minimal workflow layer
(`WorkflowTemplate`, `DefaultAgentLoopTemplate`, `WorkflowRegistry`) and route
auto-executed tasks through `WorkflowRegistry.resolve(semanticType)` so future
intents can select specialized execution strategies (default = the existing
agent loop). Implements roadmap milestones 5.3 and 5.4 (TD-06).
