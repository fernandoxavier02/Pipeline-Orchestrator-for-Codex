# Security Scanner Report — codex-plugin-builder

**Scanner role:** Adversarial Security Scanner (ZERO implementation context)
**Date:** 2026-05-19
**Files reviewed:** 28
**Scope:** KB docs + codex-plugin-builder skill + templates (documentation/config artifacts; not production runtime)

---

```yaml
SECURITY_FINDINGS:
  status: "FINDINGS_EXIST"
  files_reviewed: 28

  vulnerabilities:

    - id: "SEC-01"
      severity: "HIGH"
      file: "C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/hook-deny.cjs:46-54"
      category: "assumption-violation"
      description: |
        The catch block on JSON.parse failure explicitly calls `allow()` with an inline
        comment "Fail open on malformed input". Any attacker who can inject a non-JSON
        byte sequence into the hook stdin pipe (e.g. by corrupting the event serialization
        or exploiting a race in the pipe) causes the hook to ALLOW instead of DENY.
        This is the opposite of the stated policy in hooks-schema.md ("Fail closed for
        security checks: when in doubt, deny") and in the build-checklist.md item
        "Hooks fail closed for security checks". The template ships fail-open as the
        DEFAULT and buries the fail-closed alternative in a comment that most users
        will not read.
      attack_vector: |
        An attacker or a misbehaving plugin component sends a truncated, empty, or
        binary-prefixed stdin stream. The JSON.parse throws. The hook calls allow().
        The guard that was supposed to block `rm -rf` or unauthorized dispatch fires
        and immediately permits the action.
      recommendation: |
        Invert the default: call deny() in the catch block with a clear reason
        ("hook received unparseable event — defaulting to deny for safety").
        Move the fail-open variant into a clearly labeled separate template named
        hook-allow-on-error.cjs so users who genuinely want that behavior opt in
        consciously.

    - id: "SEC-02"
      severity: "HIGH"
      file: "C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/hooks.json:28-35"
      category: "assumption-violation"
      description: |
        The `PreToolUse` matcher for the edit-guard hook is the regex string
        `apply_patch|Bash`. In Codex, matchers are tool-name regexes. The string
        `apply_patch|Bash` will also match any tool whose name CONTAINS the substring
        `apply_patch` or `Bash` (e.g. `mcp__filesystem__apply_patch_extended`,
        hypothetical future tools). More critically, if the actual Codex tool names
        differ from these strings (e.g. the real write tool is `write_file` or
        `patch_apply`), the matcher silently no-ops — the hook is registered but
        NEVER fires. The template provides no guidance on how to verify actual tool
        names before shipping. The hooks-schema.md references `apply_patch|Bash` and
        `spawn_agent` as example matchers, but does not state these are verified
        against a live Codex session.
      attack_vector: |
        User copies template. Actual Codex write tool is named differently (e.g.
        `write_file`). The edit-guard hook registers successfully, JSON is valid,
        no error is surfaced, but every file write bypasses the guard silently. The
        user believes enforcement is active because the hook file exists.
      recommendation: |
        Add a prominent WARNING block above the matcher value in both the template and
        the hooks-schema.md document: "Verify these tool names match your Codex
        version before relying on them for security enforcement. Run `codex /tools`
        or inspect hook event logs to confirm exact names." Consider using anchored
        regexes (`^Bash$`) to prevent partial-match false-positives.

    - id: "SEC-03"
      severity: "HIGH"
      file: "C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/hooks.json:37-44"
      category: "assumption-violation"
      description: |
        The dispatch-guard matcher is the string `spawn_agent`. The hooks-schema.md
        documentation example uses `spawn_agent|Agent`. These are inconsistent. If
        Codex exposes the multi-agent toolset under a name like `Agent` or
        `agent_spawn` rather than (or in addition to) `spawn_agent`, the template
        matcher covers only one name while the documentation example suggests a second
        name exists. A user copying the template (not the docs example) ships a guard
        that misses half the tool surface. Given that the SKILL.md describes
        `spawn_agent` as a security-critical dispatch gate, a silent miss here is a
        security degradation equivalent to no guard at all.
      attack_vector: |
        If the `Agent` tool variant exists and is not matched, a workflow that intends
        to gate all agent spawning allows unvalidated dispatches through the `Agent`
        path while blocking the `spawn_agent` path, giving a false sense of coverage.
      recommendation: |
        Unify the template and the docs example to `spawn_agent|Agent` (or whatever
        the verified set is). Add a note that users must audit tool names for their
        Codex version. Cross-reference SEC-02 verification advice.

    - id: "SEC-04"
      severity: "HIGH"
      file: "C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/marketplace.json:9-12"
      category: "auth-bypass"
      description: |
        The template ships `"authentication": "ON_FIRST_USE"`. The canonical
        reference (plugin-build-guide.md line ~137, marketplace.md field table) lists
        `ON_INSTALL` as the value used in the reference example, while the template
        uses `ON_FIRST_USE`. `ON_FIRST_USE` defers authentication until the user
        actually invokes the plugin. For plugins that perform authenticated operations
        (write access, external API calls, secrets injection) there is a window
        between installation and first use where the plugin is installed but auth is
        incomplete. A user who copies this template for a plugin requiring auth at
        install time ships a weaker policy than intended. The discrepancy between
        template (`ON_FIRST_USE`) and docs reference example (`ON_INSTALL`) means
        users must know to make a deliberate choice — the template biases them toward
        the weaker option with no callout.
      attack_vector: |
        Plugin installed in a shared Codex workspace. Auth is `ON_FIRST_USE`. A
        second workspace member triggers the plugin before the installing user
        completes auth. Depending on plugin design, this could result in unauthenticated
        access to external resources the plugin gates behind auth.
      recommendation: |
        Change the template default to `ON_INSTALL` to match the docs canonical
        example, or add an explicit inline comment explaining the trade-off and
        instructing users to choose deliberately. The two values must never be
        presented as interchangeable defaults.

    - id: "SEC-05"
      severity: "MEDIUM"
      file: "C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/hook-deny.cjs:61-63"
      category: "data-exposure"
      description: |
        The deny reason string returned in `permissionDecisionReason` echoes the
        literal regex pattern and tool name: "rm -rf is blocked by plugin policy.
        Narrow the deletion target." This is benign in the template, but the template
        teaches users the pattern of constructing deny reasons that include the matched
        command fragment. If users extend this template by interpolating
        `event.tool_input.command` or environment details into the reason string, they
        create a path where internal command details, file paths, or secrets embedded
        in commands appear in user-visible deny messages. The hooks-schema.md warns
        "Avoid leaking secrets in stopReason, additionalContext, or stderr" but the
        template does not model safe reason construction (i.e., it does not demonstrate
        sanitizing the reason string).
      attack_vector: |
        A developer extends the deny reason to be helpful: "Blocked: `${command}`".
        The command contains an API key or a secret path injected by a previous tool.
        The deny reason surfaces in the Codex UI visible to all session participants.
      recommendation: |
        The deny reason template should demonstrate a static string or a safely
        constructed string that explicitly does NOT interpolate raw tool input.
        Add an inline comment: "Do not interpolate tool_input.command or environment
        values into this string — deny reasons are user-visible."

    - id: "SEC-06"
      severity: "MEDIUM"
      file: "C:/Users/win/.claude/skills/codex-plugin-builder/references/hooks-schema.md:184"
      category: "assumption-violation"
      description: |
        The hooks-schema.md states: "Repo-local hook paths should resolve through
        `$(git rev-parse --show-toplevel)/.codex/hooks/...` rather than fragile
        relative paths." This advice is buried at line 184 in a "Practical tips"
        section with no prominence indicator. Template hook-deny.cjs and hooks.json
        use `${PLUGIN_ROOT}` — which is correct for plugin-bundled hooks — but nowhere
        does the documentation warn that repo-local hooks using relative paths
        (outside a plugin) will silently resolve from `cwd`, which changes depending
        on where the user runs Codex. A repo-local hook that uses `./hooks/guard.cjs`
        will no-op when Codex is launched from a subdirectory.
      attack_vector: |
        Developer ships a repo-local hooks.json with `"command": "./hooks/guard.cjs"`.
        Running `codex` from `src/` resolves to `src/hooks/guard.cjs` — file not
        found. Node fails with non-zero exit. Codex treats the hook failure as a hook
        error (not a deny), and the guarded tool is allowed through. Enforcement
        silently disappears.
      recommendation: |
        Promote the git-rev-parse advice to a WARNING callout at the top of the
        hooks-schema.md section on "File location". Add a checklist item in
        build-checklist.md: "Repo-local hook commands use `$(git rev-parse
        --show-toplevel)` anchoring, not relative paths."

    - id: "SEC-07"
      severity: "MEDIUM"
      file: "C:/Users/win/.claude/skills/codex-plugin-builder/SKILL.md:97"
      category: "assumption-violation"
      description: |
        The SKILL.md states env var `${CLAUDE_PLUGIN_ROOT}` is "legacy compatibility
        only" and canonical is `${PLUGIN_ROOT}`. The hooks-schema.md (line 177) says
        "Plugin hooks receive both the canonical and legacy sets." However, no
        document specifies what happens when `${PLUGIN_ROOT}` is undefined — for
        example in non-plugin repo-local hooks or hooks invoked in a context where the
        plugin is not properly installed. If a user uses `${PLUGIN_ROOT}` in a hook
        command and the plugin is partially installed or the env var is not injected
        (e.g. a test harness, a CI environment), the variable expands to empty string
        and the node command becomes `node "/hooks/guard.cjs"` — an absolute path from
        filesystem root, silently resolving to a non-existent file. The hook then
        fails in a way that may be silent (allowed) rather than denied.
      attack_vector: |
        Plugin used in a CI pipeline where Codex does not inject `PLUGIN_ROOT`. Hook
        command expands to `node "/hooks/edit-guard.cjs"`. Node fails. Hook
        enforcement disappears in the CI context where it may be most critical.
      recommendation: |
        Document what happens when `${PLUGIN_ROOT}` is not set. Add a defensive
        check at the top of every hook template: verify the variable is defined
        before using it, and exit 2 (deny) if it is not. This turns an
        undefined-variable failure into a secure fail-closed path.

    - id: "SEC-08"
      severity: "MEDIUM"
      file: "C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/subagent.toml:29"
      category: "assumption-violation"
      description: |
        The subagent.toml template sets `sandbox_mode = "read-only"` which is
        appropriate for a code-reviewer. However, the `sandbox_mode` field is
        documented as optional and "inherits from parent when omitted". The SKILL.md
        workflow step 7 says "Add a custom subagent only when a distinct role with
        different sandbox/model/MCP set is genuinely needed" — implying that a user
        who builds a write-capable subagent will simply not set `sandbox_mode` and
        inherit the parent's value. If the parent session runs in
        `danger-full-access` mode (e.g. in a CI environment), all spawned subagents
        inherit that mode. The documentation does not warn that omitting
        `sandbox_mode` is a security decision, not a neutral default.
      attack_vector: |
        Developer builds a summarizer subagent, omits `sandbox_mode` because the
        template shows it as optional. Parent session is `danger-full-access`. The
        summarizer subagent can now write files and execute arbitrary commands despite
        the developer's intent for it to be read-only.
      recommendation: |
        Add a security note in references/subagents-toml.md and in the SKILL.md
        step 7: "When omitting `sandbox_mode`, the subagent inherits the parent's
        sandbox — including `danger-full-access`. For review or read-only roles,
        always set `sandbox_mode = \"read-only\"` explicitly."

    - id: "SEC-09"
      severity: "MEDIUM"
      file: "C:/Users/win/.claude/skills/codex-plugin-builder/SKILL.md:3"
      category: "assumption-violation"
      description: |
        The SKILL.md description is extremely long (~600 chars) and explicitly lists
        Portuguese variants ("criar plugin para codex", "skill para codex", etc.) and
        broad trigger phrases including "compare Claude Code vs Codex plugin
        architecture" and "validate a plugin.json/hooks.json/SKILL.md against the
        2026 Codex schema". The final phrase could match a user who is simply asking
        Claude Code to validate a Claude Code plugin (not a Codex plugin), triggering
        this skill and causing it to write files using Codex-specific layouts and
        paths (`.codex-plugin/`, `.agents/skills/`, etc.) into a Claude Code project.
        The skill body warns "Do not use this skill for Claude Code plugins" but the
        description itself is the router — if Codex (or Claude Code) selects the
        skill implicitly, the user never reads the body warning before files are
        written.
      attack_vector: |
        User working on a Claude Code plugin asks "validate my plugin.json against
        schema." The codex-plugin-builder skill triggers implicitly. It rewrites the
        user's `.claude-plugin/plugin.json` or creates `.codex-plugin/` directories
        in the wrong project, breaking the Claude Code plugin's structure with
        incorrect Codex-schema fields.
      recommendation: |
        Add explicit negative trigger language directly in the `description` frontmatter:
        "Do NOT use for Claude Code plugins (those live under `.claude-plugin/`)."
        The body warning is insufficient because it only loads after the skill is
        already selected.

    - id: "SEC-10"
      severity: "LOW"
      file: "C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/plugin.json:32-33"
      category: "data-exposure"
      description: |
        The plugin.json template sets `privacyPolicyURL` and `termsOfServiceURL` to
        `https://example.com/privacy` and `https://example.com/terms`. These are
        placeholder values that point to a real domain (example.com is IANA-reserved
        and returns a real page). If a user copies the template and submits to the
        marketplace without replacing these URLs, their plugin lists legitimate-looking
        but incorrect privacy policy and ToS links. Users who follow those links reach
        a generic example page rather than any actual policy. For a marketplace
        submission this is a trust violation. The template gives no visual warning
        that these fields require real URLs before submission.
      attack_vector: |
        Developer publishes plugin with example.com privacy URL. End users reviewing
        the privacy policy follow the link and see a generic IANA page, not an actual
        policy, undermining the privacy guarantee the marketplace link implies.
      recommendation: |
        Replace `https://example.com/privacy` with `"https://REPLACE-ME.example.com/privacy"`
        or an obviously-invalid placeholder like `"https://TODO"` so that JSON
        validation or a linter catches an unmodified template. Add a build-checklist
        item: "Replace all example.com URLs with real policy URLs before marketplace
        submission."

    - id: "SEC-11"
      severity: "LOW"
      file: "C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/hook-deny.cjs:20-26"
      category: "race-condition"
      description: |
        The `readStdin` function accumulates chunks in a closure variable `buf` with
        no size limit. For a well-behaved Codex host this is fine. However, if the
        hook is ever invoked in a context where stdin is not closed (pipe left open,
        test harness that does not close the write end), `readStdin` never resolves
        and the hook hangs indefinitely. The hook has no timeout of its own — it
        relies entirely on the Codex-level hook timeout (600 s default). A 600-second
        hung hook blocks the PreToolUse event for 10 minutes before the runtime
        kills it. Additionally, the template's stdin accumulation has no max-bytes
        guard; a pathological event payload could OOM the hook process.
      attack_vector: |
        A malformed test harness or a bug in the Codex pipe-closing logic causes the
        hook process to hang. All `PreToolUse` events for that session are blocked
        for up to 600 seconds. If the hook timeout behavior on hang is "allow"
        rather than "deny", the guard is ineffective during the hang window.
      recommendation: |
        Add a practical stdin timeout (e.g. 5 seconds using `setTimeout` + reject)
        in the hook template. Add a max-bytes guard (e.g. 1 MB) that rejects and
        exits 2 if exceeded. Document that the Codex hook timeout is the last line of
        defense, not the first.

  questions_nobody_asked:
    - "What is the actual exit-code behavior when a hook command is not found (the
      node path resolves to a missing file)? Is this treated as a deny (exit 2) or as
      an allow, or as an error that bypasses the hook entirely? The docs say 'other'
      exit codes are 'treated as failure; the hook fires its error path' — but what
      does that error path do for security enforcement?"
    - "If two PreToolUse hooks match the same tool (e.g. both edit-guard and a
      second user-added hook), the docs say 'any deny wins' — but what happens if one
      hook hangs and another immediately allows? Does the first-to-complete win, or
      does Codex wait for all hooks? A race here could allow an action that a slower
      deny hook intended to block."
    - "The marketplace.json `ON_FIRST_USE` vs `ON_INSTALL` distinction: which auth
      flows does each actually trigger in the Codex app vs the CLI? The documentation
      names these values without describing what the authentication flow looks like in
      practice, meaning a plugin author cannot reason about the attack surface of
      each option."
    - "The `developer_instructions` field in subagent.toml is a free-text string
      that becomes the subagent's system prompt. Is there any sanitization or
      length limit? A plugin that builds subagent TOMLs dynamically (e.g. from
      user input) could inject adversarial instructions into developer_instructions
      if the string is not validated before writing."
    - "The KB's hooks-schema.md says plugin hooks are 'default-enabled since 2026'
      and that managed hooks from requirements.toml cannot be disabled. What happens
      when a plugin is updated and a hook is REMOVED from hooks.json? Does the cached
      install still run the old hook until the cache refreshes? There is a window
      where the installed and the source hooks.json diverge."

  worst_case_scenario: |
    A developer uses codex-plugin-builder to scaffold a security-critical plugin
    with dispatch-guarding and edit-guarding hooks. They copy the templates as
    instructed. The hooks.json matchers use tool names that do not match the actual
    Codex tool names (SEC-02, SEC-03), so neither guard ever fires — the plugin
    appears to enforce security but enforces nothing. Additionally, the hook-deny.cjs
    fails open on any parse error (SEC-01), meaning even if the matcher were correct,
    a crafted malformed event bypasses the deny logic. The developer — seeing no
    errors and no denied events in testing — publishes the plugin to the marketplace
    with ON_FIRST_USE auth (SEC-04). Other users install it, believing the guards are
    active. Every write operation and every agent dispatch proceeds without any policy
    check, in a plugin explicitly sold as a governed pipeline orchestrator with
    security enforcement.
```
