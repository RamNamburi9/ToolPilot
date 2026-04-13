# ToolPilot

**Run autonomous AI agent loops with any external tools — powered by your Copilot subscription.**

No API keys. No paid credits. No vendor lock-in. Write tools in any language. Get structured JSON output.

---

## What Is This?

ToolPilot turns any script into an **autonomous AI agent** that uses your existing **GitHub Copilot subscription** to run multi-round tool-calling loops — the same way Kilo Code or Cline work, but **free**.

You provide:
- A **tool script** (Python, Node, Bash, anything) that follows a simple protocol
- A **trigger file** (`input.json`) with the task
- An optional **config** (system prompt, model preference, output schema)

ToolPilot does the rest:
1. Loads your tools dynamically
2. Starts an autonomous LLM agent loop (Claude, GPT-4o — whatever Copilot provides)
3. The LLM decides which tools to call and when
4. Writes structured **JSON output** when done

No human-in-the-loop. No chat window. Fully autonomous.

---

## Why ToolPilot?

| Feature | ToolPilot | Kilo Code | Copilot Chat | MCP Servers |
|---------|-----------|-----------|--------------|-------------|
| Uses Copilot subscription (free) | ✅ | ❌ ($$$) | ✅ | ✅ |
| Autonomous agent loop | ✅ | ✅ | ❌ (chat) | ❌ (chat) |
| External tools (any language) | ✅ | ❌ | ❌ | ✅ |
| File-based trigger/output | ✅ | ❌ | ❌ | ❌ |
| Structured JSON output | ✅ | ❌ | ❌ | ❌ |
| CI/CD integration | ✅ | ❌ | ❌ | ❌ |
| No build step | ✅ | ❌ | N/A | Varies |

---

## Quick Start

### 1. Install

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=rnamburi.toolpilot) or:

```
ext install rnamburi.toolpilot
```

### 2. Create a Tool Script

Any script that supports two modes:

**List tools** (`--list-tools`):
```bash
python tools.py --list-tools
```
```json
[
  {
    "name": "search_logs",
    "description": "Search application logs for a pattern",
    "inputSchema": {
      "type": "object",
      "properties": {
        "pattern": { "type": "string", "description": "Regex pattern to search" },
        "service": { "type": "string", "description": "Service name" }
      },
      "required": ["pattern"]
    }
  }
]
```

**Execute tool** (`--tool <name> --args <json>`):
```bash
python tools.py --tool search_logs --args '{"pattern": "ERROR", "service": "api"}'
```
```
2026-04-13 10:15:32 ERROR api: Connection timeout to database
2026-04-13 10:15:33 ERROR api: Retry failed after 3 attempts
```

That's it. Two modes. Any language.

### 3. Add Config

Create `.vscode/toolpilot.json`:

```json
{
  "tools": {
    "command": "python",
    "script": "./tools.py",
    "listArgs": ["--list-tools"],
    "timeout": 180000
  },
  "agent": {
    "systemPrompt": "You are an expert SRE. Use tools to investigate the incident.",
    "maxRounds": 12
  },
  "trigger": {
    "watchPattern": "input.json",
    "outputFile": "output.json"
  }
}
```

### 4. Trigger the Agent

Write an `input.json`:
```json
{
  "task": "Investigate why the API service is returning 500 errors since 10:00 AM"
}
```

ToolPilot watches for file changes, runs the autonomous agent loop, and writes `output.json` with structured results.

Or run manually: **Ctrl+Shift+P** → **ToolPilot: Run Agent**

---

## Configuration Reference

### `.vscode/toolpilot.json`

```json
{
  "tools": {
    "type": "script",           // Tool source type
    "command": "python",        // Executable to run the script
    "script": "./tools.py",    // Path to tool script (relative to workspace)
    "listArgs": ["--list-tools"], // Arguments to list all tools
    "timeout": 180000           // Tool execution timeout (ms)
  },
  
  "agent": {
    "systemPrompt": "...",      // System prompt for the LLM
    "maxRounds": 12,            // Maximum agent loop iterations
    "model": {
      "vendor": "copilot",      // Model vendor
      "family": ""              // Model family (empty = auto-select best)
    },
    "outputFormat": {
      "required": ["summary"],  // Required fields in output JSON
      "description": "..."     // Output format instructions for the LLM
    }
  },

  "trigger": {
    "type": "file",             // Trigger type
    "watchPattern": "input.json", // File to watch for changes
    "outputFile": "output.json",  // Where to write results
    "debounceMs": 3000          // Debounce delay (ms)
  },

  "logFile": "toolpilot.log",  // Log file path
  "logLevel": "normal"         // minimal | normal | verbose
}
```

### VS Code Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `toolpilot.configFile` | `.vscode/toolpilot.json` | Path to config file |
| `toolpilot.logLevel` | `normal` | Logging verbosity |

---

## Tool Script Protocol

Your tool script must handle two invocations:

### `--list-tools`

Print a JSON array of tool definitions to stdout:

```json
[
  {
    "name": "tool_name",
    "description": "What this tool does — be detailed, the LLM reads this",
    "inputSchema": {
      "type": "object",
      "properties": {
        "param1": { "type": "string", "description": "Parameter description" }
      },
      "required": ["param1"]
    }
  }
]
```

### `--tool <name> --args <json>`

Execute the named tool with the JSON arguments. Print the result to stdout as plain text.

```bash
# Example invocations:
python tools.py --tool search_logs --args '{"pattern": "ERROR"}'
node tools.js --tool query_db --args '{"sql": "SELECT count(*) FROM orders"}'
./tools.sh --tool check_health --args '{"endpoint": "https://api.example.com"}'
```

### Example Tool Scripts

- **Python**: [examples/python-tools.py](./examples/python-tools.py) — File search, grep, code analysis, shell commands
- More examples at [github.com/rnamburi/toolpilot/examples](https://github.com/rnamburi/toolpilot)

---

## Commands

| Command | Description |
|---------|-------------|
| **ToolPilot: Run Agent** | Enter a query and run the agent loop |
| **ToolPilot: Run Agent with Input File** | Trigger agent using the configured watch file |
| **ToolPilot: Show Loaded Tools** | List all tools loaded from your script |
| **ToolPilot: Stop Agent** | Cancel a running agent loop |

---

## Real-World Use Cases

### Incident Triage
Write tools that search production logs, query databases, check service health. Trigger with incident data. Get structured diagnosis + fix recommendations.

### Automated Code Review
Write tools that run linters, check test coverage, search for patterns. Trigger with PR diff. Get structured findings + severity ratings.

### Security Scanning
Write tools that check dependencies, scan for secrets, analyze permissions. Trigger on code changes. Get vulnerability report with remediation steps.

### Data Pipeline QA
Write tools that validate schemas, check row counts, compare distributions. Trigger on new data. Get quality report with anomalies flagged.

### CI/CD Integration
Your pipeline writes `input.json` → ToolPilot runs analysis → pipeline reads `output.json`. Works with any CI system.

---

## How It Works

```
                    ┌─────────────────────┐
                    │   Your Tool Script  │
                    │  (Python/Node/etc)  │
                    └──────────┬──────────┘
                               │
input.json ──► ToolPilot ──────┤──── Copilot LLM ──► output.json
  (trigger)    Extension       │    (Claude/GPT-4o)    (results)
                               │
                    ┌──────────┴──────────┐
                    │  Autonomous Agent   │
                    │  Loop (up to 12     │
                    │  rounds of tool     │
                    │  calling)           │
                    └─────────────────────┘
```

1. **Trigger**: File watcher detects `input.json` change (or manual command)
2. **Load**: Tools loaded dynamically from your script via `--list-tools`
3. **Loop**: LLM reads input + tool list → decides which tools to call → gets results → decides next step → repeats
4. **Output**: When LLM has enough info, it writes structured JSON to `output.json`

The LLM (Claude Opus, GPT-4o, etc.) runs via your **Copilot subscription** — no API keys needed.

---

## Requirements

- VS Code 1.95+
- GitHub Copilot subscription (any tier)
- Python, Node, or any runtime for your tool scripts

## License

MIT

---

**Built by an engineer who needed autonomous AI agents but didn't want to pay for API keys.**
