# OpenCode Tools

This repository contains the source code and tooling for **OpenCode**, an open-source AI coding agent.

## Project Structure

- `data/opencode`: The main monorepo for OpenCode. It includes:
  - Core agent logic and CLI.
  - Terminal User Interface (TUI).
  - Desktop application (BETA).
  - Web interface and documentation.
  - SDKs for integration.
- `tool-cli`: Internal CLI tools used by the agent.
- `tool-lib`: Common library for agent tools.

## OpenCode

OpenCode is a provider-agnostic AI coding agent designed for developers. It focuses on:
- **Open Source**: Fully open and community-driven.
- **Provider Agnostic**: Works with various LLM providers (Claude, OpenAI, Google, local models).
- **TUI Focus**: Optimized for terminal-based workflows.
- **Extensibility**: Client/server architecture allowing for multiple frontends.

For detailed information, installation guides, and documentation, please refer to the [OpenCode website](https://opencode.ai) or the `README.md` in `data/opencode`.
