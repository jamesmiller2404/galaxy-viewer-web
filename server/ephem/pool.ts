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

const DEFAULT_WORKER_TIMEOUT_MS = 60_000;
const WORKER_TIMEOUT_MS = Number.isFinite(Number(process.env.WORKER_TIMEOUT_MS))
  ? Number(process.env.WORKER_TIMEOUT_MS)
  : DEFAULT_WORKER_TIMEOUT_MS;

export class WorkerPool {
  private readonly workers: WorkerSlot[];
  private readonly queue: Task[] = [];
  private readonly pending = new Map<number, { resolve: Task["resolve"]; reject: Task["reject"]; slot: WorkerSlot }>();
  private nextId = 1;

  constructor(size: number, workerUrl: URL) {
    const count = Math.max(1, size);
    this.workers = Array.from({ length: count }, () => {
      const baseExecArgv = process.execArgv;
      const cleanedExecArgv: string[] = [];
      for (let i = 0; i < baseExecArgv.length; i += 1) {
        const arg = baseExecArgv[i];
        if (arg === "--import" || arg === "--loader") {
          i += 1;
          continue;
        }
        if (arg.startsWith("--import=") || arg.startsWith("--loader=")) {
          continue;
        }
        cleanedExecArgv.push(arg);
      }
      const execArgv = [...cleanedExecArgv, "--loader", "tsx"];
      const worker = new Worker(workerUrl, {
        type: "module",
        execArgv
      });
      const slot = { worker, busy: false };
      worker.on("online", () => {
        console.log("[WorkerPool] worker online");
      });
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
        console.error("[WorkerPool] worker error", error);
        this.failAll(error);
      });
      worker.on("exit", (code) => {
        console.error(`[WorkerPool] worker exited with code ${code ?? "unknown"}`);
      });
      return slot;
    });
  }

  runTask<T>(type: Task["type"], args: Task["args"]): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const pending = this.pending.get(task.id);
        if (!pending) return;
        this.pending.delete(task.id);
        pending.slot.busy = false;
        pending.reject(new Error(`Worker task ${task.id} timed out after ${WORKER_TIMEOUT_MS}ms`));
        this.drainQueue();
      }, WORKER_TIMEOUT_MS);
      const task: Task = {
        id: this.nextId++,
        type,
        args,
        resolve: (value) => {
          clearTimeout(timeoutId);
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timeoutId);
          reject(reason);
        }
      };
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
    try {
      slot.worker.postMessage({ id: task.id, type: task.type, args: task.args });
    } catch (error) {
      this.pending.delete(task.id);
      slot.busy = false;
      task.reject(error);
      this.drainQueue();
    }
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
