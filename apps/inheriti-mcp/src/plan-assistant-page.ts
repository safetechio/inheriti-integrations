import type { LocalAssistantInstallProgress } from '@safetech/inheriti-elements-core/node';

/** Public setup copy only. The capability path and CSRF value stay in the local HTTP response. */
export function planAssistantSetupPage(path: string, csrf: string, state: 'consent' | 'installing' | 'failed', progress?: LocalAssistantInstallProgress): string {
  const content = state === 'consent' ? `
    <p class="description">This model runs on your device to suggest assets and prefill their fields from text you enter in this window. You review each asset before saving.</p>
    <div class="notice">Setup downloads the model and runtime (about 1.1 GB). Allow about 1.5 GB of disk space. Your plan text is processed locally after setup.</div>
    <form method="post" action="${path}">
      <input type="hidden" name="csrf" value="${csrf}">
      <div class="actions">
        <button class="primary" name="action" value="install">Download and install</button>
        <button class="secondary" name="action" value="cancel">Cancel</button>
      </div>
  </form>` : state === 'installing' ? `
    <p class="description" role="status">${progressLabel(progress)}</p>
    ${progressBar(progress)}
    <p class="hint">When setup finishes, the plan assistant opens in a new local page.</p>
    <form method="post" action="${path}">
      <input type="hidden" name="csrf" value="${csrf}">
      <div class="actions"><button class="secondary" name="action" value="cancel">Cancel installation</button></div>
    </form>
    <meta http-equiv="refresh" content="2">` : `
    <p class="error" role="alert">Installation failed. Check available disk space, then retry from MCP.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Set up local assistant</title>
  <style>
    @font-face { font-family: AppFont; src: url('${path}/font-app.ttf') format('truetype'); font-weight: 200 800; font-display: swap; }
    :root { color-scheme: light; font-family: AppFont, system-ui, sans-serif; color: #101828; background: #f9fafb; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    main { width: min(100%, 480px); padding: 32px; background: #fff; border: 1px solid #eaecf0; border-radius: 12px; box-shadow: 0 10px 24px #10182812; }
    .eyebrow { margin: 0 0 8px; color: #2962ff; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0; font-size: 24px; line-height: 1.3; }
    .description { margin: 16px 0; color: #475467; line-height: 1.5; }
    .notice { padding: 12px; border: 1px solid #dbe4ff; border-radius: 8px; color: #344054; background: #f5f8ff; line-height: 1.45; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 24px; }
    button { min-height: 40px; padding: 8px 14px; border-radius: 8px; font: inherit; font-weight: 600; cursor: pointer; }
    button:focus-visible { outline: 3px solid #a4bcfd; outline-offset: 2px; }
    .primary { border: 1px solid #2962ff; color: #fff; background: #2962ff; }
    .primary:hover { background: #174dcc; }
    .secondary { border: 1px solid #d0d5dd; color: #344054; background: #fff; }
    .secondary:hover { background: #f9fafb; }
    .hint { color: #667085; font-size: 14px; }
    progress { width: 100%; height: 12px; accent-color: #2962ff; }
    .error { padding: 12px; border: 1px solid #fecdca; border-radius: 8px; color: #b42318; background: #fff5f4; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Local plan assistant</p>
    <h1>Set up your assistant</h1>
    ${content}
  </main>
</body>
</html>`;
}

function progressLabel(progress?: LocalAssistantInstallProgress): string {
  if (!progress) return 'Preparing the local download…';
  if (progress.phase === 'extract') return 'Extracting the local runtime…';
  if (progress.phase === 'verify') return 'Verifying the installation…';
  const label = progress.phase === 'runtime' ? 'Downloading runtime' : 'Downloading model';
  const amount = `${((progress.downloadedBytes ?? 0) / 1_000_000).toFixed(1)} MB`;
  if (!progress.totalBytes) return `${label} · ${amount}`;
  return `${label} · ${Math.min(100, Math.floor((progress.downloadedBytes ?? 0) / progress.totalBytes * 100))}% · ${amount} / ${(progress.totalBytes / 1_000_000).toFixed(1)} MB`;
}

function progressBar(progress?: LocalAssistantInstallProgress): string {
  if (!progress || (progress.phase !== 'runtime' && progress.phase !== 'model')) return '';
  const percent = progress.totalBytes ? Math.min(100, Math.floor((progress.downloadedBytes ?? 0) / progress.totalBytes * 100)) : undefined;
  return percent === undefined ? '<progress aria-label="Download progress"></progress>' : `<progress aria-label="Download progress" value="${percent}" max="100"></progress>`;
}
