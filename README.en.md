<div align="center">
  <img src="public/keelson.svg" width="72" height="72" alt="Keelson" />
  <h1>Keelson</h1>
  <p><b>A local-first AI workspace</b> — gathers your scattered AI-CLI sessions, projects, tasks, and docs into one place.</p>
  <p><sub><a href="README.md">简体中文</a> · English</sub></p>
</div>

---

Keelson is a local-first, cross-platform desktop app that brings your scattered AI-CLI sessions, projects, tasks, and documents together. Your data stays on your machine by default — session transcripts never enter the database, AI retrieval favors local embeddings, and content is never sent to third parties.

## Features

- **Session hub + Spotlight** — Aggregates sessions from local CLIs (Claude / Codex, etc.), full-text search (Tantivy + jieba), a global hotkey for instant recall, and one-click terminal-context restore.
- **Project board** — Two-tier project model: any directory with sessions becomes a lightweight project automatically, and can be "promoted" to a managed board (tasks / workflows / drag-to-reorder / templates) with two-way session↔task traceability.
- **Docs / Calendar** — Versioned documents (optimistic concurrency) and a calendar with recurrence rules and reminders.
- **AI Chat + RAG** — Configurable multi-provider (Anthropic / OpenAI-compatible / local), scoped tools authorized via your PocketBase token, retrieving past sessions to answer "how did I solve X last time".
- **Distillation** — Session → candidate extraction → confirm → materialize into docs / tasks / calendar, with provenance back-links.
- **Reading · Memory ledger · MCP Server** — Save external articles with AI summaries; a review-gated memory ledger; expose MCP tools so other AIs can read/write workspace data.

## Tech Stack

| Layer | Choice |
|---|---|
| Shell | Rust + **Tauri v2** |
| Frontend | React 19 · TypeScript · Tailwind 4 · shadcn/ui · Zustand |
| Data | **PocketBase** (sidecar, bound to 127.0.0.1; every table has owner + access-rules, multi-user ready) |
| Search | Tantivy + jieba (local full-text) |

## Development

**Prerequisites:** Node 20+, pnpm, Rust stable. On Linux also install `libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev`.

```bash
pnpm install
pnpm tauri dev      # launch the app (first run auto-downloads the platform's PocketBase sidecar)
```

Common checks:

```bash
pnpm lint           # eslint
pnpm exec tsc --noEmit
pnpm test           # vitest
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

## Build

```bash
pnpm tauri build    # artifacts under src-tauri/target/release/bundle/
```

The PocketBase sidecar is fetched by `scripts/fetch-pocketbase.mjs` during the `prebuild` step, matched to the current platform triple and placed into `src-tauri/binaries/` following Tauri's sidecar naming convention.

## Privacy Boundary

Session transcripts stay on disk; only metadata enters PocketBase. AI retrieval favors local embeddings and never sends content to third parties. Destructive operations are not registered as AI tools — server-side access-rules are the authorization boundary.
