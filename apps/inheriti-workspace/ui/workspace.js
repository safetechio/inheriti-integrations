const result = document.getElementById("result");
const imagePreview = document.getElementById("image-preview");
const imageScroll = document.getElementById("image-scroll");
const previewArea = document.getElementById("preview-area");
const signIn = document.getElementById("sign-in");
const signOut = document.getElementById("sign-out");
const organization = document.getElementById("organization");
const organizationField = document.getElementById("organization-field");
const binding = document.getElementById("binding");
const account = document.getElementById("account");
const openFile = document.getElementById("open-file");
const openFromReveal = document.getElementById("open-from-reveal");
const openingActions = document.getElementById("opening-actions");
const closeFile = document.getElementById("close-file");
const pairingCode = document.getElementById("pairing-code");
const fileStep = document.getElementById("file-step");
const accessStep = document.getElementById("access-step");
const openingStep = document.getElementById("opening-step");
const fileContinue = document.getElementById("file-continue");
const accessContinue = document.getElementById("access-continue");
const openingStatus = document.getElementById("opening-status");
const openingProgress = document.getElementById("opening-progress");
const adapterStatus = document.getElementById("adapter-status");
const pdfControls = document.getElementById("pdf-controls");
const pdfStatus = document.getElementById("pdf-status");
const pdfPageLabel = document.getElementById("pdf-page-label");
const pdfPrevious = document.getElementById("pdf-previous");
const pdfNext = document.getElementById("pdf-next");
const invoke = window.__TAURI__.core.invoke;
const windowChrome = document.getElementById("window-chrome");
if (windowChrome) {
  invoke("viewer_window_chrome").then((supported) => {
    windowChrome.hidden = !supported && stage !== "result";
    document.body.classList.toggle("custom-chrome", supported);
  }).catch(() => {});
  for (const [id, action] of [
    ["window-minimize", "minimize"],
    ["window-maximize", "toggleMaximize"],
    ["window-close", "close"],
  ]) {
    document.getElementById(id).addEventListener("click", () =>
      invoke("viewer_window_action", { action }).catch(() => {}));
  }
  windowChrome.addEventListener("pointerdown", (event) => {
    if (document.body.classList.contains("custom-chrome") && event.button === 0 && !event.target.closest("button"))
      invoke("viewer_window_action", { action: "drag" }).catch(() => {});
  });
  windowChrome.addEventListener("dblclick", (event) => {
    if (document.body.classList.contains("custom-chrome") && !event.target.closest("button"))
      invoke("viewer_window_action", { action: "toggleMaximize" }).catch(() => {});
  });
}
let clearTimer;
let previewGeneration = 0;
let openingPending = false;
let activeOpeningId;
let revealOpeningPending = false;
let fileChangePending = false;
let signingOut = false;
let fileAccess;
let signedIn = false;
let stage = "file";
let autoAdvanceSuppressed = false;
let pdfSession;
let pdfPage = 1;
let pdfPageCount = 0;
let pdfZoom = 1;
let pdfRenderGeneration = 0;

function resetAdapterProgress() {
  adapterStatus.hidden = true;
  adapterStatus.textContent = "";
  delete adapterStatus.dataset.phase;
  openingProgress.classList.remove("is-determinate");
  openingProgress.style.removeProperty("--progress-width");
  openingProgress.removeAttribute("aria-valuenow");
  openingProgress.removeAttribute("aria-valuemin");
  openingProgress.removeAttribute("aria-valuemax");
  openingProgress.setAttribute("aria-label", "Opening request in progress");
}

function showAdapterProgress(payload) {
  if (!openingPending || stage !== "opening" || !activeOpeningId || payload?.openingId !== activeOpeningId || !["GridCraft", "Gnumeric"].includes(payload.application)) return;
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
  // Restart the short entrance only when the phase changes, not for each byte update.
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
    openingProgress.removeAttribute("aria-valuemin");
    openingProgress.removeAttribute("aria-valuemax");
    openingProgress.removeAttribute("aria-valuenow");
    openingProgress.setAttribute("aria-label", messages[payload.phase]);
  }
}

function stopAutoAdvance() {
  autoAdvanceSuppressed = true;
}

function scheduleAutoAdvance() {
  if (autoAdvanceSuppressed || fileAccess?.status !== "READY" || !signedIn || !organization.value) return;
  if (stage === "file") showStage("access");
  if (stage === "access") openProtectedFile(fileAccess.origin === "REVEAL");
}

function showStage(next) {
  const previous = stage;
  stage = next;
  if (previous !== next) {
    if (next === "result") invoke("viewer_show_result").catch(() => {});
    else if (previous === "result") invoke("viewer_close_result").catch(() => {});
  }
  const apply = () => {
    if (stage !== next) return;
    document.body.classList.toggle("result-stage", next === "result");
    if (windowChrome) windowChrome.hidden = !document.body.classList.contains("custom-chrome") && next !== "result";
    closeFile.hidden = next !== "result";
    fileStep.hidden = next !== "file";
    accessStep.hidden = next !== "access";
    openingStep.hidden = next !== "opening";
    previewArea.hidden = next !== "result";
  };
  if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches)
    document.startViewTransition(apply);
  else apply();
}

function updateContinue() {
  fileContinue.disabled = fileAccess?.status !== "READY";
  accessContinue.disabled = !signedIn || !organization.value || fileAccess?.status !== "READY";
}

function clearPreview() {
  previewGeneration++;
  activeOpeningId = undefined;
  resetAdapterProgress();
  revealOpeningPending = false;
  pdfRenderGeneration++;
  if (pdfSession) invoke("viewer_close_pdf_session", { sessionId: pdfSession }).catch(() => {});
  pdfSession = undefined;
  pdfControls.hidden = true;
  pdfStatus.hidden = true;
  previewArea.classList.remove("pdf-preview");
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = undefined;
  result.textContent = "";
  result.hidden = false;
  imagePreview.width = 0;
  imagePreview.height = 0;
  imagePreview.style.width = "";
  imagePreview.hidden = true;
  imageScroll.hidden = true;
  if (stage === "result") showStage("file");
  pairingCode.textContent = "";
  closeFile.disabled = true;
}

function drawImage(image) {
  const { width, height, rgbaBase64 } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 4_194_304 || rgbaBase64.length > 22_369_632) throw new Error("invalid image");
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
  const generation = previewGeneration;
  const renderGeneration = ++pdfRenderGeneration;
  pdfStatus.hidden = false;
  pdfStatus.textContent = `Loading page ${page}…`;
  for (const button of pdfControls.querySelectorAll("button")) button.disabled = true;
  try {
    const displayWidth = Math.max(1, Math.floor((window.innerWidth - 80) * pdfZoom));
    const fitPx = Math.max(320, Math.min(1600, displayWidth));
    const image = await invoke("viewer_render_pdf_page", { sessionId, page, fitPx });
    if (generation !== previewGeneration || renderGeneration !== pdfRenderGeneration || sessionId !== pdfSession) return;
    drawImage(image);
    imagePreview.style.width = `${displayWidth}px`;
    pdfPage = page;
    pdfStatus.hidden = true;
    updatePdfControls();
  } catch {
    if (generation !== previewGeneration || renderGeneration !== pdfRenderGeneration) return;
    pdfStatus.textContent = "Could not render this page. Try again.";
    updatePdfControls();
  }
  for (const button of pdfControls.querySelectorAll("button"))
    if (button !== pdfPrevious && button !== pdfNext) button.disabled = false;
}

pdfPrevious.addEventListener("click", () => renderPdfPage(pdfPage - 1));
pdfNext.addEventListener("click", () => renderPdfPage(pdfPage + 1));
document.getElementById("pdf-fit").addEventListener("click", () => {
  pdfZoom = 1;
  renderPdfPage(pdfPage);
});
document.getElementById("pdf-zoom-in").addEventListener("click", () => {
  pdfZoom = Math.min(2, pdfZoom + 0.25);
  renderPdfPage(pdfPage);
});
document.getElementById("pdf-zoom-out").addEventListener("click", () => {
  pdfZoom = Math.max(0.5, pdfZoom - 0.25);
  renderPdfPage(pdfPage);
});

function clearAtExpiry(expiresAt, generation) {
  const remaining = Date.parse(expiresAt) - Date.now();
  if (generation !== previewGeneration || !Number.isFinite(remaining))
    return clearPreview();
  if (remaining <= 0) {
    clearPreview();
    if (fileChangePending) {
      fileChangePending = false;
      autoAdvanceSuppressed = false;
      refresh(organization.value);
    } else {
      binding.textContent = "This preview expired. Open the file again to request a new opening.";
    }
    return;
  }
  clearTimer = setTimeout(
    () => clearAtExpiry(expiresAt, generation),
    Math.min(remaining, 2_147_483_647),
  );
}

async function refresh(preferredOrganizationId) {
  try {
    const status = await invoke("viewer_status");
    if (signingOut) return;
    signedIn = status.signedIn;
    account.textContent = status.signedIn
      ? "Signed in"
      : "Sign in to access an organisation.";
    signIn.hidden = status.signedIn;
    signOut.hidden = !status.signedIn;
    organizationField.hidden = !status.signedIn;
    organization.disabled = !status.signedIn;
    if (!status.signedIn) {
      clearPreview();
      updateContinue();
      organization.replaceChildren(new Option("Select organisation", ""));
      openFile.disabled = true;
      openFromReveal.disabled = true;
      openingActions.hidden = true;
      await inspectStartupFile();
      if (stage === "file") showStage("access");
      return;
    }
    const organizations = await invoke("viewer_organizations");
    organization.replaceChildren(new Option("Select organisation", ""));
    for (const item of organizations)
      organization.add(new Option(item.name, item.id));
    const savedId = organizations.some((item) => item.id === status.selectedOrganizationId)
      ? status.selectedOrganizationId : "";
    const selectedId = savedId ||
      (organizations.some((item) => item.id === preferredOrganizationId) ? preferredOrganizationId : "") ||
      (organizations.length === 1 ? organizations[0].id : "");
    if (selectedId && selectedId !== status.selectedOrganizationId)
      await invoke("viewer_select_organization", { organizationId: selectedId });
    organization.value = selectedId;
    updateContinue();
    await inspectStartupFile();
    if (!selectedId && stage === "file") showStage("access");
  } catch {
    signedIn = false;
    fileAccess = undefined;
    updateContinue();
    clearPreview();
    binding.textContent = "No protected file selected yet.";
    openingActions.hidden = true;
    openFile.disabled = true;
    openFromReveal.disabled = true;
    organizationField.hidden = true;
    organization.disabled = true;
    signOut.hidden = true;
    signIn.hidden = false;
    account.textContent = "Could not check your session. Sign in again.";
    showStage("access");
  }
}

signOut.addEventListener("click", async () => {
  autoAdvanceSuppressed = true;
  signingOut = true;
  signOut.disabled = true;
  signOut.textContent = "Sign out";
  clearPreview();
  showStage("file");
  binding.textContent = "No protected file selected yet.";
  openingActions.hidden = true;
  openFile.disabled = true;
  openFromReveal.disabled = true;
  pairingCode.textContent = "";
  account.textContent = "Signing out…";
  let failed = false;
  try {
    await invoke("viewer_sign_out");
  } catch {
    failed = true;
  } finally {
    signingOut = false;
    signOut.disabled = false;
    await refresh();
    if (failed) {
      account.textContent = "Could not clear the saved session. Try again.";
      signOut.hidden = false;
      signOut.textContent = "Retry sign-out";
    }
  }
});

signIn.addEventListener("click", async () => {
  signIn.disabled = true;
  account.textContent = "Complete sign-in in your browser…";
  try {
    await invoke("viewer_sign_in");
    await refresh();
  } catch {
    account.textContent = "Sign-in unavailable.";
  } finally {
    signIn.disabled = false;
  }
});

organization.addEventListener("change", async () => {
  autoAdvanceSuppressed = false;
  if (!organization.value) {
    openingActions.hidden = true;
    openFile.disabled = true;
    openFromReveal.disabled = true;
    binding.textContent = "Select an organisation to check this file.";
    clearPreview();
    updateContinue();
    return;
  }
  try {
    await invoke("viewer_select_organization", {
      organizationId: organization.value,
    });
    await inspectStartupFile();
    updateContinue();
  } catch {
    account.textContent = "Organisation selection failed.";
  }
});

async function inspectStartupFile(preserveResult = false) {
  if (signingOut) return;
  openFile.disabled = true;
  openFromReveal.disabled = true;
  openingActions.hidden = true;
  if (preserveResult) closeFile.disabled = true;
  else clearPreview();
  if (!preserveResult && stage === "file")
    binding.textContent = "Checking protected file…";
  fileAccess = undefined;
  updateContinue();
  const generation = previewGeneration;
  try {
    const access = await invoke("viewer_inspect_startup_file");
    if (signingOut || generation !== previewGeneration) return;
    fileAccess = access;
    const organisationName = organization.selectedOptions[0]?.textContent;
    const expiry = access.expiresAt && Number.isFinite(Date.parse(access.expiresAt))
      ? new Date(access.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : "No expiry";
    binding.textContent = [
      "Protected file",
      `Status: ${access.status === "READY" ? "Ready to open" : "Opening unavailable"}`,
      organisationName && organization.value ? `Organisation: ${organisationName}` : null,
      `Approval: ${access.origin === "REVEAL" ? "Business Reveal" : "SafeKey Mobile"}`,
      `Expires: ${expiry}`,
      `Openings available: ${access.allowedUses ?? "Unlimited"}`,
    ].filter(Boolean).join("\n");
    if (access.status !== "READY")
      binding.textContent += "\nThis file cannot be opened. Check its status or choose another file in your file manager.";
    updateContinue();
    scheduleAutoAdvance();
    openFile.disabled = access.status !== "READY";
    openFromReveal.disabled =
      access.status !== "READY" || access.origin !== "REVEAL";
    openFromReveal.hidden = access.origin !== "REVEAL";
    openingActions.hidden = true;
  } catch {
    if (signingOut || generation !== previewGeneration) return;
    binding.textContent = "No verified protected file available.";
    updateContinue();
    if (signedIn && organization.value) {
      account.textContent = "Could not verify this file with the selected organisation. Choose another organisation or open another file.";
      showStage("access");
    }
  }
}

async function openProtectedFile(fromReveal) {
  if (openingPending || fileChangePending || fileAccess?.status !== "READY") return;
  openFile.disabled = true;
  openFromReveal.disabled = true;
  clearPreview();
  const generation = previewGeneration;
  let opened = false;
  let mobileAttempted = !fromReveal;
  openingPending = true;
  const openingId = crypto.randomUUID();
  activeOpeningId = openingId;
  revealOpeningPending = fromReveal;
  closeFile.disabled = false;
  showStage("opening");
  openingProgress.hidden = false;
  openingStatus.textContent = fromReveal
    ? "Waiting for approval in Business Reveal…"
    : "Waiting for SafeKey Mobile approval…";
  openingActions.hidden = true;
  try {
    let preview;
    try {
      preview = await invoke(fromReveal
        ? "viewer_open_startup_file_from_reveal"
        : "viewer_open_startup_file", { openingId });
    } catch (error) {
      revealOpeningPending = false;
      if ((error !== "reveal_delivery_unavailable" && error?.message !== "reveal_delivery_unavailable") ||
          !fromReveal || generation !== previewGeneration || fileChangePending || stage !== "opening") throw error;
      mobileAttempted = true;
      pairingCode.textContent = "";
      openingStatus.textContent = "Active Reveal unavailable. Waiting for SafeKey Mobile approval…";
      preview = await invoke("viewer_open_startup_file", { openingId });
    }
    revealOpeningPending = false;
    if (generation !== previewGeneration) return;
    if (preview.pdf) {
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
    opened = true;
    activeOpeningId = undefined;
    openingProgress.hidden = true;
    resetAdapterProgress();
    showStage("result");
    closeFile.disabled = false;
    if (preview.expiresAt) clearAtExpiry(preview.expiresAt, generation);
  } catch {
    if (generation === previewGeneration) {
      if (pdfSession) invoke("viewer_close_pdf_session", { sessionId: pdfSession }).catch(() => {});
      pdfSession = undefined;
      pdfControls.hidden = true;
      openingProgress.hidden = true;
      openingStatus.textContent = mobileAttempted
        ? "SafeKey Mobile could not open this file. Try again."
        : "The file could not be displayed. This opening may have been used.";
      openingActions.hidden = !mobileAttempted;
      openFile.disabled = !mobileAttempted;
      openFromReveal.disabled = true;
    }
  } finally {
    if (activeOpeningId === openingId) activeOpeningId = undefined;
    pairingCode.textContent = "";
    openingPending = false;
    revealOpeningPending = false;
    if (!opened) {
      const preserveResult = !fileChangePending;
      fileChangePending = false;
      if (preserveResult) {
        // Keep the failure visible while refreshing file eligibility.
        await inspectStartupFile(true);
        if (stage === "opening") {
          openingActions.hidden = !mobileAttempted || fileAccess?.status !== "READY";
          openFile.disabled = !mobileAttempted || fileAccess?.status !== "READY";
        }
      } else {
        showStage("file");
        await refresh(organization.value);
      }
    }
  }
}

openFile.addEventListener("click", () => openProtectedFile(false));
openFromReveal.addEventListener("click", () => openProtectedFile(true));

fileContinue.addEventListener("click", () => {
  if (fileAccess?.status === "READY") {
    autoAdvanceSuppressed = true;
    stopAutoAdvance();
    showStage("access");
  }
});
document.getElementById("access-back").addEventListener("click", () => {
  autoAdvanceSuppressed = true;
  stopAutoAdvance();
  showStage("file");
});
accessContinue.addEventListener("click", () => {
  if (accessContinue.disabled) return;
  autoAdvanceSuppressed = true;
  stopAutoAdvance();
  openProtectedFile(fileAccess.origin === "REVEAL");
});
function cancelOpening() {
  autoAdvanceSuppressed = true;
  if (openingPending) invoke("viewer_cancel_opening").catch(() => {});
  clearPreview();
  showStage("access");
  if (fileChangePending) {
    fileChangePending = false;
    autoAdvanceSuppressed = false;
    showStage("file");
    refresh(organization.value);
  }
}
document.getElementById("cancel-opening").addEventListener("click", cancelOpening);

function closePreview() {
  autoAdvanceSuppressed = true;
  if (openingPending) invoke("viewer_cancel_opening").catch(() => {});
  clearPreview();
  showStage("file");
  if (fileChangePending && !openingPending) {
    fileChangePending = false;
    refresh(organization.value);
  } else if (!openingPending) {
    inspectStartupFile();
  }
}
closeFile.addEventListener("click", closePreview);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && stage === "result") {
    event.preventDefault();
    closePreview();
  }
});

window.__TAURI__.event.listen("workspace-close-failed", () => {
  document.getElementById("close-status").hidden = false;
});

window.__TAURI__.event.listen("workspace-adapter-progress", ({ payload }) => showAdapterProgress(payload));

window.__TAURI__.event.listen("viewer-startup-file", () => {
  autoAdvanceSuppressed = false;
  fileChangePending = true;
  if (!openingPending) {
    fileChangePending = false;
    clearPreview();
    showStage("file");
    refresh(organization.value);
  }
});

window.__TAURI__.event.listen("viewer-pairing-code", ({ payload }) => {
  if (openingPending && revealOpeningPending && /^[0-9a-f]{12}$/i.test(payload)) {
    openingStatus.textContent = "Pairing code ready. Waiting for approval in Business Reveal…";
    pairingCode.textContent = `Enter this code in Business Reveal: ${payload.toUpperCase()}`;
  }
});

async function start() {
  invoke("viewer_version").then((version) => {
    document.getElementById("app-version").textContent = `v${version}`;
  }).catch(() => {});
  await refresh();
  if (signIn.hidden) return;
  signIn.disabled = true;
  account.textContent = "Checking your SafeID session…";
  try {
    await invoke("viewer_try_browser_sign_in");
  } catch {
    // Keep manual sign-in available when the browser session cannot be used.
  } finally {
    signIn.disabled = false;
    await refresh();
  }
}

start();
