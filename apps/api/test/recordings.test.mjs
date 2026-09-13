import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectDatabase, migrate } from "../dist/database.js";
import { DatabaseRecordings } from "../dist/recordings.js";

test("database audio survives restart, preserves frame order, and deletes all stored chunks", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "chartroom-recordings-"));
  let db = await connectDatabase({ local: true, localPath: join(directory, "postgres") });
  t.after(async () => {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });
  await migrate(db);
  const id = randomUUID();
  let recordings = new DatabaseRecordings(db);
  await recordings.start(id);
  await assert.rejects(recordings.start(id));
  await recordings.append(id, Uint8Array.from([0, 255, 13]));
  await recordings.append(id, Uint8Array.from([128, 10]));
  await db.close();
  db = await connectDatabase({ local: true, localPath: join(directory, "postgres") });
  await migrate(db);
  recordings = new DatabaseRecordings(db);
  assert.deepEqual(await recordings.read(id), Buffer.from([0, 255, 13, 128, 10]));
  await recordings.finish(id);
  await recordings.finish(id);
  await assert.rejects(recordings.append(id, new Uint8Array([1])), /not active/);
  await recordings.delete(id);
  await recordings.delete(id);
  assert.equal((await db.query("SELECT * FROM recording_chunks WHERE recording_id=$1", [id])).rows.length, 0);
  assert.equal((await db.query("SELECT * FROM recording_streams WHERE id=$1", [id])).rows.length, 0);
  await assert.rejects(recordings.append(id, new Uint8Array([1])), /not active/);
});
