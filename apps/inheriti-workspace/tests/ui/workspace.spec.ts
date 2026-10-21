// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

type Handler = (event: { payload: any }) => void;
const handlers = new Map<string, Handler>();
let drop: ((event: { payload: any }) => void) | undefined;

beforeEach(() => {
  vi.resetModules();
  handlers.clear();
  drop = undefined;
  const html = readFileSync("apps/inheriti-workspace/ui/index.html", "utf8");
  document.body.innerHTML = new DOMParser().parseFromString(html.replace(/<script[^>]*><\/script>/g, "").replace(/<link[^>]*>/g, ""), "text/html").body.innerHTML;
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("opening-1" as `${string}-${string}-${string}-${string}-${string}`);
});

function setup(options: {
  hasFile?: boolean;
  signedIn?: boolean;
  origin?: string;
  preview?: unknown;
  opening?: Promise<unknown>;
  guest?: boolean;
  inspectError?: Error;
  emitOnChoose?: boolean;
} = {}) {
  const invoke = vi.fn(async (operation: string) => {
    if (operation === "viewer_window_chrome") return true;
    if (operation === "viewer_version") return "1.0";
    if (operation === "viewer_has_startup_file") return options.hasFile ?? false;
    if (operation === "viewer_choose_file" || operation === "viewer_accept_file") {
      if (options.emitOnChoose) handlers.get("viewer-startup-file")?.({ payload: null });
      return true;
    }
    if (operation === "viewer_status") return { signedIn: options.signedIn ?? true };
    if (operation === "viewer_try_browser_sign_in") return null;
    if (operation === "viewer_sign_in") { options.signedIn = true; return null; }
    if (operation === "viewer_organizations") return [{ id: "org-id", name: "Team" }];
    if (operation === "viewer_inspect_startup_file") {
      if (options.inspectError) throw options.inspectError;
      return { status: "READY", origin: options.origin ?? "INBOX" };
    }
    if (operation === "viewer_guest_preflight") return { supported: options.guest ?? false };
    if (operation.startsWith("viewer_open_startup_file")) return options.opening ?? options.preview ?? { text: "secret", expiresAt: null };
    return null;
  });
  Object.assign(window, { __TAURI__: {
    core: { invoke },
    event: { listen: vi.fn((name: string, handler: Handler) => { handlers.set(name, handler); return Promise.resolve(() => {}); }) },
    webview: { getCurrentWebview: () => ({ onDragDropEvent: (handler: typeof drop) => { drop = handler; return Promise.resolve(() => {}); } }) },
  } });
  return invoke;
}

const element = (id: string) => document.getElementById(id) as HTMLElement;
const calls = (invoke: ReturnType<typeof vi.fn>, op: string) => invoke.mock.calls.filter(([name]) => name === op);

it("always starts at the drop/pick screen and does not authenticate without a file", async () => {
  const invoke = setup({ signedIn: false });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_has_startup_file"));
  expect(element("file-step").hidden).toBe(false);
  expect(element("opening-step").hidden).toBe(true);
  expect(calls(invoke, "viewer_status")).toHaveLength(0);
  expect(calls(invoke, "viewer_sign_in")).toHaveLength(0);
});

it("choosing a file authenticates, verifies and opens automatically once", async () => {
  const invoke = setup({ signedIn: false, emitOnChoose: true });
  await import("../../ui/workspace.js");
  element("choose-file").click();
  await vi.waitFor(() => expect(element("preview-area").hidden).toBe(false));
  expect(calls(invoke, "viewer_sign_in")).toHaveLength(1);
  expect(calls(invoke, "viewer_inspect_startup_file")).toHaveLength(1);
  expect(calls(invoke, "viewer_open_startup_file")).toHaveLength(1);
  expect(calls(invoke, "viewer_select_organization")).toHaveLength(0);
  expect(element("result").textContent).toBe("secret");
});

it("a native drop accepts one protected file and rejects multiple files", async () => {
  const invoke = setup();
  await import("../../ui/workspace.js");
  drop!({ payload: { type: "drop", paths: ["/tmp/one.inheriti", "/tmp/two.inheriti"] } });
  expect(element("file-error").textContent).toContain("one .inheriti");
  expect(calls(invoke, "viewer_accept_file")).toHaveLength(0);
  drop!({ payload: { type: "drop", paths: ["/tmp/one.inheriti"] } });
  await vi.waitFor(() => expect(element("preview-area").hidden).toBe(false));
  expect(invoke).toHaveBeenCalledWith("viewer_accept_file", { path: "/tmp/one.inheriti" });
});

it("shows verification failure at the first screen without requesting an opening", async () => {
  const invoke = setup({ hasFile: true, inspectError: new Error("wrong organisation") });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(element("file-error").hidden).toBe(false));
  expect(element("file-step").hidden).toBe(false);
  expect(calls(invoke, "viewer_open_startup_file")).toHaveLength(0);
  expect(element("reset-file").hidden).toBe(false);
});

it("Cancel stops an opening, clears its file and does not reopen it", async () => {
  let reject!: (error: Error) => void;
  const opening = new Promise((_resolve, rejectOpening) => { reject = rejectOpening; });
  const invoke = setup({ hasFile: true, opening });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(calls(invoke, "viewer_open_startup_file")).toHaveLength(1));
  element("cancel-opening").click();
  reject(new Error("cancelled"));
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_clear_startup_file"));
  expect(invoke).toHaveBeenCalledWith("viewer_cancel_opening");
  expect(element("file-step").hidden).toBe(false);
  expect(calls(invoke, "viewer_open_startup_file")).toHaveLength(1);
});

it("Start over closes a guest session before clearing the file", async () => {
  const invoke = setup({ hasFile: true, guest: true });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(element("preview-area").hidden).toBe(false));
  element("start-over").click();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_clear_startup_file"));
  const closeAt = invoke.mock.calls.findIndex(([name]) => name === "viewer_close_guest_session");
  const clearAt = invoke.mock.calls.findIndex(([name]) => name === "viewer_clear_startup_file");
  expect(closeAt).toBeGreaterThanOrEqual(0);
  expect(closeAt).toBeLessThan(clearAt);
  expect(element("file-step").hidden).toBe(false);
});

it("keeps adapter byte progress during automatic preparation", async () => {
  const opening = new Promise(() => {});
  const invoke = setup({ hasFile: true, opening });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(calls(invoke, "viewer_open_startup_file")).toHaveLength(1));
  handlers.get("workspace-adapter-progress")!({ payload: {
    openingId: "opening-1", phase: "downloading", application: "GridCraft", receivedBytes: 25, totalBytes: 100,
  } });
  expect(element("adapter-status").textContent).toContain("Downloading GridCraft");
  expect(element("opening-progress").getAttribute("aria-valuenow")).toBe("25");
});

it("uses the isolated guest and never falls back to plaintext when guest opening fails", async () => {
  const invoke = setup({ hasFile: true, guest: true });
  invoke.mockImplementation(async (operation: string) => {
    if (operation === "viewer_window_chrome") return true;
    if (operation === "viewer_has_startup_file") return true;
    if (operation === "viewer_status") return { signedIn: true };
    if (operation === "viewer_inspect_startup_file") return { status: "READY", origin: "INBOX" };
    if (operation === "viewer_guest_preflight") return { supported: true };
    if (operation === "viewer_open_startup_file_in_guest") throw new Error("guest failed");
    return null;
  });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(element("file-error").hidden).toBe(false));
  expect(calls(invoke, "viewer_open_startup_file_in_guest")).toHaveLength(1);
  expect(calls(invoke, "viewer_open_startup_file")).toHaveLength(0);
  expect(calls(invoke, "viewer_close_guest_session")).toHaveLength(1);
});

it("uses one SafeKey Mobile opening for a REVEAL-origin file", async () => {
  const invoke = setup({ hasFile: true, origin: "REVEAL" });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(element("preview-area").hidden).toBe(false));
  expect(calls(invoke, "viewer_open_startup_file_from_reveal")).toHaveLength(0);
  expect(calls(invoke, "viewer_open_startup_file")).toHaveLength(1);
});

it("closes a PDF session on Start over", async () => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ putImageData: vi.fn() })) as never;
  Object.assign(globalThis, { ImageData: class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} } });
  const invoke = setup({ hasFile: true, preview: {
    pdf: { sessionId: "pdf-1", pageCount: 2, page: { width: 1, height: 1, rgbaBase64: "AQID/w==" } }, expiresAt: null,
  } });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(element("preview-area").hidden).toBe(false));
  element("start-over").click();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_close_pdf_session", { sessionId: "pdf-1" }));
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_clear_startup_file"));
  expect((element("image-preview") as HTMLCanvasElement).width).toBe(0);
});

it("ignores adapter progress from a stale opening", async () => {
  const opening = new Promise(() => {});
  const invoke = setup({ hasFile: true, opening });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(calls(invoke, "viewer_open_startup_file")).toHaveLength(1));
  handlers.get("workspace-adapter-progress")!({ payload: {
    openingId: "earlier-opening", phase: "downloading", application: "GridCraft", receivedBytes: 50, totalBytes: 100,
  } });
  expect(element("adapter-status").hidden).toBe(true);
});

it("keeps Start over available in the result on systems with native window chrome", async () => {
  const invoke = setup({ hasFile: true });
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (operation: string, args?: unknown) =>
    operation === "viewer_window_chrome" ? false : original(operation, args));
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(element("preview-area").hidden).toBe(false));
  expect(element("window-chrome").hidden).toBe(false);
  expect(element("start-over").hidden).toBe(false);
});

it("Cancel interrupts inspection and permits reopening the same file", async () => {
  let rejectInspection!: (error: Error) => void;
  let firstInspection = true;
  const pendingInspection = new Promise((_resolve, reject) => { rejectInspection = reject; });
  const invoke = setup({ hasFile: true });
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (operation: string, args?: unknown) => {
    if (operation === "viewer_inspect_startup_file" && firstInspection) {
      firstInspection = false;
      return pendingInspection;
    }
    if (operation === "viewer_cancel_opening") rejectInspection(new Error("cancelled"));
    return original(operation, args);
  });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(calls(invoke, "viewer_inspect_startup_file")).toHaveLength(1));
  element("cancel-opening").click();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_clear_startup_file"));
  expect(element("file-step").hidden).toBe(false);
  element("choose-file").click();
  await vi.waitFor(() => expect(element("preview-area").hidden).toBe(false));
  expect(calls(invoke, "viewer_inspect_startup_file")).toHaveLength(2);
  expect(calls(invoke, "viewer_open_startup_file")).toHaveLength(1);
});

it("lets the user choose another file immediately after verification fails", async () => {
  const options: { hasFile: boolean; inspectError?: Error } = {
    hasFile: true, inspectError: new Error("verification failed"),
  };
  const invoke = setup(options);
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(element("file-error").hidden).toBe(false));
  options.inspectError = undefined;
  element("choose-file").click();
  await vi.waitFor(() => expect(element("preview-area").hidden).toBe(false));
  expect(calls(invoke, "viewer_inspect_startup_file")).toHaveLength(2);
  expect(calls(invoke, "viewer_open_startup_file")).toHaveLength(1);
});

it("does not launch interactive sign-in after Cancel during a late status response", async () => {
  let resolveStatus!: (status: { signedIn: boolean }) => void;
  const lateStatus = new Promise<{ signedIn: boolean }>((resolve) => { resolveStatus = resolve; });
  const invoke = setup({ hasFile: true, signedIn: false });
  const original = invoke.getMockImplementation()!;
  let checks = 0;
  invoke.mockImplementation(async (operation: string, args?: unknown) => {
    if (operation === "viewer_status" && ++checks === 2) return lateStatus;
    return original(operation, args);
  });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(checks).toBe(2));
  element("cancel-opening").click();
  resolveStatus({ signedIn: false });
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("viewer_clear_startup_file"));
  expect(calls(invoke, "viewer_sign_in")).toHaveLength(0);
  expect(element("file-step").hidden).toBe(false);
});

it("reports an invalid OS-associated file and keeps the picker available", async () => {
  const invoke = setup();
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (operation: string, args?: unknown) => {
    if (operation === "viewer_has_startup_file") throw new Error("file-opaque-id: invalid path");
    return original(operation, args);
  });
  await import("../../ui/workspace.js");
  await vi.waitFor(() => expect(element("file-error").hidden).toBe(false));
  expect(element("file-error").textContent).toContain("Could not read this .inheriti file");
  expect(element("file-error").textContent).not.toContain("file-opaque-id");
  expect((element("choose-file") as HTMLButtonElement).disabled).toBe(false);
  element("choose-file").click();
  await vi.waitFor(() => expect(element("preview-area").hidden).toBe(false));
});

it("highlights the drop area on enter and clears it on leave or drop", async () => {
  setup();
  await import("../../ui/workspace.js");
  drop!({ payload: { type: "enter", paths: [] } });
  expect(element("file-step").classList.contains("drag-over")).toBe(true);
  drop!({ payload: { type: "leave", paths: [] } });
  expect(element("file-step").classList.contains("drag-over")).toBe(false);
  drop!({ payload: { type: "enter", paths: [] } });
  drop!({ payload: { type: "drop", paths: [] } });
  expect(element("file-step").classList.contains("drag-over")).toBe(false);
});
