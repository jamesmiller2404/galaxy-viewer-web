export type SpiceApi = {
  furnsh: (path: string) => void;
  spkezr: (target: string, et: number, frame: string, abcorr: string, observer: string) => unknown;
  bodvrd: (body: string, item: string, maxn: number) => unknown;
  pxform: (from: string, to: string, et: number) => unknown;
  str2et: (time: string) => number;
};

export async function loadSpice(): Promise<SpiceApi> {
  try {
    const mod = await import("@gamergenic/js-spice");
    const api = (mod as { spice?: SpiceApi; default?: SpiceApi | { spice?: SpiceApi } }).spice ??
      (mod as { default?: { spice?: SpiceApi } }).default?.spice ??
      (mod.default ?? mod) as SpiceApi;
    if (!api?.spkezr || !api?.furnsh) {
      throw new Error("Missing expected CSPICE bindings.");
    }
    return api;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load @gamergenic/js-spice: ${message}`);
  }
}
