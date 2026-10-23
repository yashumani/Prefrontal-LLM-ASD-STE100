"""Launch Codex with a session-only read-only Prefrontal MCP connection.

No user/project configuration is written. Opt-in recorded runs retain original
messages and tool events; ordinary tests never call a model. Interactive mode
runs in the user's terminal and ends when that user exits Codex.
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from time import perf_counter

from .knowledge_mcp import MCPServer


ROOT = Path(__file__).resolve().parents[1]
TOOLS = {"prefrontal_get", "prefrontal_search"}
DISABLED_FEATURES = (
    "plugins", "apps", "memories", "shell_tool", "unified_exec", "sleep_tool", "multi_agent",
    "browser_use", "browser_use_external", "browser_use_full_cdp_access", "computer_use",
    "image_generation", "in_app_browser", "code_mode", "code_mode_host", "code_mode_only",
    "goals", "multi_agent_v2", "hooks", "remote_plugin",
)


def connection(path):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    required = {"database", "source_root", "principals", "principal", "workspace", "record_ids"}
    if not isinstance(value, dict) or set(value) != required:
        raise ValueError("connection requires exact database/source/principal/workspace/record scope")
    MCPServer(value["database"], value["source_root"], value["principals"],
              value["principal"], value["workspace"], value["record_ids"])
    return value


def scoped_command(config, executable=None, trace=None, model=None, reasoning_effort=None):
    executable = executable or shutil.which("codex")
    if not executable:
        raise ValueError("Codex CLI unavailable")
    arguments = ["-B", "-X", "utf8", "-m", "pilot.knowledge_mcp", "--database", config["database"],
                 "--source-root", config["source_root"], "--principals", config["principals"],
                 "--principal", config["principal"], "--workspace", config["workspace"]]
    for record_id in config["record_ids"]:
        arguments.extend(["--record-id", record_id])
    if trace:
        arguments.extend(["--trace", str(trace)])
    table = "{prefrontal = {command = " + json.dumps(sys.executable) + ", args = " + json.dumps(arguments)
    table += ", cwd = " + json.dumps(str(ROOT)) + "}}"
    command = [executable, "-c", "mcp_servers=" + table, "-c", 'web_search="disabled"', "-a", "never"]
    for feature in DISABLED_FEATURES:
        # --disable rejects removed feature names (sleep_tool on CLI 0.146.0).
        # Equivalent session overrides keep supported controls off without
        # requiring older/newer clients to recognize every historical name.
        command.extend(["-c", "features." + feature + "=false"])
    if model:
        command.extend(["-c", "model=" + json.dumps(model)])
    if reasoning_effort:
        command.extend(["-c", "model_reasoning_effort=" + json.dumps(reasoning_effort)])

    def catalog():
        result = subprocess.run(command + ["mcp", "list", "--json"], cwd=str(ROOT),
                                capture_output=True, text=True, encoding="utf-8", timeout=30)
        if result.returncode:
            raise ValueError("Codex rejected session-local configuration; no model call made")
        values = json.loads(result.stdout)
        if not isinstance(values, list) or any(not isinstance(item, dict) or "name" not in item for item in values):
            raise ValueError("unrecognized Codex MCP catalog; no model call made")
        return values

    # CLI tables merge with inherited tables; explicitly disable other servers.
    disabled = []
    for item in catalog():
        name = item["name"]
        if name != "prefrontal":
            if not isinstance(name, str) or not re.fullmatch(r"[a-zA-Z0-9_-]+", name):
                raise ValueError("inherited server name needs explicit configuration; no model call made")
            command.extend(["-c", "mcp_servers." + name + ".enabled=false"])
            disabled.append(name)
    enabled = [item["name"] for item in catalog() if item.get("enabled", True)]
    if enabled != ["prefrontal"]:
        raise ValueError("MCP isolation not established; no model call made")
    return command, {"enabled_servers": enabled, "disabled_inherited_servers": disabled,
                     "shared_configuration_modified": False}


def inspect_events(events):
    messages, calls, usage, completed = [], [], None, False
    for line in events.splitlines():
        event = json.loads(line)
        item = event.get("item", {})
        if item and item.get("type") not in {"agent_message", "reasoning", "error", "mcp_tool_call"}:
            raise ValueError("unexpected external tool in recorded run; original events retained")
        if item.get("type") == "mcp_tool_call":
            if item.get("server") != "prefrontal" or item.get("tool") not in TOOLS:
                raise ValueError("tool exceeds configured read-only scope; original events retained")
            if event.get("type") == "item.completed":
                calls.append(item)
        if event.get("type") == "item.completed" and item.get("type") == "agent_message":
            messages.append(item["text"])
        if event.get("type") in {"error", "turn.failed"}:
            raise ValueError("Codex turn failed; original events retained")
        if event.get("type") == "turn.completed":
            completed, usage = True, event.get("usage")
    if not completed or not messages or not calls or not isinstance(usage, dict):
        raise ValueError("completed answer, actual retrieval calls and usage are required")
    return messages[-1], calls, usage


def run_recorded(config, prompt, output, executable=None, model=None, reasoning_effort=None, timeout=90):
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt.encode("utf-8")) > 131072:
        raise ValueError("bounded nonempty prompt required")
    if not 1 <= timeout <= 90:
        raise ValueError("recorded timeout must be between 1 and 90 seconds")
    output = Path(output)
    if output.exists():
        raise ValueError("retain prior output; choose a new explicitly authorized recorded run")
    output.mkdir(parents=True)
    command, isolation = scoped_command(config, executable, output / "tool-trace.jsonl", model, reasoning_effort)
    command += ["exec", "--sandbox", "read-only", "--ephemeral", "--json", "-"]
    (output / "prompt.txt").write_bytes(prompt.encode("utf-8"))
    (output / "command.json").write_text(json.dumps({"command": command, "isolation": isolation}, indent=2)+"\n", encoding="utf-8")
    started = perf_counter()
    try:
        result = subprocess.run(command, cwd=str(ROOT), input=prompt, capture_output=True,
                                text=True, encoding="utf-8", timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        for name, value in [("events.jsonl", exc.stdout), ("stderr.txt", exc.stderr)]:
            (output / name).write_bytes(value.encode("utf-8") if isinstance(value, str) else value or b"")
        (output / "failure.json").write_text(json.dumps({"error": "timeout", "timeout_seconds": timeout})+"\n", encoding="utf-8")
        raise ValueError("recorded run timed out; partial events retained, no automatic retry") from None
    (output / "events.jsonl").write_bytes(result.stdout.encode("utf-8"))
    (output / "stderr.txt").write_bytes(result.stderr.encode("utf-8"))
    if result.returncode or len(result.stdout.encode("utf-8")) > 4194304:
        raise ValueError("Codex process failed or output exceeded bound; original events retained")
    text, calls, usage = inspect_events(result.stdout)
    (output / "answer.txt").write_bytes(text.encode("utf-8"))
    evidence = {"elapsed_ms": round((perf_counter()-started)*1000, 3), "prompt_bytes": len(prompt.encode("utf-8")),
                "usage": usage, "model": model or "inherited", "reasoning_effort": reasoning_effort or "inherited",
                "tool_calls": calls, "isolation": isolation, "shared_configuration_modified": False}
    (output / "evidence.json").write_text(json.dumps(evidence, indent=2)+"\n", encoding="utf-8")
    return text, evidence


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--connection", required=True, help="trusted local connection JSON")
    parser.add_argument("--codex", help="explicit Codex CLI executable")
    parser.add_argument("--prompt-file", help="opt-in bounded recorded exec; omit for interactive terminal mode")
    parser.add_argument("--output", help="new evidence directory, required with --prompt-file")
    parser.add_argument("--model")
    parser.add_argument("--reasoning-effort")
    args = parser.parse_args(argv)
    try:
        config = connection(args.connection)
        if args.prompt_file:
            if not args.output:
                parser.error("--output required for recorded mode")
            _, evidence = run_recorded(config, Path(args.prompt_file).read_text(encoding="utf-8"), args.output,
                                       args.codex, args.model, args.reasoning_effort)
            print(json.dumps({"completed": True, "tool_calls": len(evidence["tool_calls"]), "output": args.output}))
        else:
            command, _ = scoped_command(config, args.codex, model=args.model, reasoning_effort=args.reasoning_effort)
            raise SystemExit(subprocess.run(command + ["--sandbox", "read-only"], cwd=str(ROOT)).returncode)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
