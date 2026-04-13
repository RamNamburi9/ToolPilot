// ToolPilot — Autonomous AI Agent Loops with External Tools
// Uses VS Code Language Model API (Copilot subscription) + any script-based tools
// No API keys needed. No build step. Pure JavaScript.

const vscode = require('vscode');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Defaults ────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
    tools: {
        type: 'script',
        command: 'python',
        script: './tools.py',
        listArgs: ['--list-tools'],
        timeout: 180000,
    },
    agent: {
        systemPrompt: 'You are an expert AI assistant. Use the available tools to thoroughly investigate and answer the query. Always provide structured, evidence-based responses.',
        maxRounds: 12,
        model: { vendor: 'copilot', family: '' },
        outputFormat: {
            type: 'object',
            required: [],
            description: 'Respond with a JSON object containing your analysis results.',
        },
    },
    trigger: {
        type: 'file',
        watchPattern: 'input.json',
        outputFile: 'output.json',
        debounceMs: 3000,
    },
};

// ── State ───────────────────────────────────────────────────────────────
let outputChannel;
let config = {};
let allTools = [];
let toolNameMap = {};
let agentRunning = false;
let debounceTimer = null;
let fileWatcher = null;
let cancellationSource = null;

// ── Logging ─────────────────────────────────────────────────────────────
function log(msg, level = 'normal') {
    const logLevel = config.logLevel || 'normal';
    const levels = { minimal: 0, normal: 1, verbose: 2 };
    if (levels[level] > levels[logLevel]) return;

    const ts = new Date().toISOString().substring(11, 19);
    const line = `[${ts}] ${msg}`;
    if (outputChannel) outputChannel.appendLine(line);

    // File log
    try {
        const ws = vscode.workspace.workspaceFolders;
        if (ws && config._logFile) {
            fs.appendFileSync(config._logFile, `${new Date().toISOString()} ${msg}\n`);
        }
    } catch (_) { /* ignore */ }
}

// ── Configuration ───────────────────────────────────────────────────────
function loadConfig(workspaceRoot) {
    const configSetting = vscode.workspace.getConfiguration('toolpilot').get('configFile', '.vscode/toolpilot.json');
    const configPath = path.join(workspaceRoot, configSetting);

    let userConfig = {};
    if (fs.existsSync(configPath)) {
        try {
            const raw = fs.readFileSync(configPath, 'utf8');
            userConfig = JSON.parse(raw);
            log(`Config loaded from ${configSetting}`);
        } catch (e) {
            log(`WARNING: Failed to parse ${configSetting}: ${e.message}`);
        }
    } else {
        log(`No config file at ${configSetting} — using defaults`);
    }

    // Deep merge with defaults
    config = {
        tools: { ...DEFAULT_CONFIG.tools, ...(userConfig.tools || {}) },
        agent: {
            ...DEFAULT_CONFIG.agent,
            ...(userConfig.agent || {}),
            model: { ...DEFAULT_CONFIG.agent.model, ...((userConfig.agent || {}).model || {}) },
            outputFormat: { ...DEFAULT_CONFIG.agent.outputFormat, ...((userConfig.agent || {}).outputFormat || {}) },
        },
        trigger: { ...DEFAULT_CONFIG.trigger, ...(userConfig.trigger || {}) },
        logLevel: userConfig.logLevel || vscode.workspace.getConfiguration('toolpilot').get('logLevel', 'normal'),
        _workspaceRoot: workspaceRoot,
        _logFile: path.join(workspaceRoot, userConfig.logFile || 'toolpilot.log'),
    };

    // Resolve relative script path
    if (config.tools.script && !path.isAbsolute(config.tools.script)) {
        config.tools._resolvedScript = path.join(workspaceRoot, config.tools.script);
    } else {
        config.tools._resolvedScript = config.tools.script;
    }

    return config;
}

// ── Tool Loading ────────────────────────────────────────────────────────
function loadTools() {
    const { command, _resolvedScript, listArgs, timeout } = config.tools;

    if (!_resolvedScript || !fs.existsSync(_resolvedScript)) {
        log(`Tool script not found: ${_resolvedScript}`);
        return;
    }

    try {
        const args = [_resolvedScript, ...listArgs];
        const raw = execFileSync(command, args, {
            cwd: config._workspaceRoot,
            timeout: timeout || 30000,
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
        });

        const defs = JSON.parse(raw);
        if (!Array.isArray(defs)) {
            log('ERROR: Tool script must return a JSON array');
            return;
        }

        allTools = defs.map(d => ({
            name: d.name,
            description: d.description || '',
            inputSchema: d.inputSchema || d.input_schema || { type: 'object', properties: {} },
        }));

        toolNameMap = {};
        for (const t of allTools) {
            toolNameMap[t.name] = t;
        }

        log(`Loaded ${allTools.length} tools from ${path.basename(config.tools.script)}`);
    } catch (e) {
        log(`ERROR loading tools: ${e.message}`);
    }
}

// ── Tool Execution ──────────────────────────────────────────────────────
function executeTool(name, args) {
    const { command, _resolvedScript, timeout } = config.tools;

    try {
        const argsStr = JSON.stringify(args);
        const execArgs = [_resolvedScript, '--tool', name, '--args', argsStr];

        const result = execFileSync(command, execArgs, {
            cwd: config._workspaceRoot,
            timeout: timeout || 180000,
            encoding: 'utf8',
            maxBuffer: 50 * 1024 * 1024,
        });

        // Truncate large results
        const maxLen = 40000;
        if (result.length > maxLen) {
            return result.substring(0, maxLen) + `\n...[truncated ${result.length - maxLen} chars]`;
        }
        return result;
    } catch (e) {
        return `ERROR: Tool '${name}' failed: ${e.message}`;
    }
}

// ── Agent Loop ──────────────────────────────────────────────────────────
async function runAgentLoop(input) {
    if (agentRunning) {
        log('Agent already running — skipping');
        return null;
    }
    agentRunning = true;
    cancellationSource = new vscode.CancellationTokenSource();

    const startTime = Date.now();
    const maxRounds = config.agent.maxRounds || 12;
    let toolCallCount = 0;
    const toolsUsed = new Set();

    try {
        // ── Select model ──
        const selector = { vendor: config.agent.model.vendor || 'copilot' };
        if (config.agent.model.family) {
            selector.family = config.agent.model.family;
        }

        const models = await vscode.lm.selectChatModels(selector);
        if (!models || models.length === 0) {
            log('ERROR: No Copilot models available. Is GitHub Copilot active?');
            return { error: 'No Copilot models available' };
        }

        // Pick best model (prefer claude-opus, then gpt-4o, then first available)
        let model = models[0];
        for (const m of models) {
            if (m.family && m.family.includes('claude-opus')) { model = m; break; }
            if (m.family && m.family.includes('gpt-4o') && !model.family?.includes('claude')) { model = m; }
        }

        log(`Using model: ${model.name || model.id} (family: ${model.family})`);

        // ── Build system prompt ──
        const inputStr = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
        const outputInstructions = config.agent.outputFormat.description || 'Respond with a JSON object.';
        const outputFields = config.agent.outputFormat.required?.length
            ? `Required fields: ${config.agent.outputFormat.required.join(', ')}`
            : '';

        const systemMsg = `${config.agent.systemPrompt}

INPUT:
${inputStr}

OUTPUT FORMAT:
${outputInstructions}
${outputFields}
When you have gathered enough information, respond with ONLY a valid JSON object (no markdown, no code fences).`;

        // ── Build tool definitions for LLM ──
        const toolDefs = allTools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
        }));

        // ── Agent loop ──
        const messages = [vscode.LanguageModelChatMessage.User(systemMsg)];

        for (let round = 1; round <= maxRounds; round++) {
            if (cancellationSource.token.isCancellationRequested) {
                log('Agent cancelled');
                return { error: 'Cancelled' };
            }

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            log(`Round ${round}/${maxRounds} (${elapsed}s elapsed)...`);

            let response;
            try {
                response = await model.sendRequest(messages, { tools: toolDefs }, cancellationSource.token);
            } catch (e) {
                // Handle rate limiting
                if (e instanceof vscode.LanguageModelError && e.code === 'rate_limit') {
                    log('Rate limited — waiting 30s...');
                    await new Promise(r => setTimeout(r, 30000));
                    try {
                        response = await model.sendRequest(messages, { tools: toolDefs }, cancellationSource.token);
                    } catch (e2) {
                        log(`ERROR after retry: ${e2.message}`);
                        return { error: `LLM error: ${e2.message}` };
                    }
                } else {
                    log(`ERROR: LLM request failed: ${e.message}`);
                    return { error: `LLM error: ${e.message}` };
                }
            }

            // ── Collect response ──
            let textContent = '';
            const toolCalls = [];

            for await (const part of response.stream) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    textContent += part.value;
                } else if (part instanceof vscode.LanguageModelToolCallPart) {
                    toolCalls.push(part);
                }
            }

            // ── No tool calls = final answer ──
            if (toolCalls.length === 0) {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                log(`LLM final answer (${textContent.length} chars)`);

                // Try to parse as JSON
                let result = tryParseJson(textContent);
                if (!result) {
                    result = { _rawResponse: textContent };
                }

                // Add metadata
                result._tools_used = [...toolsUsed];
                result._tool_calls = toolCallCount;
                result._model = model.family || model.name || 'unknown';
                result._elapsed_seconds = parseFloat(elapsed);
                result._timestamp = new Date().toISOString();
                result._rounds = round;

                return result;
            }

            // ── Execute tool calls ──
            const toolResults = [];
            for (const tc of toolCalls) {
                const toolName = tc.name;
                const toolArgs = tc.input || {};
                toolCallCount++;
                toolsUsed.add(toolName);

                const argsPreview = JSON.stringify(toolArgs).substring(0, 100);
                log(`  → Tool: ${toolName}(${argsPreview}${JSON.stringify(toolArgs).length > 100 ? '...' : ''})`, 'normal');

                const result = executeTool(toolName, toolArgs);
                const resultLen = (result || '').length;
                log(`  ← ${toolName}: ${resultLen} chars`, 'normal');

                toolResults.push({
                    callId: tc.callId,
                    result: result || '(empty)',
                });
            }

            // ── Feed results back to LLM ──
            messages.push(vscode.LanguageModelChatMessage.Assistant(toolCalls));

            for (const tr of toolResults) {
                messages.push(
                    vscode.LanguageModelChatMessage.User([
                        new vscode.LanguageModelToolResultPart(tr.callId, [
                            new vscode.LanguageModelTextPart(tr.result),
                        ]),
                    ])
                );
            }
        }

        // Max rounds reached
        log(`Max rounds (${maxRounds}) reached — returning partial result`);
        return {
            error: `Max rounds (${maxRounds}) reached without final answer`,
            _tools_used: [...toolsUsed],
            _tool_calls: toolCallCount,
            _model: model.family || model.name || 'unknown',
            _elapsed_seconds: parseFloat(((Date.now() - startTime) / 1000).toFixed(1)),
        };

    } catch (e) {
        log(`ERROR: Agent loop failed: ${e.message}`);
        return { error: e.message };
    } finally {
        agentRunning = false;
        cancellationSource = null;
    }
}

// ── JSON Extraction ─────────────────────────────────────────────────────
function tryParseJson(text) {
    if (!text) return null;

    // Try direct parse
    try { return JSON.parse(text.trim()); } catch (_) {}

    // Try extracting from markdown code fence
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
        try { return JSON.parse(fenceMatch[1].trim()); } catch (_) {}
    }

    // Try finding JSON object in text
    const braceStart = text.indexOf('{');
    const braceEnd = text.lastIndexOf('}');
    if (braceStart >= 0 && braceEnd > braceStart) {
        try { return JSON.parse(text.substring(braceStart, braceEnd + 1)); } catch (_) {}
    }

    return null;
}

// ── Trigger Handler ─────────────────────────────────────────────────────
async function handleTrigger(workspaceRoot) {
    const watchPath = path.join(workspaceRoot, config.trigger.watchPattern);
    const outputPath = path.join(workspaceRoot, config.trigger.outputFile);

    if (!fs.existsSync(watchPath)) {
        log(`Trigger file not found: ${config.trigger.watchPattern}`);
        return;
    }

    try {
        const raw = fs.readFileSync(watchPath, 'utf8');
        const input = JSON.parse(raw);

        // Ensure tools are loaded
        if (allTools.length === 0) {
            loadTools();
        }

        if (allTools.length === 0) {
            log('ERROR: No tools available — cannot run agent');
            fs.writeFileSync(outputPath, JSON.stringify({ error: 'No tools loaded' }, null, 2), 'utf8');
            return;
        }

        log(`═══ AGENT START ═══`);
        const result = await runAgentLoop(input);

        if (result) {
            // Remove stale output first
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }

            fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');

            const tools = result._tools_used || [];
            const elapsed = result._elapsed_seconds || 0;
            const calls = result._tool_calls || 0;
            log(`═══ AGENT DONE → ${calls} tool calls across ${tools.length} unique tools in ${elapsed}s ═══`);
            log(`Output: ${outputPath}`);
        }
    } catch (e) {
        log(`ERROR handling trigger: ${e.message}`);
    }
}

// ── Activation ──────────────────────────────────────────────────────────
async function activate(context) {
    outputChannel = vscode.window.createOutputChannel('ToolPilot');
    log('ToolPilot activating...');

    const ws = vscode.workspace.workspaceFolders;
    if (!ws || ws.length === 0) {
        log('No workspace folder open');
        return;
    }

    const workspaceRoot = ws[0].uri.fsPath;

    // Load config
    loadConfig(workspaceRoot);

    // Load tools
    loadTools();

    // ── File Watcher ──
    if (config.trigger.type === 'file' && config.trigger.watchPattern) {
        const pattern = new vscode.RelativePattern(workspaceRoot, config.trigger.watchPattern);
        fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        const triggerFn = () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => handleTrigger(workspaceRoot), config.trigger.debounceMs || 3000);
        };

        fileWatcher.onDidChange(triggerFn);
        fileWatcher.onDidCreate(triggerFn);

        context.subscriptions.push(fileWatcher);
        log(`Watching: ${config.trigger.watchPattern}`);
    }

    // ── Commands ──
    const runCmd = vscode.commands.registerCommand('toolpilot.run', async () => {
        const inputBox = await vscode.window.showInputBox({
            prompt: 'Enter the query or task for the agent',
            placeHolder: 'e.g., Analyze this codebase for security issues',
        });
        if (!inputBox) return;

        if (allTools.length === 0) loadTools();

        const result = await runAgentLoop(inputBox);
        if (result) {
            const outputPath = path.join(workspaceRoot, config.trigger.outputFile);
            fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
            const doc = await vscode.workspace.openTextDocument(outputPath);
            await vscode.window.showTextDocument(doc);
        }
    });

    const runWithInputCmd = vscode.commands.registerCommand('toolpilot.runWithInput', async () => {
        handleTrigger(workspaceRoot);
    });

    const showToolsCmd = vscode.commands.registerCommand('toolpilot.showTools', () => {
        if (allTools.length === 0) loadTools();
        if (allTools.length === 0) {
            vscode.window.showWarningMessage('ToolPilot: No tools loaded.');
            return;
        }
        const items = allTools.map(t => `${t.name} — ${t.description.substring(0, 80)}`);
        vscode.window.showQuickPick(items, { title: `ToolPilot: ${allTools.length} Tools Available` });
    });

    const stopCmd = vscode.commands.registerCommand('toolpilot.stop', () => {
        if (cancellationSource) {
            cancellationSource.cancel();
            log('Agent stop requested');
            vscode.window.showInformationMessage('ToolPilot: Agent stop requested.');
        } else {
            vscode.window.showInformationMessage('ToolPilot: No agent running.');
        }
    });

    context.subscriptions.push(runCmd, runWithInputCmd, showToolsCmd, stopCmd, outputChannel);

    log(`Output: ${config.trigger.outputFile}`);
    log('Ready — write trigger file or run "ToolPilot: Run Agent" command');
}

function deactivate() {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (cancellationSource) cancellationSource.cancel();
    if (fileWatcher) fileWatcher.dispose();
}

module.exports = { activate, deactivate };
