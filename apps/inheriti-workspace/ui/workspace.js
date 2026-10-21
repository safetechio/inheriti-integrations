const invoke = window.__TAURI__.core.invoke;
const listen = window.__TAURI__.event.listen;
const fileStep = document.getElementById("file-step");
const fileError = document.getElementById("file-error");
const chooseFile = document.getElementById("choose-file");
const resetFile = document.getElementById("reset-file");
const startOver = document.getElementById("start-over");
const cancelOpening = document.getElementById("cancel-opening");
const openingStep = document.getElementById("opening-step");
const openingStatus = document.getElementById("opening-status");
const openingProgress = document.getElementById("opening-progress");
const adapterStatus = document.getElementById("adapter-status");
const previewArea = document.getElementById("preview-area");
const result = document.getElementById("result");
const imagePreview = document.getElementById("image-preview");
const imageScroll = document.getElementById("image-scroll");
const pdfControls = document.getElementById("pdf-controls");
const pdfStatus = document.getElementById("pdf-status");
const pdfPageLabel = document.getElementById("pdf-page-label");
const pdfPrevious = document.getElementById("pdf-previous");
const pdfNext = document.getElementById("pdf-next");
const windowChrome = document.getElementById("window-chrome");
let stage = "file";
let generation = 0;
let busy = false;
let selecting = false;
let activeProcess = Promise.resolve();
let cancelling = false;
let openingId;
let pdfSession;
let guestSession = false;
let guestClosing = Promise.resolve(true);
let expiryTimer;
let pdfPage = 1;
let pdfPageCount = 0;
let pdfZoom = 1;
let pdfRenderGeneration = 0;

invoke("viewer_window_chrome").then((supported) => {
  windowChrome.hidden = !supported && stage !== "result";
  document.body.classList.toggle("custom-chrome", supported);
}).catch(() => {});
for (const [id, action] of [
  ["window-minimize", "minimize"],
  ["window-maximize", "toggleMaximize"],
  ["window-close", "close"],
]) document.getElementById(id).addEventListener("click", () =>
  invoke("viewer_window_action", { action }).catch(() => {}));
windowChrome.addEventListener("pointerdown", (event) => {
  if (document.body.classList.contains("custom-chrome") && event.button === 0 && !event.target.closest("button"))
    invoke("viewer_window_action", { action: "drag" }).catch(() => {});
});
windowChrome.addEventListener("dblclick", (event) => {
  if (document.body.classList.contains("custom-chrome") && !event.target.closest("button"))
    invoke("viewer_window_action", { action: "toggleMaximize" }).catch(() => {});
});

function showStage(next) {
  stage = next;
  const apply = () => {
    if (stage !== next) return;
    document.body.classList.toggle("result-stage", next === "result");
    windowChrome.hidden = !document.body.classList.contains("custom-chrome") && next !== "result";
    fileStep.hidden = next !== "file";
    openingStep.hidden = next !== "opening";
    previewArea.hidden = next !== "result";
    startOver.hidden = next !== "result";
  };
  if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches)
    document.startViewTransition(apply);
  else apply();
}

function resetProgress() {
  adapterStatus.hidden = true;
  adapterStatus.textContent = "";
  delete adapterStatus.dataset.phase;
  openingProgress.classList.remove("is-determinate");
  openingProgress.style.removeProperty("--progress-width");
  for (const name of ["aria-valuenow", "aria-valuemin", "aria-valuemax"]) openingProgress.removeAttribute(name);
  openingProgress.setAttribute("aria-label", "Opening request in progress");
}

function adapterProgress(payload) {
  if (!busy || stage !== "opening" || payload?.openingId !== openingId ||
      !["GridCraft", "Gnumeric", "WordCraft", "mpv"].includes(payload.application)) return;
  const messages = {
    checking: `Checking ${payload.application}…`,
    "cache-hit": `${payload.application} is ready to use.`,
    downloading: `Downloading ${payload.application}…`,
    verifying: `Verifying ${payload.application}…`,
    preparing: `Preparing ${payload.application}…`,
    opening: `Opening with ${payload.application}…`,
    ready: `${payload.application} is ready.`,
    failed: `${payload.application} could not be prepared.`,
  };
  if (!Object.hasOwn(messages, payload.phase)) return;
  adapterStatus.hidden = false;
  adapterStatus.textContent = messages[payload.phase];
  if (adapterStatus.dataset.phase !== payload.phase) {
    adapterStatus.dataset.phase = payload.phase;
    adapterStatus.style.animation = "none";
    void adapterStatus.offsetWidth;
    adapterStatus.style.removeProperty("animation");
  }
  const validBytes = payload.phase === "downloading" && Number.isSafeInteger(payload.totalBytes) &&
    payload.totalBytes > 0 && Number.isSafeInteger(payload.receivedBytes) &&
    payload.receivedBytes >= 0 && payload.receivedBytes <= payload.totalBytes;
  openingProgress.classList.toggle("is-determinate", validBytes);
  if (validBytes) {
    const percent = Math.round(payload.receivedBytes / payload.totalBytes * 100);
    openingProgress.style.setProperty("--progress-width", `${percent}%`);
    openingProgress.setAttribute("aria-valuemin", "0");
    openingProgress.setAttribute("aria-valuemax", "100");
    openingProgress.setAttribute("aria-valuenow", String(percent));
    openingProgress.setAttribute("aria-label", `Downloading ${payload.application}`);
  } else {
    openingProgress.style.removeProperty("--progress-width");
    for (const name of ["aria-valuenow", "aria-valuemin", "aria-valuemax"]) openingProgress.removeAttribute(name);
    openingProgress.setAttribute("aria-label", messages[payload.phase]);
  }
}

async function clearPreview() {
  generation++;
  if (stage === "result") invoke("viewer_close_result").catch(() => {});
  const hadGuest = guestSession;
  guestSession = false;
  if (hadGuest) guestClosing = invoke("viewer_close_guest_session").then(() => true, () => {
    guestSession = true;
    return false;
  });
  if (pdfSession) invoke("viewer_close_pdf_session", { sessionId: pdfSession }).catch(() => {});
  pdfSession = undefined;
  pdfRenderGeneration++;
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = undefined;
  pdfControls.hidden = true;
  pdfStatus.hidden = true;
  previewArea.classList.remove("pdf-preview");
  result.textContent = "";
  result.hidden = false;
  imagePreview.width = 0;
  imagePreview.height = 0;
  imagePreview.style.width = "";
  imagePreview.hidden = true;
  imageScroll.hidden = true;
  resetProgress();
  return guestClosing;
}

function fail(message) {
  fileError.textContent = message;
  fileError.hidden = false;
  resetFile.hidden = false;
  chooseFile.disabled = message.startsWith("Workspace could not close securely");
  showStage("file");
}

function drawImage(image) {
  const { width, height, rgbaBase64 } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height > 4_194_304 || typeof rgbaBase64 !== "string" || rgbaBase64.length > 22_369_632)
    throw new Error("invalid image");
  const binary = atob(rgbaBase64);
  if (binary.length !== width * height * 4) throw new Error("invalid image");
  const pixels = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) pixels[i] = binary.charCodeAt(i);
  imagePreview.width = width;
  imagePreview.height = height;
  imagePreview.getContext("2d").putImageData(new ImageData(pixels, width, height), 0, 0);
  imagePreview.hidden = false;
  imageScroll.hidden = false;
  result.hidden = true;
  result.textContent = "";
}

function updatePdfControls() {
  pdfPageLabel.textContent = `Page ${pdfPage} of ${pdfPageCount}`;
  pdfPrevious.disabled = pdfPage <= 1;
  pdfNext.disabled = pdfPage >= pdfPageCount;
}

async function renderPdfPage(page) {
  if (!pdfSession || page < 1 || page > pdfPageCount) return;
  const sessionId = pdfSession;
  const current = generation;
  const render = ++pdfRenderGeneration;
  pdfStatus.hidden = false;
  pdfStatus.textContent = `Loading page ${page}…`;
  for (const button of pdfControls.querySelectorAll("button")) button.disabled = true;
  try {
    const displayWidth = Math.max(1, Math.floor((window.innerWidth - 80) * pdfZoom));
    const fitPx = Math.max(320, Math.min(1600, displayWidth));
    const image = await invoke("viewer_render_pdf_page", { sessionId, page, fitPx });
    if (current !== generation || render !== pdfRenderGeneration || sessionId !== pdfSession) return;
    drawImage(image);
    imagePreview.style.width = `${displayWidth}px`;
    pdfPage = page;
    pdfStatus.hidden = true;
    updatePdfControls();
  } catch {
    if (current !== generation || render !== pdfRenderGeneration) return;
    pdfStatus.textContent = "Could not render this page. Try again.";
    updatePdfControls();
  }
  for (const button of pdfControls.querySelectorAll("button"))
    if (button !== pdfPrevious && button !== pdfNext) button.disabled = false;
}

pdfPrevious.addEventListener("click", () => renderPdfPage(pdfPage - 1));
pdfNext.addEventListener("click", () => renderPdfPage(pdfPage + 1));
document.getElementById("pdf-fit").addEventListener("click", () => { pdfZoom = 1; renderPdfPage(pdfPage); });
document.getElementById("pdf-zoom-in").addEventListener("click", () => { pdfZoom = Math.min(2, pdfZoom + 0.25); renderPdfPage(pdfPage); });
document.getElementById("pdf-zoom-out").addEventListener("click", () => { pdfZoom = Math.max(0.5, pdfZoom - 0.25); renderPdfPage(pdfPage); });

function expire(expiresAt, current) {
  if (current !== generation) return;
  const remaining = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) {
    void clearPreview().then((closed) => fail(closed
      ? "This viewing session expired. Choose the file to open it again."
      : "Workspace could not close securely. Close the app before opening another file."));
    return;
  }
  expiryTimer = setTimeout(() => expire(expiresAt, current), Math.min(remaining, 2_147_483_647));
}

async function ensureSignedIn(current) {
  let status = await invoke("viewer_status");
  if (current !== generation) return false;
  if (status.signedIn) return true;
  openingStatus.textContent = "Checking your sign-in…";
  try { await invoke("viewer_try_browser_sign_in"); } catch { /* Interactive sign-in follows. */ }
  if (current !== generation) return false;
  status = await invoke("viewer_status");
  if (current !== generation) return false;
  if (status.signedIn) return true;
  openingStatus.textContent = "Complete sign-in in your browser…";
  await invoke("viewer_sign_in");
  if (current !== generation) return false;
  status = await invoke("viewer_status");
  if (current !== generation) return false;
  if (!status.signedIn) throw new Error("sign-in incomplete");
  return true;
}

async function processFile() {
  if (busy) return;
  busy = true;
  chooseFile.disabled = false;
  fileError.hidden = true;
  resetFile.hidden = true;
  if (!(await clearPreview())) {
    busy = false;
    fail("Workspace could not close securely. Close the app before opening another file.");
    return;
  }
  const current = generation;
  let guestAttempted = false;
  showStage("opening");
  openingStatus.textContent = "Checking protected file…";
  try {
    if (!(await ensureSignedIn(current)) || current !== generation) return;
    openingStatus.textContent = "Verifying file and organisation…";
    const access = await invoke("viewer_inspect_startup_file");
    if (current !== generation) return;
    if (access.status !== "READY") throw new Error("opening unavailable");
    openingStatus.textContent = "Waiting for SafeKey Mobile approval…";
    if (!(await guestClosing)) throw new Error("workspace close failed");
    const { supported: useGuest } = await invoke("viewer_guest_preflight");
    if (current !== generation) return;
    guestAttempted = useGuest;
    const id = crypto.randomUUID();
    openingId = id;
    let preview;
    preview = await invoke(useGuest ? "viewer_open_startup_file_in_guest" : "viewer_open_startup_file",
      useGuest ? { fromReveal: false, openingId: id } : { openingId: id });
    if (current !== generation) {
      if (useGuest) await invoke("viewer_close_guest_session");
      return;
    }
    if (useGuest) {
      guestSession = true;
      result.textContent = "Your file is open in Inheriti® Workspace.";
    } else if (preview.pdf) {
      const { sessionId, pageCount, page } = preview.pdf;
      if (typeof sessionId !== "string" || !sessionId || !Number.isInteger(pageCount) || pageCount < 1) throw new Error("invalid pdf");
      pdfSession = sessionId;
      previewArea.classList.add("pdf-preview");
      pdfPageCount = pageCount;
      pdfPage = 1;
      pdfZoom = 1;
      pdfControls.hidden = false;
      updatePdfControls();
      drawImage(page);
      imagePreview.style.width = `${Math.min(page.width, Math.max(1, window.innerWidth - 80))}px`;
    } else if (preview.image) drawImage(preview.image);
    else { result.hidden = false; result.textContent = preview.text; }
    openingId = undefined;
    resetProgress();
    showStage("result");
    invoke("viewer_show_result").catch(() => {});
    if (preview.expiresAt) expire(preview.expiresAt, current);
  } catch (error) {
    if (current !== generation) return;
    if (guestAttempted) guestSession = true;
    const message = error === "opening unavailable" || error?.message === "opening unavailable"
      ? "This file is not available to open. Choose another file."
      : error === "sign-in incomplete" || error?.message === "sign-in incomplete"
        ? "Sign-in could not be completed. Choose the file to try again."
        : "This file could not be opened. Check your access or choose another file.";
    const closed = await clearPreview();
    fail(closed ? message : "Workspace could not close securely. Close the app before opening another file.");
    if (!cancelling) {
      openingId = undefined;
      busy = false;
    }
  } finally {
    if (current === generation) openingId = undefined;
    if (current === generation) busy = false;
  }
}

function beginProcess() {
  if (busy || cancelling) return;
  activeProcess = processFile();
}

async function selectFile(command, args) {
  if (busy || selecting || cancelling) return;
  selecting = true;
  try {
    const selected = await invoke(command, args);
    if (selected) beginProcess();
  } catch {
    fail("Could not select this file. Choose a .inheriti file and try again.");
  } finally {
    selecting = false;
  }
}

async function restart() {
  if (cancelling) return;
  cancelling = true;
  cancelOpening.disabled = true;
  startOver.disabled = true;
  resetFile.disabled = true;
  generation++;
  const operationWasPending = busy;
  if (operationWasPending) await invoke("viewer_cancel_opening").catch(() => {});
  const closed = await clearPreview();
  if (operationWasPending) await activeProcess;
  if (!closed) {
    fail("Workspace could not close securely. Close the app before opening another file.");
  } else {
    try {
      await invoke("viewer_clear_startup_file");
      fileError.hidden = true;
      resetFile.hidden = true;
      chooseFile.disabled = false;
      showStage("file");
    } catch {
      fail("Workspace could not reset this file. Close the app before opening another file.");
    }
  }
  cancelOpening.disabled = false;
  startOver.disabled = false;
  resetFile.disabled = false;
  cancelling = false;
  busy = false;
}

cancelOpening.addEventListener("click", restart);
startOver.addEventListener("click", restart);
resetFile.addEventListener("click", restart);
chooseFile.addEventListener("click", () => selectFile("viewer_choose_file"));
window.__TAURI__.webview?.getCurrentWebview()?.onDragDropEvent(({ payload }) => {
  if (payload.type === "enter" && stage === "file") fileStep.classList.add("drag-over");
  if (payload.type === "leave" || payload.type === "drop") fileStep.classList.remove("drag-over");
  if (payload.type !== "drop") return;
  if (stage !== "file") return;
  const paths = payload.paths || [];
  if (paths.length !== 1 || !paths[0]?.toLowerCase().endsWith(".inheriti")) {
    fail("Drop one .inheriti file at a time.");
    return;
  }
  selectFile("viewer_accept_file", { path: paths[0] });
});
listen("workspace-adapter-progress", ({ payload }) => adapterProgress(payload));
listen("workspace-close-failed", () => {
  document.getElementById("close-status").hidden = false;
});
listen("viewer-startup-file", () => {
  if (busy || selecting || cancelling) return;
  if (stage === "result") {
    void clearPreview().then((closed) => closed ? beginProcess() : fail("Workspace could not close securely. Close the app before opening another file."));
  } else beginProcess();
});

invoke("viewer_version").then((version) => {
  document.getElementById("app-version").textContent = `v${version}`;
}).catch(() => {});
invoke("viewer_has_startup_file").then((hasFile) => { if (hasFile) beginProcess(); })
  .catch(() => fail("Could not read this .inheriti file. Choose another file."));
