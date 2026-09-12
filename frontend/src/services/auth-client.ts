/**
 * Better Auth email/password client.
 *
 * Better Auth owns `/api/auth/*` on the API. These go through the same
 * same-origin proxy as everything else so the session cookie is set on the
 * page's own origin.
 */

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

async function post(path: string, body: unknown): Promise<{ user: AuthUser }> {
  const response = await fetch(`/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(
      (detail as { message?: string } | null)?.message ?? "Authentication failed. Check your details and try again.",
    );
  }
  return response.json();
}

export function signUp(name: string, email: string, password: string) {
  return post("sign-up/email", { name, email, password });
}

export function signIn(email: string, password: string) {
  return post("sign-in/email", { email, password });
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/sign-out", { method: "POST", credentials: "include" });
}

/** Returns the signed-in user, or null when there is no valid session. */
export async function getSession(): Promise<AuthUser | null> {
  const response = await fetch("/api/auth/get-session", { credentials: "include" });
  if (!response.ok) return null;
  const data = (await response.json().catch(() => null)) as { user?: AuthUser } | null;
  return data?.user ?? null;
}
