import { mkdir, open, readFile, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Id } from "@hackrice/contracts";

export class Recordings {
  private handles = new Map<string, FileHandle>();
  readonly directory: string;
  constructor(directory: string) { this.directory = resolve(directory); }
  private path(id: string) { return join(this.directory, `${Id.parse(id)}.pcm`); }
  async start(id: string) {
    await mkdir(this.directory, { recursive: true });
    this.handles.set(id, await open(this.path(id), "wx", 0o600));
  }
  async append(id: string, pcm: Uint8Array) {
    const handle = this.handles.get(id);
    if (!handle) throw new Error("Recording is not active");
    await handle.writeFile(pcm);
  }
  async finish(id: string) {
    const handle = this.handles.get(id);
    this.handles.delete(id);
    await handle?.close();
  }
  async read(id: string) { return readFile(this.path(id)); }
  async delete(id: string) { await this.finish(id); await rm(this.path(id), { force: true }); }
  async close() { await Promise.all([...this.handles.keys()].map((id) => this.finish(id))); }
}
