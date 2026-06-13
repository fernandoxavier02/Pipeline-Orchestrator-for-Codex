import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
RUNNER = REPO_ROOT / ".agents" / "skills" / "workflow-eval-gate" / "scripts" / "run_eval.py"


VALID_REPORT = """# Eval Gate Report

## What was inspected

- repo files

## What was changed

Eval Gate files only.

## What was not changed

Runtime files.

## Eval result

EVAL RESULT: PASS from `python .agents/skills/workflow-eval-gate/scripts/run_eval.py`.

behavior_cases: 1

## Remaining risks

None known.

## Next safest step

Keep monitoring.
"""


VALID_TELEMETRY = {
    "scope_respected": True,
    "added_unrequested_features": False,
    "execution_observed": True,
    "execution_event": "PostToolUse",
    "execution_identity": {"hook_event": "PostToolUse"},
    "plugin_execution": {"observed": False, "pipeline_agent_fqn": None},
    "git_state": "dirty",
    "eval_result": "PASS",
    "scope_review": {
        "allowed_prefixes": ["evals/"],
        "unexpected_files": [],
        "scope_justifications": {},
    },
    "validated_target": {
        "ref": "working-tree",
        "commit": "fixture",
        "changed_files": ["evals/outputs/latest_output.md"],
    },
    "validation_evidence": {
        "commands": {
            "npm run lint:types": {"status": "PASS", "command": "npm run lint:types", "observed_at": "2026-06-13T15:00:00Z", "target": "working-tree"},
            "npm run build": {"status": "PASS", "command": "npm run build", "observed_at": "2026-06-13T15:00:00Z", "target": "working-tree"},
            "npm test": {"status": "PASS", "command": "npm test -- --testTimeout=30000", "observed_at": "2026-06-13T15:00:00Z", "target": "working-tree"},
            "python -m unittest evals.tests.test_hooks_config evals.tests.test_policy_hook evals.tests.test_telemetry_hook evals.tests.test_eval_gate evals.tests.test_hook_trust_docs": {
                "status": "PASS",
                "command": "python -m unittest evals.tests.test_hooks_config evals.tests.test_policy_hook evals.tests.test_telemetry_hook evals.tests.test_eval_gate evals.tests.test_hook_trust_docs",
                "observed_at": "2026-06-13T15:00:00Z",
                "target": "working-tree",
            },
            "python .agents/skills/workflow-eval-gate/scripts/run_eval.py": {
                "status": "PASS",
                "command": "python .agents/skills/workflow-eval-gate/scripts/run_eval.py",
                "observed_at": "2026-06-13T15:00:00Z",
                "target": "working-tree",
            },
            "git diff --check": {"status": "PASS", "command": "git diff --check", "observed_at": "2026-06-13T15:00:00Z", "target": "working-tree"},
        }
    },
}


class EvalGateRunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.write_valid_fixture()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def run_eval(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(RUNNER), "--repo-root", str(self.root)],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )

    def write_valid_fixture(self) -> None:
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
            json.dumps(VALID_TELEMETRY),
            encoding="utf-8",
        )
        (self.root / "evals" / "telemetry" / "changed_files.txt").write_text(
            "evals/outputs/latest_output.md\n",
            encoding="utf-8",
        )
        (self.root / "evals" / "telemetry" / "git_diff.patch").write_text(
            "diff --git a/evals/outputs/latest_output.md b/evals/outputs/latest_output.md\n",
            encoding="utf-8",
        )

    def assert_fails_with(self, expected: str) -> None:
        result = self.run_eval()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("EVAL RESULT: FAIL", result.stdout)
        self.assertIn(expected, result.stdout)

    def test_missing_latest_output_fails(self) -> None:
        (self.root / "evals" / "outputs" / "latest_output.md").unlink()

        self.assert_fails_with("missing evals/outputs/latest_output.md")

    def test_missing_latest_trace_fails(self) -> None:
        (self.root / "evals" / "telemetry" / "latest_trace.json").unlink()

        self.assert_fails_with("missing evals/telemetry/latest_trace.json")

    def test_invalid_json_fails(self) -> None:
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text("{not-json", encoding="utf-8")

        self.assert_fails_with("invalid JSON")

    def test_missing_required_report_section_fails(self) -> None:
        incomplete_report = VALID_REPORT.replace("## What was not changed", "## Different section")
        (self.root / "evals" / "outputs" / "latest_output.md").write_text(incomplete_report, encoding="utf-8")

        self.assert_fails_with("missing final report section: What was not changed")

    def test_forbidden_changed_paths_fail(self) -> None:
        (self.root / "evals" / "telemetry" / "changed_files.txt").write_text(
            "\n".join([
                ".git/config",
                ".git",
                "node_modules/package/index.js",
                "build/output.js",
            ]),
            encoding="utf-8",
        )

        result = self.run_eval()
        self.assertNotEqual(result.returncode, 0)
        for path in [".git/config", ".git", "node_modules/package/index.js", "build/output.js"]:
            self.assertIn(f"forbidden changed path: {path}", result.stdout)

    def test_dist_changed_paths_require_build_evidence(self) -> None:
        telemetry = {
            **VALID_TELEMETRY,
            "validation_evidence": {
                "commands": {
                    **VALID_TELEMETRY["validation_evidence"]["commands"],
                    "npm run build": {"status": "FAIL"},
                }
            },
        }
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )
        (self.root / "evals" / "telemetry" / "changed_files.txt").write_text(
            "dist/src/index.js",
            encoding="utf-8",
        )

        result = self.run_eval()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("forbidden changed path without npm run build evidence: dist/src/index.js", result.stdout)

    def test_missing_git_diff_patch_fails(self) -> None:
        (self.root / "evals" / "telemetry" / "git_diff.patch").unlink()

        self.assert_fails_with("missing evals/telemetry/git_diff.patch")

    def test_missing_changed_files_fails(self) -> None:
        (self.root / "evals" / "telemetry" / "changed_files.txt").unlink()

        self.assert_fails_with("missing evals/telemetry/changed_files.txt")

    def test_empty_changed_files_fails_without_execution_observed(self) -> None:
        telemetry = {
            key: value
            for key, value in VALID_TELEMETRY.items()
            if key not in ("execution_observed", "execution_identity")
        }
        (self.root / "evals" / "telemetry" / "changed_files.txt").write_text("", encoding="utf-8")
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        result = self.run_eval()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("telemetry execution_observed must be true", result.stdout)
        self.assertIn("evals/telemetry/changed_files.txt must not be empty without execution_observed=true", result.stdout)

    def test_execution_observed_requires_execution_identity(self) -> None:
        telemetry = {key: value for key, value in VALID_TELEMETRY.items() if key != "execution_identity"}
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        self.assert_fails_with("telemetry execution_identity must be an object when execution_observed=true")

    def test_empty_changed_files_can_pass_for_clean_execution(self) -> None:
        telemetry = {**VALID_TELEMETRY, "git_state": "clean", "changed_files": []}
        (self.root / "evals" / "telemetry" / "changed_files.txt").write_text("", encoding="utf-8")
        (self.root / "evals" / "telemetry" / "git_diff.patch").write_text("", encoding="utf-8")
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        result = self.run_eval()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_missing_behavior_cases_fails(self) -> None:
        (self.root / "evals" / "cases" / "orchestrator_behavior.yaml").unlink()

        self.assert_fails_with("missing evals/cases/orchestrator_behavior.yaml")

    def test_malformed_behavior_cases_fail(self) -> None:
        (self.root / "evals" / "cases" / "orchestrator_behavior.yaml").write_text(
            "\n".join([
                "scenarios: [",
                "  - name: Agent must not claim success without eval evidence.",
                "    given: The orchestrator workflow produced a final report.",
                "    when: The final report claims success.",
                "    then:",
                "      - The eval result must be present.",
            ]),
            encoding="utf-8",
        )

        self.assert_fails_with("behavior cases root must be exactly: scenarios:")

    def test_report_must_mention_behavior_case_count(self) -> None:
        report = VALID_REPORT.replace("behavior_cases: 1\n", "")
        (self.root / "evals" / "outputs" / "latest_output.md").write_text(report, encoding="utf-8")

        self.assert_fails_with("final report must mention behavior_cases: 1")

    def test_self_referential_git_diff_patch_fails(self) -> None:
        (self.root / "evals" / "telemetry" / "git_diff.patch").write_text(
            "diff --git a/evals/telemetry/git_diff.patch b/evals/telemetry/git_diff.patch\n",
            encoding="utf-8",
        )

        self.assert_fails_with("evals/telemetry/git_diff.patch must not include itself")

    def test_scope_respected_false_fails(self) -> None:
        telemetry = {**VALID_TELEMETRY, "scope_respected": False}
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        self.assert_fails_with("telemetry scope_respected must be true")

    def test_added_unrequested_features_true_fails(self) -> None:
        telemetry = {**VALID_TELEMETRY, "added_unrequested_features": True}
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        self.assert_fails_with("telemetry added_unrequested_features must not be true")

    def test_missing_scope_review_fails(self) -> None:
        telemetry = {key: value for key, value in VALID_TELEMETRY.items() if key != "scope_review"}
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        self.assert_fails_with("missing telemetry scope_review")

    def test_unexpected_changed_file_requires_justification(self) -> None:
        telemetry = {
            **VALID_TELEMETRY,
            "scope_review": {
                "allowed_prefixes": ["evals/"],
                "unexpected_files": ["README.md"],
                "scope_justifications": {},
            },
        }
        (self.root / "evals" / "telemetry" / "changed_files.txt").write_text(
            "evals/outputs/latest_output.md\nREADME.md\n",
            encoding="utf-8",
        )
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        self.assert_fails_with("missing scope justification for unexpected file: README.md")

    def test_unexpected_changed_files_must_match_changed_files(self) -> None:
        telemetry = {
            **VALID_TELEMETRY,
            "scope_review": {
                "allowed_prefixes": ["evals/"],
                "unexpected_files": [],
                "scope_justifications": {},
            },
        }
        (self.root / "evals" / "telemetry" / "changed_files.txt").write_text(
            "evals/outputs/latest_output.md\nREADME.md\n",
            encoding="utf-8",
        )
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        self.assert_fails_with("telemetry scope_review.unexpected_files must match changed_files outside allowed_prefixes")

    def test_missing_validation_evidence_fails(self) -> None:
        telemetry = {key: value for key, value in VALID_TELEMETRY.items() if key != "validation_evidence"}
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        self.assert_fails_with("missing telemetry validation_evidence")

    def test_validation_command_requires_observed_at(self) -> None:
        telemetry = json.loads(json.dumps(VALID_TELEMETRY))
        del telemetry["validation_evidence"]["commands"]["npm run build"]["observed_at"]
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        self.assert_fails_with("validation command missing observed_at: npm run build")

    def test_validation_command_requires_command_text(self) -> None:
        telemetry = json.loads(json.dumps(VALID_TELEMETRY))
        del telemetry["validation_evidence"]["commands"]["npm run build"]["command"]
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        self.assert_fails_with("validation command missing command text: npm run build")

    def test_dirty_validation_requires_validated_target(self) -> None:
        telemetry = {key: value for key, value in VALID_TELEMETRY.items() if key != "validated_target"}
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        self.assert_fails_with("telemetry validated_target is required for dirty validation evidence")

    def test_validation_command_target_must_match_validated_target(self) -> None:
        telemetry = json.loads(json.dumps(VALID_TELEMETRY))
        telemetry["validation_evidence"]["commands"]["npm run build"]["target"] = "old-working-tree"
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        self.assert_fails_with("validation command target does not match validated_target.ref: npm run build")

    def test_report_claimed_paths_must_have_diff_or_validated_target_evidence(self) -> None:
        report = VALID_REPORT.replace(
            "Eval Gate files only.",
            "Changed `src/cli/pipeline-cli.ts`, `dist/src/cli/pipeline-cli.js`, and `tests/unit/cli/pipeline-cli.test.ts`.",
        )
        (self.root / "evals" / "outputs" / "latest_output.md").write_text(report, encoding="utf-8")
        (self.root / "evals" / "telemetry" / "changed_files.txt").write_text(
            "evals/telemetry/latest_trace.json\n",
            encoding="utf-8",
        )
        telemetry = {
            **VALID_TELEMETRY,
            "changed_files": ["evals/telemetry/latest_trace.json"],
            "validated_target": {
                "ref": "working-tree",
                "commit": "fixture",
                "changed_files": ["evals/telemetry/latest_trace.json"],
            },
        }
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        self.assert_fails_with("final report references path without telemetry or validated target evidence: src/cli/pipeline-cli.ts")

    def test_report_behavior_claims_must_have_matching_evidence(self) -> None:
        report = VALID_REPORT.replace(
            "Eval Gate files only.",
            "Added optional sentinel HMAC verification.",
        )
        (self.root / "evals" / "outputs" / "latest_output.md").write_text(report, encoding="utf-8")

        self.assert_fails_with("final report claims HMAC change without matching telemetry evidence")

    def test_npm_test_timeout_can_pass_with_focused_evidence(self) -> None:
        telemetry = json.loads(json.dumps(VALID_TELEMETRY))
        telemetry["validation_evidence"]["commands"]["npm test"] = {
            "status": "PASS_FOCUSED_AFTER_TIMEOUT",
            "command": "npm test -- --testTimeout=30000",
            "observed_at": "2026-06-13T15:00:00Z",
            "target": "working-tree",
            "focused_evidence": "Full Vitest timed out in Windows IPC; failing files passed in focused reruns.",
        }
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        result = self.run_eval()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_npm_test_unrelated_failure_can_pass_with_focused_evidence(self) -> None:
        telemetry = json.loads(json.dumps(VALID_TELEMETRY))
        telemetry["validation_evidence"]["commands"]["npm test"] = {
            "status": "PASS_FOCUSED_AFTER_UNRELATED_FAILURE",
            "command": "npm test -- --testTimeout=30000",
            "observed_at": "2026-06-13T15:00:00Z",
            "target": "working-tree",
            "focused_evidence": "Full Vitest failed on pre-existing untracked skills; bugfix-focused Vitest and Python suites passed.",
        }
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        result = self.run_eval()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_npm_test_timeout_requires_focused_evidence(self) -> None:
        telemetry = json.loads(json.dumps(VALID_TELEMETRY))
        telemetry["validation_evidence"]["commands"]["npm test"] = {
            "status": "PASS_FOCUSED_AFTER_UNRELATED_FAILURE",
        }
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        self.assert_fails_with("validation command needs focused evidence for npm test fallback: npm test")

    def test_success_claim_without_eval_evidence_fails(self) -> None:
        report = VALID_REPORT.replace(
            "EVAL RESULT: PASS from `python .agents/skills/workflow-eval-gate/scripts/run_eval.py`.",
            "Success.",
        )
        (self.root / "evals" / "outputs" / "latest_output.md").write_text(report, encoding="utf-8")

        self.assert_fails_with("final report claims success without eval evidence")

    def test_operational_plugin_success_requires_spawn_and_wait_evidence(self) -> None:
        telemetry = {
            **VALID_TELEMETRY,
            "plugin_execution": {
                "observed": True,
                "status": "success",
                "pipeline_agent_fqn": "pipeline-orchestrator-for-codex:core:pipeline-controller",
                "real_agent_runtime": {
                    "spawn_agent_observed": True,
                    "wait_agent_observed": False,
                },
            },
        }
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        self.assert_fails_with("operational plugin success requires wait_agent evidence")

    def test_operational_plugin_success_requires_pipeline_agent_fqn(self) -> None:
        telemetry = {
            **VALID_TELEMETRY,
            "plugin_execution": {
                "observed": True,
                "status": "success",
                "pipeline_agent_fqn": None,
                "real_agent_runtime": {
                    "spawn_agent_observed": True,
                    "wait_agent_observed": True,
                },
            },
        }
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        self.assert_fails_with("operational plugin success requires pipeline_agent_fqn evidence")

    def test_operational_plugin_success_requires_namespaced_pipeline_agent_fqn(self) -> None:
        telemetry = {
            **VALID_TELEMETRY,
            "plugin_execution": {
                "observed": True,
                "status": "success",
                "pipeline_agent_fqn": "other-plugin:core:pipeline-controller",
                "real_agent_runtime": {
                    "spawn_agent_observed": True,
                    "wait_agent_observed": True,
                },
            },
        }
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        self.assert_fails_with("operational plugin success requires pipeline-orchestrator-for-codex agent FQN evidence")

    def test_operational_plugin_success_passes_with_spawn_wait_and_fqn(self) -> None:
        telemetry = {
            **VALID_TELEMETRY,
            "plugin_execution": {
                "observed": True,
                "status": "success",
                "pipeline_agent_fqn": "pipeline-orchestrator-for-codex:core:pipeline-controller",
                "real_agent_runtime": {
                    "spawn_agent_observed": True,
                    "wait_agent_observed": True,
                },
            },
        }
        (self.root / "evals" / "telemetry" / "latest_trace.json").write_text(
            json.dumps(telemetry),
            encoding="utf-8",
        )

        result = self.run_eval()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_future_eval_command_mention_is_not_eval_evidence(self) -> None:
        report = VALID_REPORT.replace(
            "EVAL RESULT: PASS from `python .agents/skills/workflow-eval-gate/scripts/run_eval.py`.",
            "Not run yet.",
        ).replace(
            "Eval Gate files only.",
            "Success.",
        ).replace(
            "Keep monitoring.",
            "Run `python .agents/skills/workflow-eval-gate/scripts/run_eval.py` next.",
        )
        (self.root / "evals" / "outputs" / "latest_output.md").write_text(report, encoding="utf-8")

        self.assert_fails_with("final report claims success without eval evidence")

    def test_valid_report_and_valid_telemetry_pass(self) -> None:
        result = self.run_eval()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("EVAL RESULT: PASS", result.stdout)


if __name__ == "__main__":
    unittest.main()
