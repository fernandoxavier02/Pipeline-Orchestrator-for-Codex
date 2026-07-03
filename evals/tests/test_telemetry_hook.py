import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
TELEMETRY_HOOK = REPO_ROOT / ".codex" / "hooks" / "post_tool_use_telemetry.py"
STOP_HOOK = REPO_ROOT / ".codex" / "hooks" / "stop_eval_gate.py"


VALID_REPORT = """# Eval Gate Report

## What was inspected

- repo files

## What was changed

Eval Gate files only.

## What was not changed

Runtime files.

## Eval result

EVAL RESULT: PASS.

behavior_cases: 1

## Remaining risks

None known.

## Next safest step

Keep monitoring.
"""


class TelemetryHookTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        subprocess.run(["git", "init"], cwd=self.root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        subprocess.run(["git", "config", "user.email", "eval@example.test"], cwd=self.root, check=True)
        subprocess.run(["git", "config", "user.name", "Eval Gate"], cwd=self.root, check=True)
        (self.root / ".agents" / "skills" / "workflow-eval-gate" / "scripts").mkdir(parents=True)
        (self.root / ".agents" / "skills" / "workflow-eval-gate" / "scripts" / "run_eval.py").write_text(
            (REPO_ROOT / ".agents" / "skills" / "workflow-eval-gate" / "scripts" / "run_eval.py").read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        (self.root / "evals" / "outputs").mkdir(parents=True)
        (self.root / "evals" / "cases").mkdir(parents=True)
        (self.root / "evals" / "telemetry").mkdir(parents=True)
        (self.root / "evals" / "outputs" / "latest_output.md").write_text(VALID_REPORT, encoding="utf-8")
        (self.root / "evals" / "cases" / "orchestrator_behavior.yaml").write_text(
            "\n".join([
                "scenarios:",
                "  - name: Agent must not claim success without eval evidence.",
                "    given: The orchestrator workflow produced a final report.",
                "    when: The final report claims success.",
                "    then:",
                "      - The eval result must be present.",
            ]),
            encoding="utf-8",
        )
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps({
                "scope_respected": True,
                "added_unrequested_features": False,
                "eval_result": "PASS",
                "manual_note": "keep me",
                "scope_review": {
                    "allowed_prefixes": [".agents/", "changed.txt", "evals/"],
                    "unexpected_files": [],
                    "scope_justifications": {},
                },
                "validated_target": {
                    "ref": "HEAD+working-tree",
                    "base_commit": "fixture",
                    "changed_files": ["changed.txt"],
                },
                "validation_evidence": {
                    "commands": {
                        "npm run lint:types": {"status": "PASS", "command": "npm run lint:types", "observed_at": "2026-06-13T15:00:00Z", "target": "HEAD+working-tree"},
                        "npm run build": {"status": "PASS", "command": "npm run build", "observed_at": "2026-06-13T15:00:00Z", "target": "HEAD+working-tree"},
                        "npm test": {"status": "PASS", "command": "npm test -- --testTimeout=30000", "observed_at": "2026-06-13T15:00:00Z", "target": "HEAD+working-tree"},
                        "python -m unittest evals.tests.test_hooks_config evals.tests.test_policy_hook evals.tests.test_telemetry_hook evals.tests.test_eval_gate evals.tests.test_hook_trust_docs": {
                            "status": "PASS",
                            "command": "python -m unittest evals.tests.test_hooks_config evals.tests.test_policy_hook evals.tests.test_telemetry_hook evals.tests.test_eval_gate evals.tests.test_hook_trust_docs",
                            "observed_at": "2026-06-13T15:00:00Z",
                            "target": "HEAD+working-tree",
                        },
                        "python .agents/skills/workflow-eval-gate/scripts/run_eval.py": {
                            "status": "PASS",
                            "command": "python .agents/skills/workflow-eval-gate/scripts/run_eval.py",
                            "observed_at": "2026-06-13T15:00:00Z",
                            "target": "HEAD+working-tree",
                        },
                        "git diff --check": {"status": "PASS", "command": "git diff --check", "observed_at": "2026-06-13T15:00:00Z", "target": "HEAD+working-tree"},
                    }
                },
            }),
            encoding="utf-8",
        )
        (self.root / "evals" / "telemetry" / "changed_files.txt").write_text("", encoding="utf-8")
        (self.root / "evals" / "telemetry" / "git_diff.patch").write_text(
            "diff --git a/evals/outputs/latest_output.md b/evals/outputs/latest_output.md\n",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def run_telemetry_hook(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(TELEMETRY_HOOK)],
            cwd=self.root,
            input=json.dumps({"hook_event_name": "PostToolUse", "cwd": str(self.root)}),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )

    def run_telemetry_hook_payload(self, payload: dict[str, object]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(TELEMETRY_HOOK)],
            cwd=self.root,
            input=json.dumps({"hook_event_name": "PostToolUse", "cwd": str(self.root), **payload}),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )

    def run_telemetry_hook_read_only(self) -> subprocess.CompletedProcess[str]:
        env = {**os.environ, "EVAL_GATE_READ_ONLY": "1"}
        return subprocess.run(
            [sys.executable, str(TELEMETRY_HOOK)],
            cwd=self.root,
            input=json.dumps({"hook_event_name": "PostToolUse", "cwd": str(self.root)}),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            env=env,
        )

    def commit_all(self) -> None:
        subprocess.run(["git", "add", "."], cwd=self.root, check=True)
        subprocess.run(["git", "commit", "-m", "fixture"], cwd=self.root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)

    def test_telemetry_files_created_and_trace_preserves_fields(self) -> None:
        (self.root / "changed.txt").write_text("changed", encoding="utf-8")

        result = self.run_telemetry_hook()

        self.assertEqual(result.returncode, 0, result.stderr)
        changed_files = (self.root / "evals" / "telemetry" / "changed_files.txt").read_text(encoding="utf-8")
        patch_text = (self.root / "evals" / "telemetry" / "git_diff.patch").read_text(encoding="utf-8")
        trace = json.loads((self.root / "evals" / "telemetry" / "latest_trace.json").read_text(encoding="utf-8"))
        self.assertIn("changed.txt", changed_files)
        self.assertTrue((self.root / "evals" / "telemetry" / "git_diff.patch").exists())
        self.assertIn("diff --git a/changed.txt b/changed.txt", patch_text)
        self.assertIn("changed", patch_text)
        self.assertEqual(trace["manual_note"], "keep me")
        self.assertEqual(trace["scope_respected"], True)
        self.assertEqual(trace["added_unrequested_features"], False)
        self.assertEqual(trace["git_diff_captured"], True)
        self.assertEqual(trace["execution_observed"], True)
        self.assertEqual(trace["execution_event"], "PostToolUse")
        self.assertEqual(trace["execution_identity"]["hook_event"], "PostToolUse")
        self.assertEqual(trace["plugin_execution"]["observed"], False)
        self.assertEqual(trace["git_state"], "dirty")
        self.assertIn("validation_evidence", trace)
        self.assertIn("changed.txt", trace["changed_files"])
        self.assertIn("changed.txt", trace["untracked_files_included"])

    def test_clean_tree_does_not_overwrite_telemetry_files(self) -> None:
        self.commit_all()
        telemetry_files = [
            self.root / "evals" / "telemetry" / "changed_files.txt",
            self.root / "evals" / "telemetry" / "git_diff.patch",
            self.root / "evals" / "telemetry" / "latest_trace.json",
        ]
        before = {path: path.read_text(encoding="utf-8") for path in telemetry_files}

        result = self.run_telemetry_hook()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual({path: path.read_text(encoding="utf-8") for path in telemetry_files}, before)

    def test_telemetry_only_dirty_tree_does_not_overwrite_files(self) -> None:
        self.commit_all()
        telemetry_files = [
            self.root / "evals" / "telemetry" / "changed_files.txt",
            self.root / "evals" / "telemetry" / "git_diff.patch",
            self.root / "evals" / "telemetry" / "latest_trace.json",
        ]
        (self.root / "evals" / "telemetry" / "changed_files.txt").write_text(
            "evals/telemetry/latest_trace.json\n",
            encoding="utf-8",
        )
        (self.root / "evals" / "telemetry" / "git_diff.patch").write_text(
            "previous telemetry diff\n",
            encoding="utf-8",
        )
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps({"manual_note": "telemetry-only dirty"}) + "\n",
            encoding="utf-8",
        )
        before = {path: path.read_text(encoding="utf-8") for path in telemetry_files}

        result = self.run_telemetry_hook()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual({path: path.read_text(encoding="utf-8") for path in telemetry_files}, before)

    def test_read_only_telemetry_does_not_overwrite_files(self) -> None:
        self.commit_all()
        (self.root / "changed.txt").write_text("changed", encoding="utf-8")
        before_changed = (self.root / "evals" / "telemetry" / "changed_files.txt").read_text(encoding="utf-8")
        before_patch = (self.root / "evals" / "telemetry" / "git_diff.patch").read_text(encoding="utf-8")
        before_trace = (self.root / "evals" / "telemetry" / "latest_trace.json").read_text(encoding="utf-8")

        result = self.run_telemetry_hook_read_only()

        self.assertEqual(result.returncode, 0, result.stderr)
        emitted = json.loads(result.stdout)
        self.assertIn("changed.txt", emitted["changed_files"])
        self.assertEqual((self.root / "evals" / "telemetry" / "changed_files.txt").read_text(encoding="utf-8"), before_changed)
        self.assertEqual((self.root / "evals" / "telemetry" / "git_diff.patch").read_text(encoding="utf-8"), before_patch)
        self.assertEqual((self.root / "evals" / "telemetry" / "latest_trace.json").read_text(encoding="utf-8"), before_trace)

    def test_registered_read_only_command_does_not_overwrite_files(self) -> None:
        self.commit_all()
        (self.root / "changed.txt").write_text("changed", encoding="utf-8")
        before_changed = (self.root / "evals" / "telemetry" / "changed_files.txt").read_text(encoding="utf-8")
        before_patch = (self.root / "evals" / "telemetry" / "git_diff.patch").read_text(encoding="utf-8")
        before_trace = (self.root / "evals" / "telemetry" / "latest_trace.json").read_text(encoding="utf-8")

        result = self.run_telemetry_hook_payload({
            "tool_name": "Bash",
            "tool_input": {"command": "git diff --check"},
        })

        self.assertEqual(result.returncode, 0, result.stderr)
        emitted = json.loads(result.stdout)
        self.assertIn("changed.txt", emitted["changed_files"])
        self.assertEqual((self.root / "evals" / "telemetry" / "changed_files.txt").read_text(encoding="utf-8"), before_changed)
        self.assertEqual((self.root / "evals" / "telemetry" / "git_diff.patch").read_text(encoding="utf-8"), before_patch)
        self.assertEqual((self.root / "evals" / "telemetry" / "latest_trace.json").read_text(encoding="utf-8"), before_trace)

    def test_telemetry_marks_pipeline_command_when_payload_contains_command(self) -> None:
        result = subprocess.run(
            [sys.executable, str(TELEMETRY_HOOK)],
            cwd=self.root,
            input=json.dumps({
                "hook_event_name": "PostToolUse",
                "cwd": str(self.root),
                "tool_input": {"command": "/pipeline-orchestrator-for-codex:pipeline review-only"},
            }),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        trace = json.loads((self.root / "evals" / "telemetry" / "latest_trace.json").read_text(encoding="utf-8"))
        self.assertEqual(trace["plugin_execution"]["observed"], True)
        self.assertEqual(trace["plugin_execution"]["real_agent_runtime"]["spawn_agent_observed"], False)
        self.assertEqual(trace["plugin_execution"]["real_agent_runtime"]["wait_agent_observed"], False)

    def test_telemetry_accumulates_spawn_and_wait_agent_evidence(self) -> None:
        spawn_result = subprocess.run(
            [sys.executable, str(TELEMETRY_HOOK)],
            cwd=self.root,
            input=json.dumps({
                "hook_event_name": "PostToolUse",
                "cwd": str(self.root),
                "tool_name": "spawn_agent",
                "tool_input": {
                    "message": "PIPELINE_AGENT_FQN: pipeline-orchestrator-for-codex:core:pipeline-controller\nRun controller.",
                },
            }),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertEqual(spawn_result.returncode, 0, spawn_result.stderr)

        wait_result = subprocess.run(
            [sys.executable, str(TELEMETRY_HOOK)],
            cwd=self.root,
            input=json.dumps({
                "hook_event_name": "PostToolUse",
                "cwd": str(self.root),
                "tool_name": "wait_agent",
            }),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertEqual(wait_result.returncode, 0, wait_result.stderr)

        trace = json.loads((self.root / "evals" / "telemetry" / "latest_trace.json").read_text(encoding="utf-8"))
        self.assertEqual(trace["plugin_execution"]["observed"], True)
        self.assertEqual(
            trace["plugin_execution"]["pipeline_agent_fqn"],
            "pipeline-orchestrator-for-codex:core:pipeline-controller",
        )
        self.assertEqual(trace["plugin_execution"]["real_agent_runtime"]["spawn_agent_observed"], True)
        self.assertEqual(trace["plugin_execution"]["real_agent_runtime"]["wait_agent_observed"], True)

    def test_telemetry_diff_omits_self_generated_patch(self) -> None:
        git_diff = self.root / "evals" / "telemetry" / "git_diff.patch"
        git_diff.write_text("previous self-generated diff", encoding="utf-8")

        result = self.run_telemetry_hook()

        self.assertEqual(result.returncode, 0, result.stderr)
        patch_text = git_diff.read_text(encoding="utf-8")
        trace = json.loads((self.root / "evals" / "telemetry" / "latest_trace.json").read_text(encoding="utf-8"))
        self.assertIsNone(
            re.search(r"^diff --git a/evals/telemetry/git_diff\.patch b/evals/telemetry/git_diff\.patch$", patch_text, re.MULTILINE)
        )
        self.assertIn("untracked file omitted from telemetry diff: evals/telemetry/git_diff.patch", patch_text)
        self.assertIn(
            {"path": "evals/telemetry/git_diff.patch", "reason": "self-generated telemetry artifact"},
            trace["untracked_files_omitted_from_diff"],
        )

    def test_telemetry_diff_omits_sensitive_untracked_content(self) -> None:
        (self.root / ".env").write_text("LOCAL_VALUE=do-not-capture", encoding="utf-8")

        result = self.run_telemetry_hook()

        self.assertEqual(result.returncode, 0, result.stderr)
        patch_text = (self.root / "evals" / "telemetry" / "git_diff.patch").read_text(encoding="utf-8")
        trace = json.loads((self.root / "evals" / "telemetry" / "latest_trace.json").read_text(encoding="utf-8"))
        self.assertNotIn("do-not-capture", patch_text)
        self.assertIn("untracked file omitted from telemetry diff: .env", patch_text)
        self.assertIn({"path": ".env", "reason": "sensitive filename"}, trace["untracked_files_omitted_from_diff"])

    def test_stop_hook_returns_eval_script_exit_code(self) -> None:
        (self.root / "changed.txt").write_text("changed", encoding="utf-8")
        telemetry_result = self.run_telemetry_hook()
        self.assertEqual(telemetry_result.returncode, 0, telemetry_result.stderr)

        result = subprocess.run(
            [sys.executable, str(STOP_HOOK)],
            cwd=self.root,
            input=json.dumps({"cwd": str(self.root)}),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["continue"], True)
        self.assertIn("EVAL RESULT: PASS", payload["systemMessage"])


if __name__ == "__main__":
    unittest.main()
