#!/usr/bin/env python3
"""
ToolPilot Example: Python Tool Script

This demonstrates the ToolPilot tool protocol. Any script that implements
two modes works:

  1. --list-tools    → print JSON array of tool definitions
  2. --tool <name> --args <json>  → execute tool, print result

Tools can be anything: API calls, database queries, file analysis,
shell commands, web scraping, MCP bridges — anything you can code.
"""

import json
import sys
import os
import subprocess
import re
from datetime import datetime


# ── Tool Definitions ─────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "search_files",
        "description": "Search for files matching a glob pattern in the workspace. Returns file paths.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Glob pattern to match (e.g., '**/*.py', 'src/**/*.ts')"
                },
                "directory": {
                    "type": "string",
                    "description": "Directory to search in (default: current directory)"
                }
            },
            "required": ["pattern"]
        }
    },
    {
        "name": "read_file",
        "description": "Read the contents of a file. Can read specific line ranges.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to the file to read"
                },
                "start_line": {
                    "type": "integer",
                    "description": "Start line number (1-based, optional)"
                },
                "end_line": {
                    "type": "integer",
                    "description": "End line number (1-based, optional)"
                }
            },
            "required": ["path"]
        }
    },
    {
        "name": "grep_search",
        "description": "Search for a text pattern across files. Returns matching lines with file paths and line numbers.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Regex pattern to search for"
                },
                "include": {
                    "type": "string",
                    "description": "File glob to include (e.g., '*.py', '*.ts')"
                },
                "directory": {
                    "type": "string",
                    "description": "Directory to search in (default: current directory)"
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of results (default: 50)"
                }
            },
            "required": ["pattern"]
        }
    },
    {
        "name": "run_command",
        "description": "Run a shell command and return its output. Use for tasks like listing processes, checking disk space, running tests, etc.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The command to run"
                },
                "cwd": {
                    "type": "string",
                    "description": "Working directory (default: current directory)"
                },
                "timeout": {
                    "type": "integer",
                    "description": "Timeout in seconds (default: 30)"
                }
            },
            "required": ["command"]
        }
    },
    {
        "name": "analyze_code",
        "description": "Analyze a code file and return structural information: functions, classes, imports, line count, complexity indicators.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path to the code file to analyze"
                }
            },
            "required": ["path"]
        }
    },
    {
        "name": "list_directory",
        "description": "List contents of a directory with file sizes and types.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Directory path to list"
                },
                "recursive": {
                    "type": "boolean",
                    "description": "List recursively (default: false)"
                },
                "max_depth": {
                    "type": "integer",
                    "description": "Max depth for recursive listing (default: 3)"
                }
            },
            "required": ["path"]
        }
    }
]


# ── Tool Implementations ────────────────────────────────────────────────

def tool_search_files(args):
    import glob
    pattern = args["pattern"]
    directory = args.get("directory", ".")
    matches = glob.glob(os.path.join(directory, pattern), recursive=True)
    matches = matches[:200]  # cap results
    return f"Found {len(matches)} files:\n" + "\n".join(matches)


def tool_read_file(args):
    filepath = args["path"]
    if not os.path.exists(filepath):
        return f"ERROR: File not found: {filepath}"

    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        lines = f.readlines()

    start = args.get("start_line", 1) - 1
    end = args.get("end_line", len(lines))
    start = max(0, start)
    end = min(len(lines), end)

    selected = lines[start:end]
    numbered = [f"{i+start+1:4d} | {line.rstrip()}" for i, line in enumerate(selected)]
    return f"File: {filepath} ({len(lines)} total lines, showing {start+1}-{end})\n" + "\n".join(numbered)


def tool_grep_search(args):
    pattern = args["pattern"]
    include = args.get("include", "*")
    directory = args.get("directory", ".")
    max_results = args.get("max_results", 50)

    results = []
    regex = re.compile(pattern, re.IGNORECASE)

    import glob
    files = glob.glob(os.path.join(directory, "**", include), recursive=True)

    for filepath in files:
        if not os.path.isfile(filepath):
            continue
        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                for i, line in enumerate(f, 1):
                    if regex.search(line):
                        results.append(f"{filepath}:{i}: {line.rstrip()}")
                        if len(results) >= max_results:
                            break
        except (OSError, UnicodeDecodeError):
            continue
        if len(results) >= max_results:
            break

    return f"Found {len(results)} matches:\n" + "\n".join(results)


def tool_run_command(args):
    command = args["command"]
    cwd = args.get("cwd", ".")
    timeout = args.get("timeout", 30)

    # Security: block dangerous commands
    dangerous = ["rm -rf /", "format ", "del /s /q", "mkfs", ":(){", ">("]
    for d in dangerous:
        if d in command.lower():
            return f"ERROR: Blocked potentially dangerous command: {command}"

    try:
        result = subprocess.run(
            command, shell=True, capture_output=True, text=True,
            cwd=cwd, timeout=timeout
        )
        output = result.stdout
        if result.stderr:
            output += f"\nSTDERR:\n{result.stderr}"
        if result.returncode != 0:
            output += f"\nExit code: {result.returncode}"
        return output[:20000]  # cap output
    except subprocess.TimeoutExpired:
        return f"ERROR: Command timed out after {timeout}s"
    except Exception as e:
        return f"ERROR: {e}"


def tool_analyze_code(args):
    filepath = args["path"]
    if not os.path.exists(filepath):
        return f"ERROR: File not found: {filepath}"

    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    lines = content.split("\n")
    ext = os.path.splitext(filepath)[1].lower()

    info = {
        "file": filepath,
        "lines": len(lines),
        "size_bytes": os.path.getsize(filepath),
        "extension": ext,
        "blank_lines": sum(1 for l in lines if not l.strip()),
    }

    # Language-specific analysis
    if ext in (".py",):
        info["functions"] = [l.strip() for l in lines if l.strip().startswith("def ")]
        info["classes"] = [l.strip() for l in lines if l.strip().startswith("class ")]
        info["imports"] = [l.strip() for l in lines if l.strip().startswith(("import ", "from "))]
    elif ext in (".js", ".ts", ".jsx", ".tsx"):
        info["functions"] = [l.strip() for l in lines if re.match(r'\s*(async\s+)?function\s+\w+|const\s+\w+\s*=\s*(async\s+)?\(', l)]
        info["classes"] = [l.strip() for l in lines if l.strip().startswith("class ")]
        info["imports"] = [l.strip() for l in lines if l.strip().startswith(("import ", "require(", "const ") ) and ("require(" in l or "import " in l)]
    elif ext in (".cs",):
        info["methods"] = len(re.findall(r'(public|private|protected|internal)\s+(static\s+)?(async\s+)?\w+\s+\w+\s*\(', content))
        info["classes"] = len(re.findall(r'\bclass\s+\w+', content))
        info["namespaces"] = re.findall(r'namespace\s+([\w.]+)', content)

    return json.dumps(info, indent=2)


def tool_list_directory(args):
    dirpath = args["path"]
    recursive = args.get("recursive", False)
    max_depth = args.get("max_depth", 3)

    if not os.path.isdir(dirpath):
        return f"ERROR: Not a directory: {dirpath}"

    entries = []
    if recursive:
        for root, dirs, files in os.walk(dirpath):
            depth = root[len(dirpath):].count(os.sep)
            if depth >= max_depth:
                dirs.clear()
                continue
            indent = "  " * depth
            entries.append(f"{indent}{os.path.basename(root)}/")
            for f in sorted(files)[:50]:
                fpath = os.path.join(root, f)
                size = os.path.getsize(fpath) if os.path.exists(fpath) else 0
                entries.append(f"{indent}  {f} ({size:,} bytes)")
            if len(entries) > 500:
                entries.append("...(truncated)")
                break
    else:
        for name in sorted(os.listdir(dirpath)):
            fpath = os.path.join(dirpath, name)
            if os.path.isdir(fpath):
                entries.append(f"  {name}/")
            else:
                size = os.path.getsize(fpath)
                entries.append(f"  {name} ({size:,} bytes)")

    return f"Directory: {dirpath}\n" + "\n".join(entries)


# ── Dispatch ─────────────────────────────────────────────────────────────

HANDLERS = {
    "search_files": tool_search_files,
    "read_file": tool_read_file,
    "grep_search": tool_grep_search,
    "run_command": tool_run_command,
    "analyze_code": tool_analyze_code,
    "list_directory": tool_list_directory,
}


def main():
    if "--list-tools" in sys.argv:
        print(json.dumps(TOOLS))
        return

    if "--tool" in sys.argv:
        idx = sys.argv.index("--tool")
        tool_name = sys.argv[idx + 1]

        args = {}
        if "--args" in sys.argv:
            args_idx = sys.argv.index("--args")
            args = json.loads(sys.argv[args_idx + 1])

        handler = HANDLERS.get(tool_name)
        if not handler:
            print(f"ERROR: Unknown tool: {tool_name}")
            sys.exit(1)

        result = handler(args)
        print(result)
        return

    print("Usage:")
    print("  python tools.py --list-tools")
    print("  python tools.py --tool <name> --args '<json>'")


if __name__ == "__main__":
    main()
