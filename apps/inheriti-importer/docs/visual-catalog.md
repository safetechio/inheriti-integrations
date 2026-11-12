# Visual catalog in Electron

From `apps/inheriti-importer`, run:

```bash
corepack pnpm visual:catalog
```

The command starts the existing Ladle stories on `127.0.0.1:6110` and opens them in a dedicated Electron window. Use Ladle's sidebar and search to choose a source, asset, plan, staging, shell or update state. The viewport can be resized like the real desktop window. Edits to stories and styles refresh in that same window. Close the Electron window to stop the catalog server.

Stories render the Importer's real React components with synthetic fixtures. Interactive stories let you exercise controls and transitions, but do not sign in, call Business, read the real vault, or stage plans. The catalog uses a temporary Electron profile, has no application preload or IPC handlers, and accepts requests only from its local Ladle server and its dedicated hot-reload WebSocket. It is available only through this development command; the app's packaged entry remains the normal Importer.

To check authenticated imports and real Electron IPC separately, use the [local review workflow](../scripts/review-local.mjs).

Start by searching for **Landing**, **Synthetic controlled sources**, **Synthetic controlled asset flow**, or **Whole importer flow staging progress**. These cover the shell and the main interactive import steps; the other stories expose individual empty, pending, failed and completed states.

Keep one catalog instance open. The launcher refuses to reuse an occupied port, and closing its Electron window stops only its own Ladle server. For automated coverage on a machine also running an Android emulator, inspect stories sequentially and close test instances between batches rather than opening many windows.

Ladle's development runtime needs JavaScript evaluation, so only this isolated development window permits `unsafe-eval`. The normal Importer's content policy, preload and application entry are unchanged.
