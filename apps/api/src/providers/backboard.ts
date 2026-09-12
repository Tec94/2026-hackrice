import { z } from "zod";
import { EvaluationFinding, Id, RubricCategory } from "@hackrice/contracts";

export const LearningRecord = z.strictObject({
  sourceSessionIds: z.array(Id).min(1),
  category: RubricCategory,
  reasonCode: EvaluationFinding.shape.reasonCode,
});
export type LearningRecord = z.infer<typeof LearningRecord>;
export type MemoryOwner = { userId: string; assistantId: string };
export type MemoryLink = MemoryOwner & {
  sourceSessionIds: string[];
  memoryIds: string[];
  threadIds: string[];
  operationId?: string;
  status: "pending" | "stored" | "deletion_pending" | "deleted";
};
export type ProviderStatus = "completed" | "pending" | "unavailable" | "failed";
export type AssistantResult = { status: ProviderStatus; owner?: MemoryOwner };
export type MemoryWriteResult = { status: ProviderStatus; link: MemoryLink };
export type MemoryReadResult = { status: ProviderStatus; records: LearningRecord[]; links: MemoryLink[]; threadIds: string[]; operationId?: string };
export type MemoryOperationResult = {
  status: ProviderStatus; operationId: string; memoryIds: string[];
};
export type MemoryDeletionResult = { status: "completed" | "pending"; links: MemoryLink[] };
type Options = { apiKey?: string; fetch?: typeof globalThis.fetch };
type HttpResult = { status: number; data: Record<string, unknown> };
const ownerSchema = z.strictObject({ userId: z.string().min(1), assistantId: Id });
const sourceIds = z.array(Id).min(1);
const apiBase = "https://app.backboard.io/api";
const memorySchemaVersion = "learning_codes_v1";

function recordObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function optionalId(value: unknown): string | undefined {
  const result = Id.safeParse(value);
  return result.success ? result.data : undefined;
}
function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => { const id = optionalId(item); return id ? [id] : []; }) : [];
}
function unique(values: string[]): string[] { return [...new Set(values)]; }

/** Root persists owners/links and serializes sync against session deletion. No raw conversation content is accepted. */
export function createBackboardProvider(options: Options) {
  const request = options.fetch ?? globalThis.fetch;
  const assistants = new Map<string, Promise<AssistantResult>>();

  async function http(path: string, method = "GET", body?: unknown): Promise<HttpResult | undefined> {
    if (!options.apiKey) return undefined;
    try {
      const response = await request(`${apiBase}${path}`, {
        method,
        headers: { "X-API-Key": options.apiKey, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      let data: Record<string, unknown> = {};
      try { data = recordObject(await response.json()); } catch { /* Missing acknowledgments remain unconfirmed. */ }
      return { status: response.status, data };
    } catch { return undefined; }
  }

  function createAssistant(userId: string): Promise<AssistantResult> {
    z.string().min(1).parse(userId);
    const existing = assistants.get(userId);
    if (existing) return existing;
    const creation = (async (): Promise<AssistantResult> => {
      if (!options.apiKey) return { status: "unavailable" };
      const result = await http("/assistants", "POST", {
        name: "Chart learning codes",
        system_prompt: "Stored records contain learning category and reason codes. Do not infer financial outcomes.",
      });
      const assistantId = optionalId(result?.data.assistant_id);
      if (result && result.status >= 200 && result.status < 300 && assistantId) return { status: "completed", owner: { userId, assistantId } };
      // A lost response may have created a remote assistant; do not retry creation implicitly.
      return { status: result && result.status >= 400 ? "failed" : "pending" };
    })();
    assistants.set(userId, creation);
    return creation;
  }

  async function remember(inputOwner: MemoryOwner, input: LearningRecord): Promise<MemoryWriteResult> {
    const owner = ownerSchema.parse(inputOwner);
    const record = LearningRecord.parse(input);
    const link: MemoryLink = { ...owner, sourceSessionIds: unique(record.sourceSessionIds), memoryIds: [], threadIds: [], status: "pending" };
    if (!options.apiKey) return { status: "unavailable", link };
    const result = await http(`/assistants/${owner.assistantId}/memories`, "POST", {
      content: JSON.stringify(record),
      metadata: { schema: memorySchemaVersion, source_session_ids: link.sourceSessionIds },
    });
    if (!result) return { status: "pending", link };
    if (result.status < 200 || result.status >= 300) return { status: "failed", link };
    // The provider publishes an open response schema. Unknown shapes remain pending, never presumed stored.
    const memoryId = optionalId(result.data.memory_id) ?? optionalId(result.data.id);
    const operationId = optionalId(result.data.memory_operation_id) ?? optionalId(result.data.operation_id);
    if (memoryId) link.memoryIds.push(memoryId);
    if (operationId) link.operationId = operationId;
    if (operationId || !memoryId || result.status === 202) return { status: "pending", link };
    const confirmation = await http(`/assistants/${owner.assistantId}/memories/${memoryId}`);
    if (confirmation?.status !== 200) return { status: "pending", link };
    link.status = "stored";
    return { status: "completed", link };
  }

  async function retrieve(inputOwner: MemoryOwner): Promise<MemoryReadResult> {
    const owner = ownerSchema.parse(inputOwner);
    if (!options.apiKey) return { status: "unavailable", records: [], links: [], threadIds: [] };
    const result = await http("/threads/messages", "POST", {
      assistant_id: owner.assistantId,
      content: "Retrieve stored learning category and reason codes.",
      memory: "Readonly", stream: false, web_search: "off",
    });
    const threadId = optionalId(result?.data.thread_id);
    const threadIds = threadId ? [threadId] : [];
    const operationId = optionalId(result?.data.memory_operation_id);
    if (!result || result.status < 200 || result.status >= 300) return { status: result ? "failed" : "pending", records: [], links: [], threadIds, ...(operationId ? { operationId } : {}) };
    const records: LearningRecord[] = [];
    const links: MemoryLink[] = [];
    for (const item of Array.isArray(result.data.retrieved_memories) ? result.data.retrieved_memories : []) {
      const memory = recordObject(item);
      const memoryId = optionalId(memory.id) ?? optionalId(memory.memory_id);
      if (typeof memory.content !== "string" || !memoryId) continue;
      try {
        const parsed = LearningRecord.safeParse(JSON.parse(memory.content));
        if (parsed.success) {
          records.push(parsed.data);
          links.push({ ...owner, sourceSessionIds: parsed.data.sourceSessionIds, memoryIds: [memoryId], threadIds: [], status: "stored" });
        }
      } catch { /* Provider-generated prose and malformed memories are not learning records. */ }
    }
    return { status: threadId ? "completed" : "pending", records, links, threadIds, ...(operationId ? { operationId } : {}) };
  }

  async function operation(inputOwner: MemoryOwner, operationId: string): Promise<MemoryOperationResult> {
    ownerSchema.parse(inputOwner);
    Id.parse(operationId);
    if (!options.apiKey) return { status: "unavailable", operationId, memoryIds: [] };
    const result = await http(`/assistants/memories/operations/${operationId}`);
    if (result?.status !== 200 || result.data.operation_id !== operationId) return { status: "pending", operationId, memoryIds: [] };
    const status = result.data.status === "COMPLETED" ? "completed" : result.data.status === "ERROR" ? "failed" : "pending";
    return { status, operationId, memoryIds: ids(result.data.memory_ids) };
  }

  async function confirmDeleted(path: string, memory: boolean): Promise<boolean> {
    const result = await http(path, "DELETE");
    if (!result || (result.status !== 404 && (result.status < 200 || result.status >= 300))) return false;
    if (result.status !== 404 && memory && result.data.success !== true) return false;
    if (result.status === 202) return false;
    const confirmation = await http(path);
    return confirmation?.status === 404;
  }

  async function deleteLinked(inputOwner: MemoryOwner, inputs: MemoryLink[]): Promise<MemoryDeletionResult> {
    const owner = ownerSchema.parse(inputOwner);
    const links: MemoryLink[] = inputs.map((input) => {
      if (input.userId !== owner.userId || input.assistantId !== owner.assistantId) throw new Error("Memory owner mismatch.");
      const link: MemoryLink = {
        ...owner, sourceSessionIds: sourceIds.parse(input.sourceSessionIds),
        memoryIds: z.array(Id).parse(input.memoryIds), threadIds: z.array(Id).parse(input.threadIds),
        status: input.status === "deleted" ? "deleted" : "deletion_pending",
        ...(input.operationId ? { operationId: Id.parse(input.operationId) } : {}),
      };
      return link;
    });
    if (!options.apiKey) return { status: links.every((link) => link.status === "deleted") ? "completed" : "pending", links };
    for (let index = 0; index < links.length; index++) {
      const link = links[index]!;
      if (link.status === "deleted") continue;
      if (link.operationId) {
        const state = await operation(owner, link.operationId);
        if (state.status !== "completed") continue;
        link.memoryIds = unique([...link.memoryIds, ...state.memoryIds]);
        delete link.operationId;
      }
      // An ambiguous write with no identified copy cannot honestly be declared deleted.
      if (!link.memoryIds.length && !link.threadIds.length) continue;
      let removed = true;
      for (const memoryId of unique(link.memoryIds)) {
        if (!(await confirmDeleted(`/assistants/${owner.assistantId}/memories/${memoryId}`, true))) removed = false;
      }
      for (const threadId of unique(link.threadIds)) {
        if (!(await confirmDeleted(`/threads/${threadId}`, false))) removed = false;
      }
      if (removed) link.status = "deleted";
    }
    return { status: links.every((link) => link.status === "deleted") ? "completed" : "pending", links };
  }

  return { createAssistant, remember, retrieve, operation, deleteLinked };
}
