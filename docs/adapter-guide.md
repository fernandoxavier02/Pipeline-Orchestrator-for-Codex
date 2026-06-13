# Codex Adapter Guide

This guide records the repo-only adaptation boundary for the Pipeline Orchestrator Codex port. It is documentation evidence for the local checkout and does not prove Marketplace publication, installed Codex cache activation, VPS dispatch, or live plugin execution.

## Adapter Boundary

Codex does not inherit Claude task primitives directly. Public workflow behavior is proven through plugin skills, runtime code, hooks, tests, package/cache evidence, and live smoke evidence at the layer being claimed.

- `commands/**` files are discovery and compatibility shims.
- `skills/**` files own the public Codex workflow contracts.
- `src/**`, `hooks/**`, `agents/**`, `prompts/**`, and `references/**` own runtime behavior and role contracts.
- `evals/**` records local Eval Gate evidence only.

## Runtime Requirement

Operational multi-agent claims require `spawn_agent`, `wait_agent`, artifact collection, gate recording, hook/checkpoint recording, and structured final state. If those capabilities are unavailable, governed operational paths must stop with `blocked-no-agent-runtime`.

Manual or harness review can support diagnosis, but it must not be counted as a valid production multi-agent pipeline execution.

## Claim Boundary

A repo-only change can close local documentation gaps when tests and Eval Gate evidence support it. Complete public portability still requires package-surface proof and installed-cache smoke proof, and live plugin behavior requires a separate live execution trace.
