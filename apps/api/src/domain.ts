import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type * as C from "@hackrice/contracts";
import type { DecimalPolicy } from "./market.js";

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // User-specified retention.
export class ApiFailure extends Error {
  constructor(public code: z.infer<typeof C.ErrorCode>, public status: number) { super(code); }
}
export const fail = (code: z.infer<typeof C.ErrorCode>, status = 400): never => { throw new ApiFailure(code, status); };
export type State = {
  public: C.Session;
  datasetId: string;
  cutoffTimeMs: number;
  policy: DecimalPolicy;
  snapshots: C.ChartContext[];
  turns: z.infer<typeof C.HistoryTurn>[];
  submissions: z.infer<typeof C.RecordedSubmission>[];
  evaluations: C.AnalysisEvaluation[];
  facts: z.infer<typeof C.Fact>[];
  recordings: z.infer<typeof C.Recording>[];
  events: C.ServerMessage[];
  clientCommands: string[];
  reflection?: z.infer<typeof C.Reflection>;
  receipt?: any;
  commitment?: { salt: string; hash: string; payload: unknown };
  backboard?: any;
  memorySynced?: boolean;
};

export function appendEvent(state: State, event: Record<string, unknown>): C.ServerMessage {
  const message = { ...event, protocolVersion: 1, eventId: randomUUID(), sessionId: state.public.id, sequence: state.events.length + 1 } as C.ServerMessage;
  state.events.push(message);
  return message;
}
