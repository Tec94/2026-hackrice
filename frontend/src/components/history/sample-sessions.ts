import type { z } from "zod";
import type * as C from "@hackrice/contracts";

/** A row in the history list, derived from the API's session list. */
export type SessionRow = z.infer<typeof C.PublicSession>;
