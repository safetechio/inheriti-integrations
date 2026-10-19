// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

function option(label: string, value: string) {
  const item = document.createElement("option");
  item.textContent = label;
  item.value = value;
  return item;
}

beforeEach(() => {
  vi.resetModules();
  Object.assign(globalThis, { Option: option });
  document.body.innerHTML = `<header id="window-chrome" hidden><span class="window-title">Inheriti Workspace</span><button id="close-file" hidden disabled></button><div><button id="window-minimize"></button><button id="window-maximize"></button><button id="window-close"></button></div></header><p id="close-status" hidden></p><span id="app-version"></span><div id="file-step"><pre id="binding"></pre><button id="file-continue" disabled></button></div>
    <div id="access-step" hidden><p id="account"></p><button id="sign-in"></button><button id="sign-out" hidden></button><div id="organization-field"><select id="organization"></select></div><button id="access-back"></button><button id="access-continue" disabled></button></div>
    <div id="opening-step" hidden><p id="opening-status"></p><div id="opening-progress" role="progressbar"><span></span></div><p id="adapter-status" hidden></p><div id="opening-actions" hidden><button id="open-file" disabled></button><button id="open-from-reveal" disabled></button></div><button id="cancel-opening"></button><p id="pairing-code"></p></div>
    <div id="preview-area" hidden><div id="pdf-controls" hidden><button id="pdf-previous"></button><span id="pdf-page-label"></span><button id="pdf-next"></button><button id="pdf-fit"></button><button id="pdf-zoom-in"></button><button id="pdf-zoom-out"></button></div><p id="pdf-status" hidden></p><pre id="result"></pre><div id="image-scroll" hidden><canvas id="image-preview" hidden></canvas></div></div>`;
});

function setup(origin = "REVEAL", initialOrganization: string | null = "org", guest: boolean | "error" | "pending" = false, closeFailsOnce = false) {
  let selectedOrganization = initialOrganization;
  let startup = () => {};
  let pairing = (_payload: string) => {};
  let closeFailure = () => {};
  let adapterProgress = (_payload: unknown) => {};
  let resolveOpening: (value: unknown) => void = () => {};
  let rejectOpening: (reason: Error) => void = () => {};
  let resolvePreflight: (value: { supported: boolean }) => void = () => {};
  const preflight = new Promise<{ supported: boolean }>((resolve) => { resolvePreflight = resolve; });
  let closeFailures = closeFailsOnce ? 1 : 0;
  const opening = new Promise((resolve, reject) => { resolveOpening = resolve; rejectOpening = reject; });
  const invoke = vi.fn(async (operation: string) => {
    if (operation === "viewer_status") return { signedIn: true, selectedOrganizationId: selectedOrganization };
    if (operation === "viewer_select_organization") { selectedOrganization = "org"; return null; }
    if (operation === "viewer_organizations") return [{ id: "org", name: "Team" }];
    if (operation === "viewer_inspect_startup_file") return { status: "READY", origin, recipient: "member", expiresAt: null, allowedUses: 1 };
    if (operation === "viewer_guest_preflight") {
      if (guest === "error") throw new Error("workspace VM resources unavailable");
      if (guest === "pending") return preflight;
      return { supported: guest };
    }
    if (operation === "viewer_close_guest_session" && closeFailures > 0) {
      closeFailures--;
      throw new Error("workspace close failed");
    }
    if (operation === "viewer_open_startup_file_in_guest") return opening;
    if (operation.startsWith("viewer_open_startup_file")) return opening;
    if (operation === "viewer_render_pdf_page") return { width: 1, height: 1, rgbaBase64: "AQID/w==" };
    if (operation === "viewer_close_guest_session" || operation === "viewer_close_pdf_session" || operation === "viewer_cancel_opening" || operation === "viewer_show_result" || operation === "viewer_close_result") return null;
    if (operation === "viewer_version") return "1.0";
    throw new Error(operation);
  });
  Object.assign(window, { __TAURI__: { core: { invoke }, event: { listen: vi.fn((event: string, handler: (event: { payload: string }) => void) => {
    if (event === "viewer-startup-file") startup = () => handler({ payload: "" });
    if (event === "viewer-pairing-code") pairing = (payload: string) => handler({ payload });
    if (event === "workspace-close-failed") closeFailure = () => handler({ payload: "" });
    if (event === "workspace-adapter-progress") adapterProgress = (payload) => handler({ payload: payload as string });
  }) } } });
  return { invoke, resolveOpening, rejectOpening, resolvePreflight, startup: () => startup(), pairing: (value: string) => pairing(value), closeFailure: () => closeFailure(), adapterProgress: (payload: unknown) => adapterProgress(payload) };
}

function openingId(invoke: ReturnType<typeof vi.fn>) {
  const call = invoke.mock.calls.find(([operation]: [string]) => operation.startsWith("viewer_open_startup_file"));
  return call?.[1]?.openingId as string;
}

it("shows genuine adapter byte progress and clears it after opening", async () => {
  const { invoke, resolveOpening, adapterProgress } = setup();
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_open_startup_file_from_reveal", { openingId: expect.any(String) }));
  const id = openingId(invoke);
  const progress = document.getElementById("opening-progress")!;
  adapterProgress({ openingId: id, phase: "downloading", application: "GridCraft", receivedBytes: 25, totalBytes: 100 });
  expect(progress.classList.contains("is-determinate")).toBe(true);
  expect(progress.style.getPropertyValue("--progress-width")).toBe("25%");
  expect(progress.getAttribute("aria-valuenow")).toBe("25");
  expect(document.getElementById("adapter-status")!.textContent).toBe("Downloading GridCraft…");
  adapterProgress({ openingId: id, phase: "downloading", application: "GridCraft", receivedBytes: 50 });
  expect(progress.classList.contains("is-determinate")).toBe(false);
  expect(progress.hasAttribute("aria-valuenow")).toBe(false);
  resolveOpening({ text: "secret" });
  await vi.waitFor(() => expect((document.getElementById("preview-area") as HTMLElement).hidden).toBe(false));
  expect((document.getElementById("adapter-status") as HTMLElement).hidden).toBe(true);
});

it("opens an eligible protected file in the guest and closes its session", async () => {
  const { invoke, resolveOpening } = setup("INBOX", "org", true);
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect((document.getElementById("file-continue") as HTMLButtonElement).disabled).toBe(false));
  document.getElementById("file-continue")!.click();
  document.getElementById("access-continue")!.click();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_open_startup_file_in_guest", {
    fromReveal: false, openingId: expect.any(String),
  }));
  resolveOpening({ expiresAt: null });
  await vi.waitFor(() => expect((document.getElementById("preview-area") as HTMLElement).hidden).toBe(false));
  expect(document.getElementById("result")!.textContent).toContain("Inheriti® Workspace");
  expect(invoke.mock.calls.some(([op]) => op === "viewer_open_startup_file")).toBe(false);
  document.getElementById("close-file")!.click();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_close_guest_session"));
});

it("fails closed when an eligible guest cannot be prepared", async () => {
  const { invoke } = setup("INBOX", "org", "error");
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect((document.getElementById("file-continue") as HTMLButtonElement).disabled).toBe(false));
  document.getElementById("file-continue")!.click();
  document.getElementById("access-continue")!.click();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_guest_preflight"));
  expect(invoke.mock.calls.some(([op]) => op.startsWith("viewer_open_startup_file"))).toBe(false);
});

it("does not request an opening after cancellation during guest preflight", async () => {
  const { invoke, resolvePreflight } = setup("INBOX", "org", "pending");
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect((document.getElementById("file-continue") as HTMLButtonElement).disabled).toBe(false));
  document.getElementById("file-continue")!.click();
  document.getElementById("access-continue")!.click();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_guest_preflight"));
  document.getElementById("cancel-opening")!.click();
  resolvePreflight({ supported: true });
  await vi.waitFor(() => expect((document.getElementById("access-step") as HTMLElement).hidden).toBe(false));
  expect(invoke.mock.calls.some(([op]) => op.startsWith("viewer_open_startup_file"))).toBe(false);
});

it("offers close retry when a canceled opening finishes late and teardown fails", async () => {
  const { invoke, resolveOpening } = setup("INBOX", "org", true, true);
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect((document.getElementById("file-continue") as HTMLButtonElement).disabled).toBe(false));
  document.getElementById("file-continue")!.click();
  document.getElementById("access-continue")!.click();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_open_startup_file_in_guest", expect.any(Object)));
  document.getElementById("cancel-opening")!.click();
  resolveOpening({ expiresAt: null });
  await vi.waitFor(() => expect(document.getElementById("result")!.textContent).toContain("Try closing it again"));
  expect((document.getElementById("close-file") as HTMLButtonElement).disabled).toBe(false);
  document.getElementById("close-file")!.click();
  await vi.waitFor(() => expect(invoke.mock.calls.filter(([op]) => op === "viewer_close_guest_session")).toHaveLength(2));
  await vi.waitFor(() => expect((document.getElementById("file-step") as HTMLElement).hidden).toBe(false));
});

it("keeps a failed guest close available for retry", async () => {
  const { invoke, resolveOpening } = setup("INBOX", "org", true, true);
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect((document.getElementById("file-continue") as HTMLButtonElement).disabled).toBe(false));
  document.getElementById("file-continue")!.click();
  document.getElementById("access-continue")!.click();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_open_startup_file_in_guest", expect.any(Object)));
  resolveOpening({ expiresAt: null });
  await vi.waitFor(() => expect((document.getElementById("preview-area") as HTMLElement).hidden).toBe(false));
  document.getElementById("close-file")!.click();
  await vi.waitFor(() => expect((document.getElementById("close-status") as HTMLElement).hidden).toBe(false));
  expect((document.getElementById("close-file") as HTMLButtonElement).disabled).toBe(false);
  document.getElementById("close-file")!.click();
  await vi.waitFor(() => expect(invoke.mock.calls.filter(([op]) => op === "viewer_close_guest_session")).toHaveLength(2));
  await vi.waitFor(() => expect((document.getElementById("file-step") as HTMLElement).hidden).toBe(false));
});

it("offers cleanup retry when guest opening fails and teardown remains pending", async () => {
  const { invoke, rejectOpening } = setup("INBOX", "org", true);
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect((document.getElementById("file-continue") as HTMLButtonElement).disabled).toBe(false));
  document.getElementById("file-continue")!.click();
  document.getElementById("access-continue")!.click();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_open_startup_file_in_guest", expect.any(Object)));
  rejectOpening(new Error("workspace cleanup pending"));
  await vi.waitFor(() => expect((document.getElementById("preview-area") as HTMLElement).hidden).toBe(false));
  expect(document.getElementById("result")!.textContent).toContain("Try closing it again");
  expect((document.getElementById("close-file") as HTMLButtonElement).disabled).toBe(false);
  document.getElementById("close-file")!.click();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_close_guest_session"));
  await vi.waitFor(() => expect((document.getElementById("file-step") as HTMLElement).hidden).toBe(false));
});

it("shows cache hit without download progress and ignores late events after cancel", async () => {
  const { invoke, adapterProgress } = setup();
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_open_startup_file_from_reveal", { openingId: expect.any(String) }));
  const id = openingId(invoke);
  adapterProgress({ openingId: id, phase: "cache-hit", application: "Gnumeric" });
  expect(document.getElementById("adapter-status")!.textContent).toBe("Gnumeric is ready to use.");
  expect(document.getElementById("opening-progress")!.classList.contains("is-determinate")).toBe(false);
  document.getElementById("cancel-opening")!.click();
  adapterProgress({ openingId: id, phase: "downloading", application: "Gnumeric", receivedBytes: 1, totalBytes: 2 });
  expect((document.getElementById("adapter-status") as HTMLElement).hidden).toBe(true);
});

it("shows adapter preparation failure without a technical identifier", async () => {
  const { invoke, adapterProgress } = setup();
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_open_startup_file_from_reveal", { openingId: expect.any(String) }));
  adapterProgress({ openingId: openingId(invoke), phase: "failed", application: "GridCraft" });
  expect(document.getElementById("adapter-status")!.textContent).toBe("GridCraft could not be prepared.");
});

it("ignores a delayed adapter event from an earlier opening", async () => {
  const { invoke, resolveOpening, adapterProgress } = setup("INBOX");
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect((document.getElementById("file-continue") as HTMLButtonElement).disabled).toBe(false));
  document.getElementById("file-continue")!.click();
  document.getElementById("access-continue")!.click();
  const firstId = openingId(invoke);
  resolveOpening({ text: "first" });
  await vi.waitFor(() => expect((document.getElementById("preview-area") as HTMLElement).hidden).toBe(false));
  document.getElementById("close-file")!.click();
  await vi.waitFor(() => expect((document.getElementById("file-step") as HTMLElement).hidden).toBe(false));
  await vi.waitFor(() => expect((document.getElementById("file-continue") as HTMLButtonElement).disabled).toBe(false));
  document.getElementById("file-continue")!.click();
  document.getElementById("access-continue")!.click();
  await vi.waitFor(() => expect(invoke.mock.calls.filter(([operation]: [string]) => operation === "viewer_open_startup_file")).toHaveLength(2));
  const calls = invoke.mock.calls.filter(([operation]: [string]) => operation === "viewer_open_startup_file");
  const secondId = calls.at(-1)?.[1]?.openingId as string;
  expect(secondId).not.toBe(firstId);
  adapterProgress({ openingId: firstId, phase: "downloading", application: "GridCraft", receivedBytes: 50, totalBytes: 100 });
  expect((document.getElementById("adapter-status") as HTMLElement).hidden).toBe(true);
});

it("shows a retry message when secure close fails", async () => {
  const { closeFailure } = setup("INBOX");
  await import("../../ui/workspace.js");
  const status = document.getElementById("close-status") as HTMLElement;
  expect(status.hidden).toBe(true);
  closeFailure();
  expect(status.hidden).toBe(false);
});

it("automatically opens a ready Reveal file with a saved session and shows only the result", async () => {
  const { invoke, resolveOpening, pairing } = setup();
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_open_startup_file_from_reveal", { openingId: expect.any(String) }));
  expect(invoke.mock.calls.filter(([op]) => op.startsWith("viewer_open_startup_file"))).toHaveLength(1);
  expect((document.getElementById("opening-step") as HTMLElement).hidden).toBe(false);
  expect((document.getElementById("file-step") as HTMLElement).hidden).toBe(true);
  pairing("abcdef012345");
  expect(document.getElementById("pairing-code")!.textContent).toContain("ABCDEF012345");
  pairing("invalid");
  expect(document.getElementById("pairing-code")!.textContent).toContain("ABCDEF012345");
  resolveOpening({ text: "secret", expiresAt: null });
  await vi.waitFor(() => expect((document.getElementById("preview-area") as HTMLElement).hidden).toBe(false));
  expect(document.getElementById("result")!.textContent).toBe("secret");
  expect((document.getElementById("image-scroll") as HTMLElement).hidden).toBe(true);
  expect(document.body.classList.contains("result-stage")).toBe(true);
  expect(invoke).toHaveBeenCalledWith("viewer_show_result");
  document.getElementById("close-file")!.click();
  expect((document.getElementById("file-step") as HTMLElement).hidden).toBe(false);
  expect(document.getElementById("result")!.textContent).toBe("");
  expect(document.body.classList.contains("result-stage")).toBe(false);
  expect(invoke).toHaveBeenCalledWith("viewer_close_result");
});

it("routes mobile files to SafeKey and cancels without showing a late result", async () => {
  const { invoke, resolveOpening } = setup("INBOX");
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect((document.getElementById("file-continue") as HTMLButtonElement).disabled).toBe(false));
  document.getElementById("file-continue")!.click();
  document.getElementById("access-continue")!.click();
  expect(invoke).toHaveBeenCalledWith("viewer_open_startup_file", { openingId: expect.any(String) });
  document.getElementById("cancel-opening")!.click();
  expect(invoke).toHaveBeenCalledWith("viewer_cancel_opening");
  resolveOpening({ text: "late secret" });
  await vi.waitFor(() => expect((document.getElementById("access-step") as HTMLElement).hidden).toBe(false));
  expect(document.getElementById("result")!.textContent).toBe("");
});

it("offers explicit SafeKey retry when automatic Reveal fallback also fails", async () => {
  const { invoke, rejectOpening, startup } = setup();
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect((document.getElementById("file-continue") as HTMLButtonElement).disabled).toBe(false));
  rejectOpening(new Error("reveal_delivery_unavailable"));
  await vi.waitFor(() => expect((document.getElementById("opening-actions") as HTMLElement).hidden).toBe(false));
  expect(invoke.mock.calls.filter(([op]) => op.startsWith("viewer_open_startup_file"))).toHaveLength(2);
  expect(invoke).toHaveBeenCalledWith("viewer_open_startup_file", { openingId: expect.any(String) });
  expect((document.getElementById("open-file") as HTMLButtonElement).disabled).toBe(false);
  startup();
  await vi.waitFor(() => expect((document.getElementById("file-step") as HTMLElement).hidden).toBe(false));
});

it("renders bounded RGBA previews and clears pixels on close", async () => {
  const putImageData = vi.fn();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ putImageData })) as never;
  Object.assign(globalThis, { ImageData: class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} } });
  const { resolveOpening } = setup("INBOX");
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect((document.getElementById("file-continue") as HTMLButtonElement).disabled).toBe(false));
  document.getElementById("file-continue")!.click();
  document.getElementById("access-continue")!.click();
  resolveOpening({ image: { width: 1, height: 1, rgbaBase64: "AQID/w==" }, expiresAt: null });
  await vi.waitFor(() => expect(putImageData).toHaveBeenCalledOnce());
  expect([...putImageData.mock.calls[0][0].data]).toEqual([1, 2, 3, 255]);
  document.getElementById("close-file")!.click();
  expect((document.getElementById("image-preview") as HTMLCanvasElement).width).toBe(0);
});

it("offers manual sign-in after browser SSO finds no session", async () => {
  const invoke = vi.fn(async (op: string) => {
    if (op === "viewer_status" || op === "viewer_try_browser_sign_in") return { signedIn: false };
    if (op === "viewer_inspect_startup_file") throw new Error("no file");
    throw new Error(op);
  });
  Object.assign(window, { __TAURI__: { core: { invoke }, event: { listen: vi.fn() } } });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_try_browser_sign_in"));
  await vi.waitFor(() => expect((document.getElementById("sign-in") as HTMLButtonElement).disabled).toBe(false));
  expect((document.getElementById("sign-in") as HTMLButtonElement).hidden).toBe(false);
  expect((document.getElementById("file-continue") as HTMLButtonElement).disabled).toBe(true);
});

it("clears a signed-out session and keeps retry visible if sign-out fails", async () => {
  let fail = true;
  const invoke = vi.fn(async (op: string) => {
    if (op === "viewer_status") return { signedIn: true, selectedOrganizationId: "org" };
    if (op === "viewer_organizations") return [{ id: "org", name: "Team" }];
    if (op === "viewer_inspect_startup_file") return { status: "READY", origin: "INBOX", recipient: "member" };
    if (op === "viewer_sign_out") { if (fail) throw new Error("keychain"); return null; }
    throw new Error(op);
  });
  Object.assign(window, { __TAURI__: { core: { invoke }, event: { listen: vi.fn() } } });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect((document.getElementById("sign-out") as HTMLButtonElement).hidden).toBe(false));
  document.getElementById("sign-out")!.click();
  await vi.waitFor(() => expect(document.getElementById("account")!.textContent).toContain("Could not clear"));
  expect((document.getElementById("sign-out") as HTMLButtonElement).hidden).toBe(false);
  fail = false;
  document.getElementById("sign-out")!.click();
  await vi.waitFor(() => expect(invoke.mock.calls.filter(([op]) => op === "viewer_sign_out")).toHaveLength(2));
});

it("locks Continue when a replacement file cannot be inspected", async () => {
  const { invoke, startup } = setup("INBOX");
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect((document.getElementById("file-continue") as HTMLButtonElement).disabled).toBe(false));
  invoke.mockImplementation(async (op: string) => {
    if (op === "viewer_status") throw new Error("session unavailable");
    throw new Error(op);
  });
  startup();
  document.getElementById("cancel-opening")!.click();
  await vi.waitFor(() => expect((document.getElementById("file-continue") as HTMLButtonElement).disabled).toBe(true));
  expect(document.getElementById("account")!.textContent).toContain("Could not check your session");
  expect((document.getElementById("access-step") as HTMLElement).hidden).toBe(false);
  expect((document.getElementById("sign-in") as HTMLElement).hidden).toBe(false);
});


it("selects the sole organisation before auto-opening", async () => {
  const { invoke } = setup("INBOX", null);
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_select_organization", { organizationId: "org" }));
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_open_startup_file", { openingId: expect.any(String) }));
  expect(invoke.mock.calls.filter(([op]) => op.startsWith("viewer_open_startup_file"))).toHaveLength(1);
});


it("shows organisation recovery when inspection fails with a saved selection", async () => {
  const invoke = vi.fn(async (op: string) => {
    if (op === "viewer_status") return { signedIn: true, selectedOrganizationId: "org" };
    if (op === "viewer_organizations") return [{ id: "org", name: "Team" }, { id: "other", name: "Other" }];
    if (op === "viewer_inspect_startup_file") throw new Error("wrong organisation");
    if (op === "viewer_version") return "1.0";
    throw new Error(op);
  });
  Object.assign(window, { __TAURI__: { core: { invoke }, event: { listen: vi.fn() } } });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(document.getElementById("account")!.textContent).toContain("Choose another organisation"));
  expect((document.getElementById("access-step") as HTMLElement).hidden).toBe(false);
  expect((document.getElementById("organization") as HTMLSelectElement).disabled).toBe(false);
  expect((document.getElementById("file-step") as HTMLElement).hidden).toBe(true);
});

it("refreshes a replacement file when the old preview expires", async () => {
  const { invoke, resolveOpening, startup } = setup("INBOX");
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_open_startup_file", { openingId: expect.any(String) }));
  startup();
  resolveOpening({ text: "old", expiresAt: new Date(Date.now() - 1000).toISOString() });
  await vi.waitFor(() => expect(invoke.mock.calls.filter(([op]) => op === "viewer_inspect_startup_file")).toHaveLength(2));
  expect(document.getElementById("result")!.textContent).toBe("");
  expect(invoke).toHaveBeenCalledWith("viewer_close_result");
});


it("pages a PDF and closes its session when preview closes", async () => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 2000 });
  const putImageData = vi.fn();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ putImageData })) as never;
  Object.assign(globalThis, { ImageData: class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} } });
  const { invoke, resolveOpening } = setup("INBOX");
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_open_startup_file", { openingId: expect.any(String) }));
  resolveOpening({ pdf: { sessionId: "pdf-1", pageCount: 2, page: { width: 1, height: 1, rgbaBase64: "AQID/w==" } }, expiresAt: null });
  await vi.waitFor(() => expect((document.getElementById("pdf-controls") as HTMLElement).hidden).toBe(false));
  expect(document.getElementById("pdf-page-label")!.textContent).toBe("Page 1 of 2");
  expect(document.getElementById("preview-area")!.classList.contains("pdf-preview")).toBe(true);
  document.getElementById("pdf-fit")!.click();
  await vi.waitFor(() => expect(invoke.mock.calls.filter(([op]) => op === "viewer_render_pdf_page")).toHaveLength(1));
  const fitWidth = (invoke.mock.calls.find(([op]) => op === "viewer_render_pdf_page")![1] as { fitPx: number }).fitPx;
  const fitDisplayWidth = parseInt((document.getElementById("image-preview") as HTMLCanvasElement).style.width, 10);
  document.getElementById("pdf-zoom-in")!.click();
  await vi.waitFor(() => expect(invoke.mock.calls.filter(([op]) => op === "viewer_render_pdf_page")).toHaveLength(2));
  const zoomWidth = (invoke.mock.calls.filter(([op]) => op === "viewer_render_pdf_page")[1][1] as { fitPx: number }).fitPx;
  expect(fitWidth).toBe(1600);
  expect(zoomWidth).toBe(1600);
  expect(parseInt((document.getElementById("image-preview") as HTMLCanvasElement).style.width, 10)).toBeGreaterThan(fitDisplayWidth);
  document.getElementById("pdf-next")!.click();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_render_pdf_page", expect.objectContaining({ sessionId: "pdf-1", page: 2 })));
  await vi.waitFor(() => expect(document.getElementById("pdf-page-label")!.textContent).toBe("Page 2 of 2"));
  expect(putImageData).toHaveBeenCalledTimes(4);
  document.getElementById("close-file")!.click();
  expect(invoke).toHaveBeenCalledWith("viewer_close_pdf_session", { sessionId: "pdf-1" });
  expect((document.getElementById("pdf-controls") as HTMLElement).hidden).toBe(true);
  expect(document.getElementById("preview-area")!.classList.contains("pdf-preview")).toBe(false);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
});

it("closes a PDF session when another associated file replaces it", async () => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ putImageData: vi.fn() })) as never;
  Object.assign(globalThis, { ImageData: class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} } });
  const { invoke, resolveOpening, startup } = setup("INBOX");
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_open_startup_file", { openingId: expect.any(String) }));
  resolveOpening({ pdf: { sessionId: "pdf-2", pageCount: 1, page: { width: 1, height: 1, rgbaBase64: "AQID/w==" } }, expiresAt: null });
  await vi.waitFor(() => expect((document.getElementById("pdf-controls") as HTMLElement).hidden).toBe(false));
  startup();
  expect(invoke).toHaveBeenCalledWith("viewer_close_pdf_session", { sessionId: "pdf-2" });
  expect((document.getElementById("preview-area") as HTMLElement).hidden).toBe(true);
});

it("shows the organisation name and human status without recipient IDs or raw values", async () => {
  const invoke = vi.fn(async (op: string) => {
    if (op === "viewer_status") return { signedIn: true, selectedOrganizationId: "org-opaque-id" };
    if (op === "viewer_organizations") return [{ id: "org-opaque-id", name: "Family Office" }];
    if (op === "viewer_inspect_startup_file") return {
      copyId: "copy-opaque-id", status: "EXPIRED", origin: "REVEAL",
      recipient: "member-opaque-id", expiresAt: null, allowedUses: 0,
    };
    if (op === "viewer_version") return "1.0";
    throw new Error(op);
  });
  Object.assign(window, { __TAURI__: { core: { invoke }, event: { listen: vi.fn() } } });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(document.getElementById("binding")!.textContent).toContain("Family Office"));
  const visibleDetails = document.getElementById("binding")!.textContent!;
  expect(visibleDetails).toContain("Opening unavailable");
  expect(visibleDetails).toContain("Business Reveal");
  expect(visibleDetails).not.toMatch(/copy-opaque-id|org-opaque-id|member-opaque-id|EXPIRED|REVEAL|Recipient:/);
});


it("shows the product version in access without overlaying the result", () => {
  const html = readFileSync("apps/inheriti-workspace/ui/index.html", "utf8")
    .replace(/<link rel="stylesheet"[^>]*>/, "");
  const page = new DOMParser().parseFromString(html, "text/html");
  const badge = page.getElementById("app-version")!;
  expect(page.getElementById("access-step")!.contains(badge)).toBe(true);
  expect(page.getElementById("preview-area")!.contains(badge)).toBe(false);
  expect(badge.hidden).toBe(false);
});


it("ignores a stale saved organisation and lets the user choose a current one", async () => {
  let selected = "";
  const invoke = vi.fn(async (op: string, args?: { organizationId: string }) => {
    if (op === "viewer_status") return { signedIn: true, selectedOrganizationId: "removed-org" };
    if (op === "viewer_organizations") return [{ id: "current-a", name: "Family" }, { id: "current-b", name: "Business" }];
    if (op === "viewer_select_organization") { selected = args!.organizationId; return null; }
    if (op === "viewer_inspect_startup_file") {
      if (!selected) throw new Error("organisation required");
      return { status: "READY", origin: "INBOX", recipient: "member" };
    }
    if (op === "viewer_guest_preflight") return { supported: false };
    if (op === "viewer_open_startup_file") return new Promise(() => {});
    if (op === "viewer_version") return "1.0";
    throw new Error(op);
  });
  Object.assign(window, { __TAURI__: { core: { invoke }, event: { listen: vi.fn() } } });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect((document.getElementById("access-step") as HTMLElement).hidden).toBe(false));
  expect((document.getElementById("organization") as HTMLSelectElement).value).toBe("");
  expect(invoke.mock.calls.some(([op]) => op === "viewer_open_startup_file")).toBe(false);
  const select = document.getElementById("organization") as HTMLSelectElement;
  select.value = "current-b";
  select.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_select_organization", { organizationId: "current-b" }));
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_open_startup_file", { openingId: expect.any(String) }));
});


it("falls back from failed Reveal to one automatic SafeKey request", async () => {
  const invoke = vi.fn(async (op: string) => {
    if (op === "viewer_status") return { signedIn: true, selectedOrganizationId: "org" };
    if (op === "viewer_organizations") return [{ id: "org", name: "Team" }];
    if (op === "viewer_inspect_startup_file") return { status: "READY", origin: "REVEAL", recipient: "member" };
    if (op === "viewer_guest_preflight") return { supported: false };
    if (op === "viewer_open_startup_file_from_reveal") throw new Error("reveal_delivery_unavailable");
    if (op === "viewer_open_startup_file") return { text: "opened on mobile", expiresAt: null };
    if (op === "viewer_version") return "1.0";
    if (op === "viewer_show_result") return null;
    throw new Error(op);
  });
  Object.assign(window, { __TAURI__: { core: { invoke }, event: { listen: vi.fn() } } });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(document.getElementById("result")!.textContent).toBe("opened on mobile"));
  expect(invoke.mock.calls.filter(([op]) => op === "viewer_open_startup_file_from_reveal")).toHaveLength(1);
  expect(invoke.mock.calls.filter(([op]) => op === "viewer_open_startup_file")).toHaveLength(1);
  expect((document.getElementById("preview-area") as HTMLElement).hidden).toBe(false);
});

it("does not start mobile fallback after cancelling Reveal", async () => {
  const { invoke, rejectOpening } = setup("REVEAL");
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_open_startup_file_from_reveal", { openingId: expect.any(String) }));
  document.getElementById("cancel-opening")!.click();
  rejectOpening(new Error("reveal_delivery_unavailable"));
  await vi.waitFor(() => expect((document.getElementById("access-step") as HTMLElement).hidden).toBe(false));
  expect(invoke.mock.calls.filter(([op]) => op === "viewer_open_startup_file")).toHaveLength(0);
});


it("uses one accessible custom title bar when native chrome is removed", async () => {
  const invoke = vi.fn(async (op: string) => {
    if (op === "viewer_window_chrome") return true;
    if (op === "viewer_window_action") return null;
    if (op === "viewer_status" || op === "viewer_try_browser_sign_in") return { signedIn: false };
    if (op === "viewer_inspect_startup_file") throw new Error("no file");
    if (op === "viewer_version") return "1.0";
    throw new Error(op);
  });
  Object.assign(window, { __TAURI__: { core: { invoke }, event: { listen: vi.fn() } } });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect((document.getElementById("window-chrome") as HTMLElement).hidden).toBe(false));
  expect(document.body.classList.contains("custom-chrome")).toBe(true);
  document.getElementById("window-minimize")!.click();
  document.getElementById("window-maximize")!.click();
  document.getElementById("window-close")!.click();
  document.getElementById("window-chrome")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  expect(invoke).toHaveBeenCalledWith("viewer_window_action", { action: "minimize" });
  expect(invoke).toHaveBeenCalledWith("viewer_window_action", { action: "toggleMaximize" });
  expect(invoke).toHaveBeenCalledWith("viewer_window_action", { action: "close" });
  expect(invoke).toHaveBeenCalledWith("viewer_window_action", { action: "drag" });
});


it("has one Cancel action during opening", () => {
  const html = readFileSync("apps/inheriti-workspace/ui/index.html", "utf8")
    .replace(/<link rel="stylesheet"[^>]*>/, "");
  const page = new DOMParser().parseFromString(html, "text/html");
  const actions = page.querySelectorAll("#opening-step .step-actions button");
  expect(actions).toHaveLength(1);
  expect(actions[0].id).toBe("cancel-opening");
});


it("keeps Close preview only in the compact top bar and supports Escape", async () => {
  const html = readFileSync("apps/inheriti-workspace/ui/index.html", "utf8")
    .replace(/<link rel="stylesheet"[^>]*>/, "");
  const page = new DOMParser().parseFromString(html, "text/html");
  const close = page.getElementById("close-file")!;
  expect(page.getElementById("window-chrome")!.contains(close)).toBe(true);
  expect(page.getElementById("preview-area")!.querySelector("h2, button#close-file")).toBeNull();
  const { invoke, resolveOpening } = setup("INBOX");
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_open_startup_file", { openingId: expect.any(String) }));
  resolveOpening({ text: "secret", expiresAt: null });
  await vi.waitFor(() => expect((document.getElementById("preview-area") as HTMLElement).hidden).toBe(false));
  expect((document.getElementById("window-chrome") as HTMLElement).hidden).toBe(false);
  expect((document.getElementById("close-file") as HTMLButtonElement).hidden).toBe(false);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect((document.getElementById("preview-area") as HTMLElement).hidden).toBe(true);
  expect((document.getElementById("close-file") as HTMLButtonElement).hidden).toBe(true);
});

it("uses the light Business palette for the Workspace and result", () => {
  const css = readFileSync("apps/inheriti-workspace/ui/style.css", "utf8");
  expect(css).toMatch(/background:\s*#fafcff/i);
  expect(css).toMatch(/--primary:\s*#2962ff/i);
  expect(css).toMatch(/--ink:\s*#101828/i);
  expect(css).toMatch(/body\.result-stage \.preview-area\s*\{\s*background:\s*#fff/i);
  expect(css).not.toContain("#0a1c4d");
});


it("does not retry Mobile after a Reveal post-delivery preview failure", async () => {
  const invoke = vi.fn(async (op: string) => {
    if (op === "viewer_status") return { signedIn: true, selectedOrganizationId: "org" };
    if (op === "viewer_organizations") return [{ id: "org", name: "Team" }];
    if (op === "viewer_inspect_startup_file") return { status: "READY", origin: "REVEAL", recipient: "member" };
    if (op === "viewer_guest_preflight") return { supported: false };
    if (op === "viewer_open_startup_file_from_reveal") throw new Error("isolated PDF preview unavailable");
    if (op === "viewer_open_startup_file") return { text: "must not repeat" };
    if (op === "viewer_version") return "1.0";
    throw new Error(op);
  });
  Object.assign(window, { __TAURI__: { core: { invoke }, event: { listen: vi.fn() } } });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(document.getElementById("opening-status")!.textContent).toContain("may have been used"));
  expect((document.getElementById("opening-actions") as HTMLElement).hidden).toBe(true);
  expect(invoke.mock.calls.filter(([op]) => op === "viewer_open_startup_file_from_reveal")).toHaveLength(1);
  expect(invoke.mock.calls.filter(([op]) => op === "viewer_open_startup_file")).toHaveLength(0);
});
