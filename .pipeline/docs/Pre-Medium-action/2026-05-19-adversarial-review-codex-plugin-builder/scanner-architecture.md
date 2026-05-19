---
review_type: adversarial-architecture
reviewer: adversarial-architecture-critic
date: 2026-05-19
files_reviewed: 15
status: FINDINGS_EXIST
---

# Architecture Review — codex-plugin-builder KB + Skill

```
ARCHITECTURE_FINDINGS:
  status: FINDINGS_EXIST
  files_reviewed: 15
  dependency_summary:
    total_import_relationships: 12
    circular_dependencies: none
    highest_coupling: "plugin-build-guide.md (Ca=4: pointed at by INDEX.md + 4 Drift-Notes footers; Ce=0)"
  violations:
    - id: ARCH-1
      principle: SSOT
      severity: HIGH
      file: "references/openai-codex-kb/skills.md:107 | plugins.md:112 | agents-and-subagents.md:124 | rules-hooks-agents-md.md:118"
      description: >
        The "Drift Notes" section appended to four per-topic files is a structural
        anti-pattern disguised as a documentation strategy. It creates two authoritative
        bodies for the same facts in the same repository. A consumer grepping for
        "standalone skills" will land on skills.md body (wrong path: `skills/`) before
        reaching the correction at the bottom or the guide. The correction is spatially
        separated from the claim it corrects, requiring the reader to hold both in memory
        and reconcile manually. Each refresh cycle that updates the guide but not the
        per-topic body widens the delta silently — there is no enforcement mechanism.
      evidence: >
        skills.md line 107 says: "See plugin-build-guide.md for the schema-accurate
        consolidated version." The pre-correction body above that line still uses implicit
        paths and fields that contradict the guide. An agent or developer who stops reading
        at line 70 ('skills/**/*.md' in globs) gets the wrong discovery path without
        touching the Drift Notes.

    - id: ARCH-2
      principle: DRY
      severity: HIGH
      file: "C:/Users/win/.claude/skills/codex-plugin-builder/SKILL.md:1 | references/openai-codex-kb/plugin-build-guide.md:1"
      description: >
        The skill's seven reference files (manifest-schema, skill-format, hooks-schema,
        subagents-toml, marketplace, build-checklist, sources) and the KB's
        plugin-build-guide.md are parallel representations of the same schema corpus.
        They are not copies — they are independently maintained documents that must stay
        synchronized with each other AND with upstream OpenAI docs. That is three-way
        synchronization without a mechanical link. When Codex changes a hook output shape
        (as happened with the deny contract), the update must land in hooks-schema.md AND
        plugin-build-guide.md's Hooks section AND rules-hooks-agents-md.md's Drift Notes
        — three separate edits with no enforcement of completeness.
      evidence: >
        hooks-schema.md line 120: "Legacy form { 'decision': 'block', 'reason': '...' }
        still works." plugin-build-guide.md line 269 says the same. These are identical
        facts stated in two files that will diverge when the next legacy removal happens.

    - id: ARCH-3
      principle: SRP
      severity: MEDIUM
      file: "D:/Pipeline Orchestrator For Codex/references/openai-codex-kb/INDEX.md:63"
      description: >
        INDEX.md carries two distinct responsibilities: (a) routing agents to the right
        article, and (b) declaring plugin-build-guide.md as the SSOT correction layer
        over the per-topic pages. Responsibility (b) is an architectural governance
        decision that should live in the guide itself or in a dedicated GOVERNANCE.md —
        not embedded in the routing index. When the correction hierarchy changes, the
        index becomes stale separately from the guide.
      evidence: >
        INDEX.md line 63: "Plugin Build Guide (consolidated, 2026-05-19): End-to-end
        schema-accurate guide ... SSOT for new plugin/skill construction; carries drift
        corrections versus the per-topic articles below." This is a governance claim,
        not a routing entry.

    - id: ARCH-4
      principle: DIP
      severity: MEDIUM
      file: "C:/Users/win/.claude/skills/codex-plugin-builder/SKILL.md:14"
      description: >
        The skill's disambiguation clause ("for Claude Code plugins use plugin-dev:plugin-structure
        instead") is a hard-coded reference to a specific Claude Code skill name. This is a
        direct name-to-name dependency rather than a dependency on a stable concept
        ("Claude Code plugin authoring"). If plugin-dev:plugin-structure is renamed,
        split, or deprecated, the skill's routing instruction silently becomes wrong. The
        same dependency appears in the cross-runtime gotchas table.
      evidence: >
        SKILL.md line 14: "Do not use this skill for Claude Code plugins (those live under
        .claude-plugin/ and have a different schema — use plugin-dev instead)." Also
        SKILL.md line 154: "It does not validate Claude Code plugins — use
        plugin-dev:plugin-validator for that." Two different target names are mentioned
        (plugin-dev, plugin-dev:plugin-validator) which are inconsistent with each other.

    - id: ARCH-5
      principle: COUPLING
      severity: MEDIUM
      file: "D:/Pipeline Orchestrator For Codex/CLAUDE.md:13 | AGENTS.md (referenced but not in file list)"
      description: >
        CLAUDE.md is explicitly labeled a "Claude-Code-specific shim" pointing at AGENTS.md
        as the real authority. This creates an order-of-authority split that is runtime-
        dependent: Claude Code reads CLAUDE.md first; Codex reads AGENTS.md first.
        The same repository now has two authority entry points that must remain mutually
        consistent. Any instruction added to CLAUDE.md that Codex-facing agents should also
        follow will be invisible to Codex unless duplicated in AGENTS.md. The shim pattern
        pushes the consistency burden to the human maintainer with no structural guard.
      evidence: >
        CLAUDE.md line 13: "This file is a Claude-Code-specific shim. The real authority
        for working in this repo lives in: 1. AGENTS.md ..." The shim itself contains
        non-trivial content (architecture overview, working rules, stack, common commands)
        that does not exist in the authority chain it points to — making it partially a
        shim and partially its own authority document.

  design_risks:
    - id: RISK-1
      category: drift
      severity: HIGH
      file: "references/openai-codex-kb/skills.md:107 | plugins.md:112 | agents-and-subagents.md:124 | rules-hooks-agents-md.md:118"
      description: >
        The Drift Notes pattern creates compounding append debt. After N refresh cycles,
        each per-topic file has N Drift Notes blocks at the bottom, each overriding
        different sections of the body above. A reader must parse the entire file in
        reverse-override order to determine the current authoritative state. There is
        no mechanism to retire stale body content — it persists indefinitely. After
        3-4 cycles, the per-topic files become functionally unreadable without the guide.
      impact: >
        Agent retrieval degrades: the correct path lives at line N+delta while the wrong
        path is at line 30. Grepping for a specific field yields the pre-correction value
        first. The correction signal weakens as Drift Notes pile up because they become
        "more noise at the bottom" rather than authoritative corrections.

    - id: RISK-2
      category: coupling
      severity: HIGH
      file: "C:/Users/win/.claude/skills/codex-plugin-builder/ (entire skill)"
      description: >
        The skill lives outside the repository (C:/Users/win/.claude/skills/) while the
        KB it partially duplicates lives inside the repository under git. The skill has
        no version pin, no git tracking, and no refresh hook. When the KB is updated
        (e.g., a new Drift Notes correction), the skill's parallel reference files are
        not updated by any mechanical process. The only coupling is human memory and the
        sources.md refresh procedure.
      impact: >
        After any upstream OpenAI schema change: (a) the KB gets updated via the repo
        workflow; (b) the skill silently holds the old schema; (c) users invoking the
        skill receive stale templates. The symptom is subtle — templates parse correctly
        but use deprecated paths or legacy env vars. Detection requires manual cross-
        checking between C:/Users/win/.claude/ and the repo, across two filesystems.

    - id: RISK-3
      category: abstraction-leak
      severity: MEDIUM
      file: "C:/Users/win/.claude/skills/codex-plugin-builder/SKILL.md:3"
      description: >
        The skill description embeds runtime-specific trigger phrases as an enumerated
        list of ~20 strings in the YAML frontmatter. This design leaks implementation
        detail (phrase matching) into the metadata layer. If Codex changes its skill
        matching strategy from keyword matching to semantic matching, the list becomes
        dead weight. If it changes from semantic to stricter keyword matching, missing
        phrases cause silent non-triggering. The description is also 1,068 characters
        — significantly above the "substantive but tight" guidance the skill itself
        prescribes for descriptions (~300-600 chars sweet spot in the template).
      evidence: >
        SKILL.md line 3 (description field): enumerates "create a codex plugin", "build
        a codex skill", "scaffold .codex-plugin", "codex hooks.json", "codex subagent
        TOML", ".codex/agents/", "codex marketplace.json", "convert this Claude Code
        plugin to Codex", "port skill to codex", plus Portuguese variants plus comparison
        and validation cases.

    - id: RISK-4
      category: single-point-of-failure
      severity: MEDIUM
      file: "C:/Users/win/.claude/skills/codex-plugin-builder/references/sources.md:47"
      description: >
        The refresh procedure is a four-step manual checklist that requires the maintainer
        to diff URLs, open each changed page, and update references. There is no automated
        staleness detection. The "last_verified" timestamp in each file is the only
        staleness signal, and it is updated by the same human doing the refresh — creating
        a confirmation bias loop where the timestamp is correct even when the content is not.
      impact: >
        Schema changes in OpenAI docs accumulate silently between refresh cycles.
        The "last_verified: 2026-05-19" timestamps give false confidence to agents
        reading the files. The per-topic KB files still say "last_verified: 2026-05-18"
        while plugin-build-guide.md says "2026-05-19" — a one-day delta that already
        signals the maintenance burden is per-file, not holistic.

    - id: RISK-5
      category: layering-violation
      severity: LOW
      file: "D:/Pipeline Orchestrator For Codex/references/openai-codex-kb/plugins.md:110"
      description: >
        The per-topic KB files (plugins.md, skills.md, etc.) contain both general Codex
        knowledge and repo-specific working rules mixed in the same document. For example,
        plugins.md lines 79-98 give hooks and skills rules that are specific to this repo's
        pipeline plugin. An agent building a different Codex plugin who reads plugins.md
        may apply repo-specific constraints (e.g., "A hook should not be the only place
        where critical business logic exists if TypeScript runtime also depends on it") as
        if they were general Codex guidance.
      evidence: >
        plugins.md lines 69-98: Sections "Hooks in Plugins" and "Skills in Plugins"
        mix general Codex rules with repo-local constraints ("For this repo:", "For
        pipeline-orchestrator-for-codex:") without a clear visual boundary that an agent
        parsing the file can reliably detect.

    - id: RISK-6
      category: abstraction-leak
      severity: LOW
      file: "D:/Pipeline Orchestrator For Codex/references/openai-codex-kb/INDEX.md:36"
      description: >
        The globs field in INDEX.md frontmatter (`globs: ["skills/**/*.md", "hooks/**/*.cjs", ...]`)
        describes which files in the repo should prompt an agent to consult this KB.
        This is a convention without enforcement — the glob patterns have no runtime
        effect and do not match the corrected paths in plugin-build-guide.md (e.g., the
        corrected standalone skill path is `.agents/skills/`, not `skills/`). The globs
        are stale relative to their own KB.
      evidence: >
        INDEX.md line 33: globs include `"skills/**/*.md"`. plugin-build-guide.md line 149
        corrects this: "Standalone (not part of a plugin): $CWD/.agents/skills/<name>/SKILL.md".
        The glob that would match the corrected path (`".agents/skills/**/*.md"`) is absent.

  recommendations:
    - id: REC-1
      related_to: ARCH-1, RISK-1
      description: >
        Retire the Drift Notes append pattern. Instead of appending corrections to per-topic
        files, either (a) rewrite the per-topic file body to match the corrected state and
        remove the Drift Notes block, or (b) tombstone the per-topic file with a single
        forward pointer to plugin-build-guide.md and nothing else. The goal is one place
        where the fact lives, not two places where one overrides the other. Evaluate which
        per-topic content is genuinely additive (repo-specific context) versus duplicative
        (schema facts that live better in the guide).

    - id: REC-2
      related_to: ARCH-2, RISK-2
      description: >
        Resolve the KB-vs-skill duplication by choosing a single source and making the other
        a thin pointer. Investigate whether the skill's reference files could be eliminated
        in favor of pointing at the in-repo KB (e.g., via a shared path or a doc-fetch step
        in the skill workflow). If the skill must be self-contained (because it runs outside
        the repo context), establish a mechanical sync check — for example, a test or hook
        that compares last_verified timestamps between the skill and the KB and warns when
        they diverge beyond a threshold.

    - id: REC-3
      related_to: ARCH-4
      description: >
        Replace hard-coded sibling skill names in the codex-plugin-builder disambiguation
        clause with a stable concept reference ("for Claude Code plugin authoring, use the
        appropriate Claude Code plugin skill in your environment"). This decouples the
        routing instruction from a specific skill name that may change. Separately, align
        the two inconsistent names currently cited (plugin-dev vs plugin-dev:plugin-validator)
        to a single canonical reference.

    - id: REC-4
      related_to: ARCH-5
      description: >
        Audit whether CLAUDE.md truly is a shim or is a parallel authority document.
        If it contains non-trivial content (architecture, working rules, common commands)
        not present in AGENTS.md, rename or restructure it to be explicitly additive
        (Claude-Code-only guidance that Codex cannot see) rather than a shim pretending
        to delegate. Consider a checklist or CI assertion that verifies any working rule
        added to CLAUDE.md is either present in AGENTS.md or is explicitly marked
        Claude-Code-only.

    - id: REC-5
      related_to: RISK-3
      description: >
        Investigate splitting the codex-plugin-builder skill description into a tight
        frontmatter description (matching the ~300-600 char guidance the skill itself
        prescribes) and moving the extended phrase enumeration into the SKILL.md body's
        "When to use" section. The frontmatter description is loaded into the initial
        skills context budget (~8KB/~2% context window); every character there competes
        with other skills for that budget.

    - id: REC-6
      related_to: RISK-6
      description: >
        Update the INDEX.md globs to reflect the corrected discovery paths from
        plugin-build-guide.md. Add `.agents/skills/**/*.md` alongside `skills/**/*.md`.
        Alternatively, deprecate the globs field if it has no runtime enforcement —
        the false precision of a stale glob is worse than no glob.
```
