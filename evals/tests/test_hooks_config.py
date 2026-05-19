import json
import subprocess
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
HOOKS_CONFIG = REPO_ROOT / ".codex" / "hooks.json"


class HooksConfigTests(unittest.TestCase):
    def load_commands(self) -> list[str]:
        config = json.loads(HOOKS_CONFIG.read_text(encoding="utf-8"))
        commands: list[str] = []
        for entries in config["hooks"].values():
            for entry in entries:
                for hook in entry["hooks"]:
                    commands.append(hook["command"])
        return commands

    def test_hook_commands_do_not_use_shell_substitution(self) -> None:
        for command in self.load_commands():
            self.assertNotIn("$(", command)
            self.assertNotIn("`", command)

    def test_hook_commands_execute_under_cmd_from_repo_root(self) -> None:
        command = "python .codex/hooks/pre_tool_use_policy.py"

        result = subprocess.run(
            command,
            cwd=REPO_ROOT,
            input=json.dumps({"tool_input": {"command": "git status --short"}}),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            shell=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), "")


if __name__ == "__main__":
    unittest.main()
