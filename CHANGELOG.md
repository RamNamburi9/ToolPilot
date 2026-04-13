# Changelog

## 1.0.0 (2026-04-13)

### Features
- Autonomous multi-round agent loop using Copilot LLM (Claude, GPT-4o)
- External tool bridge via simple script protocol (any language)
- File-based trigger/output for CI/CD integration
- Configurable system prompts, model selection, output schema
- Rate limit handling with automatic retry
- Agent cancellation support
- Structured JSON output with metadata (tools used, rounds, elapsed time)
- Tool listing command (Ctrl+Shift+P → Show Loaded Tools)
- Output channel logging + file logging
- Example Python tool script with 6 tools (search, read, grep, run, analyze, list)
