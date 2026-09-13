import { mkdir, open, readFile, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Id } from "@hackrice/contracts";
import type { Database } from "./database.js";

export interface RecordingStore {
  start(id: string): Promise<void>;
  append(id: string, pcm: Uint8Array): Promise<void>;
  finish(id: string): Promise<void>;
  read(id: string): Promise<Buffer>;
  delete(id: string): Promise<void>;
  close(): Promise<void>;
}

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

// Commit each incoming frame so a host restart cannot discard accepted audio.
export class DatabaseRecordings implements RecordingStore {
  constructor(private db: Database) {}
  async start(id: string) {
    await this.db.query("INSERT INTO recording_streams(id) VALUES($1)", [Id.parse(id)]);
  }
  async append(id: string, pcm: Uint8Array) {
    await this.db.transaction(async (tx) => {
      const stream = (await tx.query("SELECT finished FROM recording_streams WHERE id=$1 FOR UPDATE", [Id.parse(id)])).rows[0];
      if (!stream || stream.finished) throw new Error("Recording is not active");
      await tx.query("INSERT INTO recording_chunks(recording_id,pcm) VALUES($1,$2)", [id, Buffer.from(pcm)]);
    });
  }
  async finish(id: string) {
    await this.db.query("UPDATE recording_streams SET finished=true WHERE id=$1", [Id.parse(id)]);
  }
  async read(id: string) {
    const rows = (await this.db.query("SELECT pcm FROM recording_chunks WHERE recording_id=$1 ORDER BY sequence", [Id.parse(id)])).rows;
    return Buffer.concat(rows.map((row) => Buffer.from(row.pcm)));
  }
  async delete(id: string) {
    await this.db.query("DELETE FROM recording_streams WHERE id=$1", [Id.parse(id)]);
  }
  async close() {}
}
