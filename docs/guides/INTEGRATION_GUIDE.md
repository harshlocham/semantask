# Integration & Setup Guide

> **Documentation status (2026-07-01):** Parts of this guide predate the current monorepo layout.
> For accurate architecture and runtime flows, prefer [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md),
> [`docs/architecture/task-worker-execution-flow.md`](../architecture/task-worker-execution-flow.md),
> and [`docs/guides/oss-inference-compatibility.md`](./oss-inference-compatibility.md).
> Supported LLM providers today: `openai`, `openai-compatible`, `huggingface`, `amd-openai-compatible`
> (see `apps/task-worker/services/llm/provider-factory.ts`) — not Anthropic/Cohere/Together.

## Quick Start (Production Ready)

### 1. Environment Setup
```bash
# Copy environment template
cp env.sample .env.local

# Configure LLM Provider (choose one — see provider-factory.ts for supported values)
export LLM_PROVIDER=openai                    # or: openai-compatible, huggingface, amd-openai-compatible
export OPENAI_API_KEY="..."                   # or HUGGINGFACE_API_KEY / AMD_API_KEY as appropriate
export LLM_MODEL="gpt-4o-mini"

# Task Agent Timeouts (optional, sensible defaults included)
export TASK_AGENT_LLM_TIMEOUT_MS=35000        # 35s for LLM calls
export TASK_AGENT_TOOL_TIMEOUT_MS=60000       # 60s for tool execution
export TASK_AGENT_ITERATION_TIMEOUT_MS=120000 # 120s per iteration

# Demo Mode (optional)
export TASK_AGENT_MAX_ITERATIONS=5            # Limit for predictable demo
```

### 2. Start Services
```bash
# Terminal 1: Database & Message Queue
docker-compose up mongo redis

# Terminal 2: Task Worker (from repo root)
pnpm run task-worker

# Terminal 3: Monitor Logs
tail -f logs/agent-runner.log
```

### 3. Verify Functionality
```bash
# Submit a task (uses agent to plan + execute)
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Send notification email",
    "description": "Send an email to customer@example.com about their order",
    "tools": ["github-issues", "send-email"]
  }'

# Check execution logs
grep "llm:request" logs/agent-runner.log      # See agent planning
grep "step:execute" logs/agent-runner.log     # See tool execution
grep "lifecycle:completed" logs/agent-runner.log  # See completion
```

---

## Provider Configuration

### OpenAI (Recommended for Demo)
```bash
export LLM_PROVIDER=openai
export OPENAI_API_KEY="sk-..."
export LLM_MODEL="gpt-4o-mini"  # Fast and capable

# Timeout: 30-35s (handles API variations)
export TASK_AGENT_LLM_TIMEOUT_MS=35000
```

### Claude (Anthropic) — **not supported**

Anthropic is **not** implemented in `provider-factory.ts`. Use an OpenAI-compatible proxy if you need Claude behind a unified client.

### Custom/On-Premise (Via AMD or vLLM)
```bash
export LLM_PROVIDER=amd-openai-compatible   # or openai-compatible
export AMD_API_KEY="..."
export AMD_BASE_URL="https://your-amd-endpoint.com/v1"

# Adjust timeout for your infrastructure
export TASK_AGENT_LLM_TIMEOUT_MS=40000
```

---

## Architecture Overview (current runtime)

```
POST /api/messages (web)
       ↓
OutboxEvent message.created
       ↓
task-worker: classifyMessage() [regex ingress]
       ↓ (if task-like)
OutboxEvent task.execution.requested
       ↓
processTaskExecutionRequested → withExecutionLease → AgentRunner
       ├─ LLM (planner / step decision / reflection) via services/llm/*
       ├─ ToolRegistry (send_email, schedule_meeting, create_github_issue)
       └─ execution events → socket /internal/task-execution-updated
```

Tasks are created from **chat messages** (or task APIs), not a standalone `TaskWorkerService` class. See [`task-worker-execution-flow.md`](../architecture/task-worker-execution-flow.md).

### Key Components for Reliability
- **Agent Runner**: Persistent execution loop with state recovery
- **LLM Provider**: Pluggable with fallback logic
- **Tool Registry**: Dynamic tool loading with validation
- **Lease System**: Prevents duplicate execution
- **Timeouts**: Configurable per phase with sensible defaults

---

## Troubleshooting

### LLM Request Timeout
```
Error: llm:error - category: timeout
```
**Causes:**
- Slow network to LLM provider
- Provider rate limiting or overload
- Timeout setting too low for chosen model

**Fix:**
```bash
# Increase timeout for your LLM
export TASK_AGENT_LLM_TIMEOUT_MS=60000  # 60s
```

### Tool Execution Failure
```
Error: step:execute - tool: send-email - error: invalid_signature
```
**Causes:**
- Missing API key (GITHUB_TOKEN, RESEND_API_KEY)
- Malformed tool request from LLM
- External service unavailable

**Fix:**
```bash
# Verify all credentials
echo $GITHUB_TOKEN
echo $RESEND_API_KEY

# Check logs for exact error
grep "step:execute" logs/agent-runner.log | grep send-email
```

### Task Stuck in Progress
```
status: progress (for > 2 minutes)
```
**Causes:**
- LLM hanging (check logs for `llm:request`)
- Deadlock in tool execution
- Server crash (logs will show it)

**Fix:**
```bash
# LLM timeouts are enforced
# Check that TASK_AGENT_LLM_TIMEOUT_MS is set

# Restart task (it's idempotent)
curl -X POST http://localhost:3000/tasks/{taskId}/retry
```

---

## Performance Tuning

### For Fast Demos (< 40 seconds)
```bash
export TASK_AGENT_LLM_TIMEOUT_MS=35000     # 35s for LLM
export TASK_AGENT_TOOL_TIMEOUT_MS=60000    # 60s per tool
export TASK_AGENT_ITERATION_TIMEOUT_MS=120000  # 120s per loop
export TASK_AGENT_MAX_ITERATIONS=5         # Cap iterations
export LLM_MODEL="gpt-4o-mini"             # Use fast model
```

### For Complex Tasks (allow more time)
```bash
export TASK_AGENT_LLM_TIMEOUT_MS=45000     # More LLM time
export TASK_AGENT_TOOL_TIMEOUT_MS=120000   # More tool time
export TASK_AGENT_ITERATION_TIMEOUT_MS=180000  # More per-iteration time
export TASK_AGENT_MAX_ITERATIONS=10        # More iterations
export LLM_MODEL="gpt-4"                   # Use more capable model
```

---

## Testing

### Unit Tests
```bash
cd apps/task-worker
pnpm test                      # Run all tests
pnpm test -- tests/agent-runner.test.ts  # Agent tests only
pnpm test -- tests/llm-provider.test.ts  # Provider tests only
```

### Integration Test (End-to-End)

> **Note:** End-to-end task creation is driven by sending a chat message through the app or
> `POST /api/messages`, which enqueues `message.created`. Direct `POST /api/tasks` exists but
> follows a different contract — see `apps/web/app/api/tasks/route.ts`.

```bash
# Start services (MongoDB must be reachable via MONGODB_URI)
docker compose up redis &
pnpm run dev &
```

# Submit task and monitor
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{...}' > /tmp/task.json

TASK_ID=$(jq -r '.taskId' /tmp/task.json)

# Watch logs until completion
watch -n 1 "curl -s http://localhost:3000/tasks/$TASK_ID | jq '.status'"
```

---

## Submission Artifacts

Key files for judges:
- [DEPLOYMENT_CHECKLIST.md](../DEPLOYMENT_CHECKLIST.md) - Pre-flight requirements
- [DEMO_HARDENING.md](../DEMO_HARDENING.md) - Demo scenario & hardening paths
- [SUBMISSION_NARRATIVE.md](../SUBMISSION_NARRATIVE.md) - Technical deep dive
- [examples/amd-production-env.md](./examples/amd-production-env.md) - Production config

Run validation:
```bash
bash validate-demo.sh       # Pre-demo checks
bash validate-submission.sh # Final submission validation
```
