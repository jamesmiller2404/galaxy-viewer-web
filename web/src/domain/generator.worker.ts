/// <reference lib="webworker" />
import { generateStars } from "./generator";
import { GalaxyParameters } from "./parameters";

type Inbound =
  | { type: "generate"; id: number; params: GalaxyParameters }
  | { type: "terminate" };

type Outbound =
  | { type: "result"; id: number; count: number; buffer: ArrayBuffer }
  | { type: "error"; id: number; message: string };

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (event: MessageEvent<Inbound>) => {
  const msg = event.data;
  if (msg.type === "terminate") {
    ctx.close();
    return;
  }

  if (msg.type !== "generate") return;

  try {
    const stars = await generateStars(msg.params);
    const buffer = stars.data.buffer;
    const payload: Outbound = { type: "result", id: msg.id, count: stars.count, buffer };
    ctx.postMessage(payload, [buffer]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.postMessage({ type: "error", id: msg.id, message } satisfies Outbound);
  }
};
