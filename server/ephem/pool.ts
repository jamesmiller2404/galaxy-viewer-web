import { Worker } from "node:worker_threads";

type Task = {
  id: number;
  type: "scene" | "orbits";
  args: unknown;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

type WorkerSlot = {
  worker: Worker;
  busy: boolean;
};

export class WorkerPool {
  private readonly workers: WorkerSlot[];
  private readonly queue: Task[] = [];
  private readonly pending = new Map<number, { resolve: Task["resolve"]; reject: Task["reject"]; slot: WorkerSlot }>();
  private nextId = 1;

  constructor(size: number, workerUrl: URL) {
    const count = Math.max(1, size);
    this.workers = Array.from({ length: count }, () => {
      const worker = new Worker(workerUrl, {
        type: "module",
        execArgv: ["--loader", "tsx"]
      });
      const slot = { worker, busy: false };
      worker.on("message", (msg: { id: number; ok: boolean; result?: unknown; error?: string }) => {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        this.pending.delete(msg.id);
        pending.slot.busy = false;
        if (msg.ok) {
          pending.resolve(msg.result);
        } else {
          pending.reject(new Error(msg.error ?? "Worker error"));
        }
        this.drainQueue();
      });
      worker.on("error", (error) => {
        this.failAll(error);
      });
      return slot;
    });
  }

  runTask<T>(type: Task["type"], args: Task["args"]): Promise<T> {
    return new Promise((resolve, reject) => {
      const task: Task = { id: this.nextId++, type, args, resolve, reject };
      const slot = this.workers.find((entry) => !entry.busy);
      if (slot) {
        this.dispatch(slot, task);
      } else {
        this.queue.push(task);
      }
    });
  }

  async close() {
    await Promise.all(this.workers.map((slot) => slot.worker.terminate()));
  }

  private dispatch(slot: WorkerSlot, task: Task) {
    slot.busy = true;
    this.pending.set(task.id, { resolve: task.resolve, reject: task.reject, slot });
    slot.worker.postMessage({ id: task.id, type: task.type, args: task.args });
  }

  private drainQueue() {
    const slot = this.workers.find((entry) => !entry.busy);
    if (!slot) return;
    const task = this.queue.shift();
    if (!task) return;
    this.dispatch(slot, task);
  }

  private failAll(error: Error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
      pending.slot.busy = false;
    }
    this.pending.clear();
  }
}
