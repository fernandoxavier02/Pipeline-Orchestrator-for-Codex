import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


class HookTrustDocsTests(unittest.TestCase):
    def test_agents_md_documents_hook_trust_step(self) -> None:
        content = (REPO_ROOT / "AGENTS.md").read_text(encoding="utf-8")

        self.assertIn("/hooks", content)
        self.assertIn(".codex/hooks.json", content)
        self.assertIn("confiados/ativos", content)
        self.assertIn("telemetry como manual", content)

    def test_workflow_eval_gate_skill_documents_hook_trust_step(self) -> None:
        content = (REPO_ROOT / ".agents" / "skills" / "workflow-eval-gate" / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("/hooks", content)
        self.assertIn(".codex/hooks.json", content)
        self.assertIn("not proven", content)
        self.assertIn("telemetry manually", content)

    def test_eval_readme_documents_operational_contract(self) -> None:
        content = (REPO_ROOT / "evals" / "README.md").read_text(encoding="utf-8")

        self.assertIn("Local Eval Gate", content)
        self.assertIn(".codex/hooks.json", content)
        self.assertIn("/hooks", content)
        self.assertIn("run_eval.py", content)
        self.assertIn("not a new orchestration engine", content)

    def test_project_context_mentions_eval_gate_surfaces(self) -> None:
        content = (REPO_ROOT / "PROJECT_CONTEXT.md").read_text(encoding="utf-8")

        self.assertIn("EVAL GATE LOCAL", content)
        self.assertIn("evals/README.md", content)
        self.assertIn(".codex/hooks.json", content)
        self.assertIn(".agents/skills/workflow-eval-gate/scripts/run_eval.py", content)

    def test_kiro_context_mentions_eval_gate_boundary(self) -> None:
        tech = (REPO_ROOT / ".kiro" / "steering" / "tech.md").read_text(encoding="utf-8")
        structure = (REPO_ROOT / ".kiro" / "steering" / "structure.md").read_text(encoding="utf-8")
        product = (REPO_ROOT / ".kiro" / "steering" / "product.md").read_text(encoding="utf-8")
        constitution = (REPO_ROOT / ".kiro" / "CONSTITUTION.md").read_text(encoding="utf-8")

        self.assertIn("Eval Gate local", tech)
        self.assertIn("/hooks", tech)
        self.assertIn("evals/README.md", structure)
        self.assertIn("Eval Gate local", product)
        self.assertIn("Eval Gate local", constitution)

    def test_readmes_index_eval_gate_docs(self) -> None:
        root_readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
        docs_index = (REPO_ROOT / "docs" / "pipeline-orchestrator-codex" / "README.md").read_text(encoding="utf-8")

        self.assertIn("Local Eval Gate", root_readme)
        self.assertIn("evals/README.md", root_readme)
        self.assertIn("11-eval-gate-plan.md", docs_index)
        self.assertIn("../../evals/README.md", docs_index)


if __name__ == "__main__":
    unittest.main()
