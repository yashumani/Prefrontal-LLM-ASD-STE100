"""Install a release archive into a fresh offline venv and exercise its CLI.

The wheel builder uses the calling Python's setuptools/wheel. The installed
runtime has no repository PYTHONPATH, user site packages or third-party deps.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    archive = Path(args.archive).resolve()
    root = Path(args.output).resolve()
    root.mkdir(parents=True, exist_ok=False)
    source = root / "source"
    source.mkdir()
    started = time.perf_counter()
    with zipfile.ZipFile(archive) as bundle:
        archive_commit = bundle.comment.decode("ascii", errors="replace")
        entries = bundle.infolist()
        if len(entries) > 10000 or sum(item.file_size for item in entries) > 100 * 1024 * 1024:
            raise ValueError("archive exceeds smoke-test limits")
        for item in entries:
            target = (source / item.filename).resolve()
            if target != source and source not in target.parents:
                raise ValueError("archive entry escapes source directory")
        bundle.extractall(source)
    env = {key: value for key, value in os.environ.items()
           if key not in {"PYTHONPATH", "PYTHONHOME"}}
    env["PYTHONNOUSERSITE"] = "1"
    logs = []

    def run(command, incoming=None):
        process = subprocess.run([str(part) for part in command], input=incoming,
                                 text=True, capture_output=True, cwd=root, env=env, timeout=120)
        logs.append({"command": [str(part) for part in command], "returncode": process.returncode,
                     "stdout": process.stdout, "stderr": process.stderr})
        (root / "commands.json").write_text(json.dumps(logs, indent=2) + "\n", encoding="utf-8")
        if process.returncode:
            raise RuntimeError("release smoke command failed; inspect commands.json")
        return process.stdout

    wheels = root / "wheels"
    run([sys.executable, "-I", "-m", "pip", "wheel", "--no-deps", "--no-build-isolation",
         "--wheel-dir", wheels, source])
    packages = list(wheels.glob("prefrontal_context-*.whl"))
    if len(packages) != 1:
        raise RuntimeError("exactly one packaged wheel required")
    venv = root / "venv"
    run([sys.executable, "-I", "-m", "venv", venv])
    binary_dir = venv / ("Scripts" if os.name == "nt" else "bin")
    python = binary_dir / ("python.exe" if os.name == "nt" else "python")
    console = binary_dir / ("prefrontal-context.exe" if os.name == "nt" else "prefrontal-context")
    run([python, "-I", "-m", "pip", "install", "--no-index", "--no-deps", packages[0]])
    installed = run([python, "-I", "-c", "import pilot; print(pilot.__file__)"]).strip()
    if str(venv).casefold() not in installed.casefold():
        raise RuntimeError("smoke imported developer source instead of installed package")
    installed_handoff = run([python, "-I", "-c",
        "from pathlib import Path; import sys; p=Path(sys.prefix)/'share'/'prefrontal-context'; "
        "assert (p/'AGENTS.md').is_file() and (p/'LLM_HANDOFF.md').is_file(); "
        "assert (p/'pilot'/'COMPOSABLE.md').is_file(); print(p/'LLM_HANDOFF.md')"]).strip()
    yaml_path = source / "examples" / "composable" / "records" / "M_GROSS_ADDS.yaml"
    json_path = yaml_path.with_suffix(".json")
    yaml_check = run([python, "-I", "-c",
        "from pathlib import Path; import sys; "
        "from pilot.composable_formats import parse_document,export_document; "
        "from pilot.composable_model import digest; "
        "raw=Path(sys.argv[1]).read_text(encoding='utf-8'); "
        "assert not raw.lstrip().startswith('{') and '\\n' in raw; "
        "a=parse_document(raw,'yaml'); "
        "b=parse_document(Path(sys.argv[2]).read_text(encoding='utf-8'),'json'); "
        "assert digest(a)==digest(b); "
        "assert digest(parse_document(export_document(a,'markdown'),'markdown'))==digest(a); "
        "print(digest(a))", yaml_path, json_path]).strip()
    demo = json.loads(run([python, "-I", "-m", "pilot.composable_demo", "--output-root", root / "demo"]))
    if demo["native"]["value"] != 2 or demo["live_model_calls"] != 0:
        raise RuntimeError("unexpected native result or model invocation")
    common = [console, "--database", demo["database"], "--source-root", demo["source_root"],
              "--principals", demo["principals"], "--principal", "agent"]

    def request(body):
        response = json.loads(run(common, json.dumps(body) + "\n"))
        if not response.get("ok"):
            raise RuntimeError("installed CLI rejected expected valid workflow")
        return response["result"]

    search = request({"operation": "context.search", "workspace": "composable-demo", "query": "gross adds"})
    if not any(item["id"] == "M_GROSS_ADDS" for item in search["results"]):
        raise RuntimeError("installed search did not return resolvable measure")
    resolved = request({"operation": "context.resolve", "workspace": "composable-demo", "measure": "M_GROSS_ADDS",
                        "selectors": ["CHANNEL_ONLINE", "PRODUCT_POSTPAID", "PERIOD_2026_09"]})
    current = request({"operation": "context.revalidate", "bundle": resolved})
    exported = request({"operation": "context.export", "workspace": "composable-demo",
                        "id": "M_GROSS_ADDS", "format": "markdown"})
    if not exported["document"] or not current:
        raise RuntimeError("missing installed validation/export output")
    report = {"contract": "prefrontal.release.smoke.v1", "status": "passed",
              "archive": str(archive), "archive_git_commit": archive_commit,
              "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
              "wheel": packages[0].name, "wheel_sha256": hashlib.sha256(packages[0].read_bytes()).hexdigest(),
              "installed_module": installed,
              "installed_handoff": installed_handoff,
              "isolated_python": True, "runtime_install_no_index": True, "runtime_dependencies": [],
              "outside_checkout": True, "native_value": demo["native"]["value"],
              "consumer_count": len(demo["consumers"]), "live_model_calls": demo["live_model_calls"],
              "cli_search_resolve_revalidate_export": True, "bundle_hash": resolved["bundle_hash"],
              "idiomatic_yaml_input_roundtrip": True, "yaml_record_hash": yaml_check,
              "elapsed_seconds": round(time.perf_counter() - started, 3)}
    (root / "smoke.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
