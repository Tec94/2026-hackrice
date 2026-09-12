import { randomUUID } from "node:crypto";
import { ReplayService } from "./service.js";
import { Recordings } from "./recordings.js";
import { createSolanaReceiptProvider, type SolanaReceiptProvider } from "./providers/solana.js";
import { createBackboardProvider, type MemoryLink, type MemoryOwner, type LearningRecord } from "./providers/backboard.js";
import type { State } from "./domain.js";

type Backboard = ReturnType<typeof createBackboardProvider>;
type MemoryState = { owner: MemoryOwner; links: MemoryLink[]; records: LearningRecord[]; writeStarted?: boolean; writeCount?: number };

/** One API process owns provider work. Durable placeholders prevent ambiguous writes being silently retried after restart. */
export class Jobs {
  private locks = new Map<string, Promise<unknown>>();
  private expiryTimer?: NodeJS.Timeout;
  private closed = false;
  constructor(public service: ReplayService, private recordings: Recordings,
    public solana: SolanaReceiptProvider = createSolanaReceiptProvider(),
    public backboard: Backboard = createBackboardProvider({}),
    private cancelSession: (id: string) => void = () => {}) {}

  async serial<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(userId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    this.locks.set(userId, next);
    try { return await next; } finally { if (this.locks.get(userId) === next) this.locks.delete(userId); }
  }

  async receipt(userId: string, sessionId: string) {
    return this.serial(userId, async () => {
      const state = await this.service.store.read(userId, sessionId);
      if (!state.commitment) return;
      const persist = async (receipt: NonNullable<State["receipt"]>) => {
        await this.service.store.update(userId, sessionId, (s) => { s.receipt = receipt; });
      };
      if (state.receipt?.status === "confirmed" || state.receipt?.status === "failed") return;
      const receipt = await this.solana.submit(state.commitment.hash, persist, state.receipt);
      if (receipt.signature && receipt.status !== "confirmed" && receipt.status !== "failed") await this.solana.confirm(receipt, persist);
    });
  }

  private async owner(userId: string): Promise<MemoryOwner | undefined> {
    const db = this.service.store.db;
    const prior = (await db.query("SELECT backboard FROM provider_owners WHERE user_id=$1", [userId])).rows[0]?.backboard;
    if (prior?.owner) return prior.owner;
    if (prior && prior.status !== "unavailable") return;
    await db.query("INSERT INTO provider_owners(user_id,backboard) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET backboard=$2", [userId, JSON.stringify({ status: "pending" })]);
    const result = await this.backboard.createAssistant(userId);
    await db.query("UPDATE provider_owners SET backboard=$2 WHERE user_id=$1", [userId, JSON.stringify(result)]);
    return result.owner;
  }

  private async active(userId: string, sessionId: string) {
    try { await this.service.store.read(userId, sessionId); return true; } catch { return false; }
  }

  private async persistMemory(userId: string, sessionId: string, memory: MemoryState) {
    await this.service.store.db.transaction(async (tx) => {
      const row = (await tx.query("SELECT state,deleting FROM replay_sessions WHERE user_id=$1 AND id=$2 FOR UPDATE", [userId, sessionId])).rows[0];
      if (row && !row.deleting) {
        row.state.backboard = memory;
        row.state.memorySynced = memory.writeStarted === true && memory.writeCount === memory.records.length && memory.links.every((link) => link.status === "stored");
        await this.service.store.save(tx, row.state);
      } else {
        // A provider acknowledgment arriving after local erasure augments cleanup only, never recreates history.
        const deletion = (await tx.query("SELECT id,cleanup,public FROM deletions WHERE user_id=$1 AND session_id=$2 FOR UPDATE", [userId, sessionId])).rows[0];
        if (!deletion) return;
        deletion.cleanup.backboard = memory;
        deletion.public.backboard = "pending";
        deletion.public.status = "pending";
        await tx.query("UPDATE deletions SET cleanup=$2,public=$3 WHERE id=$1", [deletion.id, JSON.stringify(deletion.cleanup), JSON.stringify(deletion.public)]);
      }
    });
  }

  async syncLearning(userId: string, sessionId: string) {
    return this.serial(userId, async () => {
      let state = await this.service.store.read(userId, sessionId);
      if (!state.evaluations.length || state.memorySynced) return;
      const owner = await this.owner(userId);
      if (!owner || !await this.active(userId, sessionId)) return;
      let memory: MemoryState = state.backboard ?? { owner, links: [], records: [], writeStarted: false };
      if (!memory.writeStarted) {
        const records = state.evaluations.flatMap((e) => e.findings.map((finding) => ({
          sourceSessionIds: [sessionId], category: finding.category, reasonCode: finding.reasonCode,
        })));
        memory = { ...memory, owner, records, writeStarted: true, writeCount: 0 };
        await this.persistMemory(userId, sessionId, memory);
      }
      for (let index = memory.writeCount ?? 0; index < memory.records.length; index++) {
        if (!await this.active(userId, sessionId)) return;
        // Track only attempted writes. Unsent later findings must not become unknowable remote copies.
        const linkIndex = memory.links.length;
        memory.links.push({ ...owner, sourceSessionIds: [sessionId], memoryIds: [], threadIds: [], status: "pending" });
        memory.writeCount = index + 1;
        await this.persistMemory(userId, sessionId, memory);
        const result = await this.backboard.remember(owner, memory.records[index]!);
        memory.links[linkIndex] = result.link;
        await this.persistMemory(userId, sessionId, memory);
      }
      for (const link of memory.links) if (link.operationId && link.status === "pending") {
        const operation = await this.backboard.operation(owner, link.operationId);
        if (operation.status === "completed") {
          link.memoryIds = [...new Set([...link.memoryIds, ...operation.memoryIds])];
          link.status = link.memoryIds.length ? "stored" : "pending";
          delete link.operationId;
        }
      }
      await this.persistMemory(userId, sessionId, memory);
    });
  }

  async learning(userId: string, sessionId: string) {
    await this.syncLearning(userId, sessionId);
    return this.serial(userId, async () => {
      await this.service.store.read(userId, sessionId);
      const owner = await this.owner(userId);
      if (!owner) return { status: "unavailable", records: [] };
      const sources = (await this.service.store.db.query("SELECT id,state FROM replay_sessions WHERE user_id=$1 AND deleting=false AND expires_at>$2", [userId, new Date(this.service.store.now())])).rows;
      const tracked: { sessionId: string; memory: MemoryState; placeholder: MemoryLink }[] = [];
      // A Readonly retrieval thread may quote any surviving source. Track the thread against each source before calling out.
      for (const source of sources) {
        if (!source.state.backboard && source.id !== sessionId) continue;
        const memory: MemoryState = source.state.backboard ?? { owner, links: [], records: [], writeCount: 0 };
        const placeholder: MemoryLink = { ...owner, sourceSessionIds: [source.id], memoryIds: [], threadIds: [], status: "pending" };
        memory.links.push(placeholder);
        tracked.push({ sessionId: source.id, memory, placeholder });
        await this.persistMemory(userId, source.id, memory);
      }
      const result = await this.backboard.retrieve(owner);
      for (const item of tracked) {
        item.placeholder.threadIds = result.threadIds;
        if (result.operationId) item.placeholder.operationId = result.operationId;
        if (result.status === "completed") item.placeholder.status = "stored";
        await this.persistMemory(userId, item.sessionId, item.memory);
      }
      await this.service.store.read(userId, sessionId);
      const activeIds = new Set<string>();
      for (const item of tracked) if (await this.active(userId, item.sessionId)) activeIds.add(item.sessionId);
      return { status: result.status, records: result.records.filter((r) => r.sourceSessionIds.every((id) => activeIds.has(id))) };
    });
  }

  async deleteSession(userId: string, sessionId: string) {
    this.cancelSession(sessionId);
    const deletion = await this.service.startDeletion(userId, sessionId);
    // Local erasure must not queue behind an outstanding provider response.
    await this.clean(deletion.id, userId, true);
    void this.serial(userId, () => this.clean(deletion.id, userId)).catch(() => {});
    return this.service.deletion(userId, deletion.id);
  }

  private async clean(id: string, userId: string, localOnly = false) {
    const db = this.service.store.db;
    const row = (await db.query("SELECT session_id,public,cleanup FROM deletions WHERE id=$1 AND user_id=$2", [id, userId])).rows[0];
    if (!row || row.public.status === "completed") return;
    let result = row.public;
    let cleanup = row.cleanup;
    let recordingsDeleted = result.recordings === "deleted";
    // Remove local content immediately; remote acknowledgments do not prolong raw audio/transcript retention.
    if (result.recordings !== "deleted") {
      try {
        for (const recordingId of cleanup.recordings) await this.recordings.delete(recordingId);
        recordingsDeleted = true;
      } catch { recordingsDeleted = false; }
    }
    await db.transaction(async (tx) => {
      const fresh = (await tx.query("SELECT public,cleanup FROM deletions WHERE id=$1 FOR UPDATE", [id])).rows[0]!;
      result = fresh.public;
      cleanup = fresh.cleanup;
      await tx.query("DELETE FROM idempotency WHERE user_id=$1 AND resource_id=$2", [userId, row.session_id]);
      await tx.query("DELETE FROM replay_sessions WHERE id=$1 AND user_id=$2", [row.session_id, userId]);
      result.localRecords = "deleted";
      if (recordingsDeleted) { result.recordings = "deleted"; cleanup.recordings = []; }
      result.status = result.recordings === "deleted" && ["deleted", "not_used"].includes(result.backboard) ? "completed" : "pending";
      await tx.query("UPDATE deletions SET public=$2,cleanup=$3 WHERE id=$1", [id, JSON.stringify(result), JSON.stringify(cleanup)]);
    });
    if (localOnly) return;
    if (cleanup.backboard && !localOnly) {
      const memory = cleanup.backboard as MemoryState;
      const removal = await this.backboard.deleteLinked(memory.owner, memory.links);
      memory.links = removal.links;
      result.backboard = removal.status === "completed" ? "deleted" : "pending";
      if (removal.status === "completed") cleanup.backboard = null;
    }
    result.status = result.localRecords === "deleted" && result.recordings === "deleted" && ["deleted", "not_used"].includes(result.backboard) ? "completed" : "pending";
    await db.query("UPDATE deletions SET public=$2,cleanup=$3 WHERE id=$1", [id, JSON.stringify(result), JSON.stringify(cleanup)]);
  }

  async run() {
    const db = this.service.store.db;
    const rows = (await db.query("SELECT id,user_id,expires_at,deleting FROM replay_sessions")).rows;
    for (const row of rows) {
      if (row.deleting || new Date(row.expires_at).getTime() <= this.service.store.now()) await this.deleteSession(row.user_id, row.id);
      else {
        await this.receipt(row.user_id, row.id);
        await this.syncLearning(row.user_id, row.id);
      }
    }
    const deletions = (await db.query("SELECT id,user_id FROM deletions WHERE public->>'status'='pending'")).rows;
    for (const row of deletions) await this.serial(row.user_id, () => this.clean(row.id, row.user_id));
    await db.query("DELETE FROM idempotency WHERE expires_at<=$1", [new Date(this.service.store.now())]);
    await this.scheduleExpiry();
  }

  async scheduleExpiry() {
    clearTimeout(this.expiryTimer);
    if (this.closed) return;
    const row = (await this.service.store.db.query("SELECT min(expires_at) AS next FROM replay_sessions WHERE deleting=false")).rows[0];
    if (!row?.next) return;
    // Node's setTimeout maximum is a signed 32-bit millisecond integer; not an application retention cap.
    const delay = Math.max(1, Math.min(2_147_483_647, new Date(row.next).getTime() - this.service.store.now()));
    this.expiryTimer = setTimeout(() => { void this.run().catch(() => {}); }, delay);
    this.expiryTimer.unref();
  }

  async close() { this.closed = true; clearTimeout(this.expiryTimer); await Promise.allSettled(this.locks.values()); }
}
