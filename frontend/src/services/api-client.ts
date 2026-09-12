import * as C from "@hackrice/contracts";
import type { z } from "zod";

/**
 * Typed HTTP client driven by the shared `httpContracts` table.
 *
 * One generic `request()` rather than a function per endpoint: the contract
 * already carries the method, path, and body/query/response schemas, so the
 * types and the runtime validation both come from the same source.
 *
 * Requests go to a same-origin `/api/*` path, proxied to the API by a Next
 * rewrite. Same-origin matters twice: the server rejects mutations whose
 * `Origin` does not match `APP_URL`, and the Better Auth session cookie is only
 * sent on same-origin requests.
 */

type Contracts = typeof C.httpContracts;
export type Operation = keyof Contracts;

type BodyOf<K extends Operation> = Contracts[K] extends { body: infer S }
  ? S extends z.ZodType
    ? z.infer<S>
    : never
  : never;

type QueryOf<K extends Operation> = Contracts[K] extends { query: infer S }
  ? S extends z.ZodType
    ? z.infer<S>
    : never
  : never;

type ResponseOf<K extends Operation> = Contracts[K] extends { response: infer S }
  ? S extends z.ZodType
    ? z.infer<S>
    : never
  : never;

export interface RequestOptions<K extends Operation> {
  /** Values substituted into `:name` path segments. */
  params?: Record<string, string>;
  body?: BodyOf<K>;
  query?: QueryOf<K>;
  signal?: AbortSignal;
}

/** A structured `{code, requestId}` failure from the API. */
export class ApiRequestError extends Error {
  readonly code: z.infer<typeof C.ErrorCode>;
  readonly requestId: string | undefined;
  readonly status: number;

  constructor(code: z.infer<typeof C.ErrorCode>, status: number, requestId?: string) {
    super(`${code} (${status})`);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

/** Mutations require a UUID `Idempotency-Key`; these operations are exempt. */
const NO_IDEMPOTENCY: ReadonlySet<Operation> = new Set([
  "deleteSession",
  "refreshReceipt",
  "getLearning",
  "rateAnalysis",
]);

function fillPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params[name];
    if (!value) throw new Error(`Missing path parameter "${name}" for ${path}`);
    return encodeURIComponent(value);
  });
}

export async function request<K extends Operation>(
  operation: K,
  options: RequestOptions<K> = {},
): Promise<ResponseOf<K>> {
  const contract = C.httpContracts[operation] as {
    method: string;
    path: string;
    body?: z.ZodType;
    query?: z.ZodType;
    response: z.ZodType;
  };

  let url = fillPath(contract.path, options.params);
  if (contract.query && options.query) {
    const parsed = contract.query.parse(options.query) as Record<string, unknown>;
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(parsed)) search.set(k, String(v));
    url += `?${search}`;
  }

  const headers: Record<string, string> = {};
  const isMutation = !["GET", "HEAD"].includes(contract.method);
  if (isMutation && !NO_IDEMPOTENCY.has(operation)) {
    headers["Idempotency-Key"] = crypto.randomUUID();
  }

  let payload: string | undefined;
  if (contract.body && options.body !== undefined) {
    payload = JSON.stringify(contract.body.parse(options.body));
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method: contract.method,
    headers,
    body: payload,
    // Send the Better Auth session cookie.
    credentials: "include",
    signal: options.signal,
  });

  if (!response.ok) {
    const parsed = C.ApiError.safeParse(await response.json().catch(() => null));
    throw new ApiRequestError(
      parsed.success ? parsed.data.code : "provider_unavailable",
      response.status,
      parsed.success ? parsed.data.requestId : undefined,
    );
  }

  return contract.response.parse(await response.json()) as ResponseOf<K>;
}

export function isApiError(error: unknown, code?: z.infer<typeof C.ErrorCode>): error is ApiRequestError {
  return error instanceof ApiRequestError && (code === undefined || error.code === code);
}
