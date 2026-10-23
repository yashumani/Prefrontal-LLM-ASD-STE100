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
    run([sys.executable, "-I", "-m", "pip", "wheel", "--no-index", "--no-deps", "--no-build-isolation",
         "--wheel-dir", wheels, source])
    packages = list(wheels.glob("prefrontal_context-*.whl"))
    if len(packages) != 1:
        raise RuntimeError("exactly one packaged wheel required")
    venv = root / "venv"
    run([sys.executable, "-I", "-m", "venv", venv])
    binary_dir = venv / ("Scripts" if os.name == "nt" else "bin")
    python = binary_dir / ("python.exe" if os.name == "nt" else "python")
    console = binary_dir / ("prefrontal-context.exe" if os.name == "nt" else "prefrontal-context")
    evaluate_console = binary_dir / ("prefrontal-evaluate.exe" if os.name == "nt" else "prefrontal-evaluate")
    quality_console = binary_dir / ("prefrontal-quality.exe" if os.name == "nt" else "prefrontal-quality")
    workspace_console = binary_dir / ("prefrontal-workspace.exe" if os.name == "nt" else "prefrontal-workspace")
    run([python, "-I", "-m", "pip", "install", "--no-index", "--no-deps", packages[0]])
    installed = run([python, "-I", "-c", "import pilot; print(pilot.__file__)"]).strip()
    if str(venv).casefold() not in installed.casefold():
        raise RuntimeError("smoke imported developer source instead of installed package")
    # Verify committed proposal/source bytes from the extracted archive too.
    # A developer checkout can retain CRLF bytes despite newly added LF pins.
    run([python, "-I", "-c",
         "import sys,unittest; sys.path.insert(0,sys.argv[1]); "
         "suite=unittest.defaultTestLoader.loadTestsFromName('pilot.test_composable_portability'); "
         "result=unittest.TextTestRunner(verbosity=2).run(suite); "
         "sys.exit(0 if result.wasSuccessful() else 1)", source])
    installed_handoff = run([python, "-I", "-c",
        "from pathlib import Path; import sys; p=Path(sys.prefix)/'share'/'prefrontal-context'; "
        "assert (p/'AGENTS.md').is_file() and (p/'LLM_HANDOFF.md').is_file(); "
        "assert (p/'pilot'/'COMPOSABLE.md').is_file(); "
        "assert (p/'pilot'/'CONTEXT_EVALUATION.md').is_file(); "
        "assert (p/'workspace'/'index.html').is_file(); "
        "assert (p/'workspace'/'guides'/'quickstart.html').is_file(); "
        "assert (p/'workspace'/'guides'/'developer.html').is_file(); "
        "assert (p/'workspace'/'guides'/'scaling.html').is_file(); "
        "assert (p/'pilot'/'COMPOSABLE_BENCHMARK.json').is_file(); print(p/'LLM_HANDOFF.md')"]).strip()
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
    evaluation = json.loads(run([evaluate_console, "--output-root", root / "evaluation"]))
    run([quality_console, "--help"])
    evaluation_path = evaluation["report_path"]
    quality_smoke = json.loads(run([python, "-I", "-c", """
import json, sys, threading, urllib.request
from pilot.context_evaluation import load_evaluation
from pilot.context_quality_ui import create_server
report = load_evaluation(sys.argv[1])
assert report['schema'] == 'prefrontal.context.evaluation.v1'
assert report['currentness']['status'] == 'current'
assert report['coverage']['executed'] > 0
assert report['acceptance'] == 'partial'
assert all(gate['status'] == 'passed' for gate in report['gates'])
native = next(check for check in report['checks'] if check['id'] == 'native')
assert {case['id']: case['observed']['value'] for case in native['cases']} == {
    'period': 4, 'channel': 3, 'product': 3, 'combined': 2, 'zero': 0}
assert report['model_comparison']['status'] == 'not_evaluated'
server = create_server(sys.argv[1], port=0)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    origin = 'http://127.0.0.1:%s' % server.server_port
    responses = {}
    for route in ('/', '/assets/quality.css', '/assets/quality.js', '/api/evaluation'):
        with urllib.request.urlopen(origin + route, timeout=10) as response:
            assert response.status == 200
            assert response.headers.get('Cache-Control', '').startswith('no-store')
            body = response.read()
            assert body
            responses[route] = len(body)
            if route == '/api/evaluation':
                payload = json.loads(body)
                assert payload['schema'] == report['schema']
                assert payload['currentness']['status'] == 'current'
    print(json.dumps({'status':'passed','routes':responses,
                      'executed':report['coverage']['executed'],
                      'model_comparison':'not_evaluated'}))
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=10)
""", evaluation_path]))
    # Exercise the installed file adapter with a captured synthetic term. Local
    # backup checksums are integrity evidence, never imported review authority.
    browser_backup = root / "browser-workspace.json"
    run([python, "-I", "-c", """
import hashlib, sys
from pathlib import Path
from pilot.context_pilot import canonical, digest
from pilot.composable_model import validate_record
original = 'Synthetic completed-order term for the installed adapter smoke.\\r\\n'
sha = hashlib.sha256(original.encode('utf-8')).hexdigest()
record = validate_record({'schema':'prefrontal.context.v1','id':'TERM_COMPLETED_ORDER','version':1,
  'kind':'term','layer':'ontology','name':'Completed order','aliases':[],
  'description':'Synthetic installed adapter fixture.','narrative':'This is not a production definition.',
  'owner':'Synthetic smoke','classification':'internal','valid_from':'2026-01-01T00:00:00Z','valid_until':None,
  'provenance':[{'path':'submissions/term.txt','sha256':sha}],'dependencies':[],
  'spec':{'definition':'An example order in a completed state.','related_terms':[]}})
state = {'schema':'prefrontal.workspace.v1','id':'installed-smoke','name':'Installed synthetic fixture',
  'mode':'user','revision':1,'records':[record],
  'submissions':[{'path':'submissions/term.txt','text':original,'sha256':sha,'format':'form'}],
  'reviews':[],'trace':[],'created_at':'2026-01-01T00:00:00Z','updated_at':'2026-01-01T00:00:00Z'}
body = {'contract':'prefrontal.workspace.backup.v1','workspace':state,'sha256':digest(state)}
Path(sys.argv[1]).write_bytes((canonical(body)+'\\n').encode('utf-8'))
""", browser_backup])
    inspected = json.loads(run([workspace_console, "--input", browser_backup, "--validate-only"]))
    staged = json.loads(run([workspace_console, "--input", browser_backup,
                             "--output-root", root / "browser-stage", "--workspace", "release-smoke"]))
    if (not inspected.get("ok") or not staged.get("ok")
            or staged["result"]["record_count"] != 1
            or staged["result"]["semantically_approved"]
            or staged["result"]["execution_authorized"]
            or staged["result"]["registry_modified"]):
        raise RuntimeError("installed browser adapter did not preserve the proposal boundary")
    report = {"contract": "prefrontal.release.smoke.v1", "status": "passed",
              "archive": str(archive), "archive_git_commit": archive_commit,
              "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
              "wheel": packages[0].name, "wheel_sha256": hashlib.sha256(packages[0].read_bytes()).hexdigest(),
              "installed_module": installed,
              "installed_handoff": installed_handoff,
              "isolated_python": True, "runtime_install_no_index": True, "runtime_dependencies": [],
              "outside_checkout": True, "native_value": demo["native"]["value"],
              "archive_proposal_provenance_and_draft_admission": True,
              "consumer_count": len(demo["consumers"]), "live_model_calls": demo["live_model_calls"],
              "cli_search_resolve_revalidate_export": True, "bundle_hash": resolved["bundle_hash"],
              "idiomatic_yaml_input_roundtrip": True, "yaml_record_hash": yaml_check,
              "context_evaluation_and_packaged_quality_ui": quality_smoke,
              "browser_workspace_proposal_bridge": {"status": "passed", "record_count": 1,
                  "approval_state": staged["result"]["approval_state"], "registry_modified": False},
              "elapsed_seconds": round(time.perf_counter() - started, 3)}
    (root / "smoke.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
