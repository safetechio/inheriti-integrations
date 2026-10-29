/**
 * Registry of best-effort wipe callbacks. Modules holding secret material
 * register a cleanup fn; the controller runs them all on source replacement,
 * logout, cancellation, and app close.
 */
type CleanupTask = () => void | Promise<void>;

class SecureCleanupController {
  #tasks = new Set<CleanupTask>();

  register(task: CleanupTask): () => void {
    this.#tasks.add(task);
    return () => {
      this.#tasks.delete(task);
    };
  }

  async runAll(): Promise<void> {
    const tasks = [...this.#tasks];
    await Promise.allSettled(tasks.map((task) => Promise.resolve().then(task)));
  }

  async runAllStrict(): Promise<void> {
    const tasks = [...this.#tasks];
    await Promise.all(tasks.map((task) => Promise.resolve().then(task)));
  }
}

export const secureCleanup = new SecureCleanupController();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    void secureCleanup.runAll();
  });
}
