"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button, ErrorBanner, Input } from "@/components/ui";
import { safeReturnPath, signIn, signUp } from "@/services/auth-client";

/**
 * `useSearchParams` opts a route out of static prerendering, so the form is
 * isolated behind Suspense and the page shell stays static.
 */
export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const requestedNext = params.get("next") ?? "/";
  const next = safeReturnPath(requestedNext);

  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "sign-up") await signUp(name, email, password);
      else await signIn(email, password);
      router.push(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center gap-2.5">
          <span aria-hidden="true" className="h-4 w-1.5 rounded-sm bg-accent-400" />
          <span className="text-lead font-semibold tracking-tight text-ink">Chartroom</span>
        </Link>

        <h1 className="text-title font-semibold tracking-tight text-ink">
          {mode === "sign-in" ? "Sign in" : "Create an account"}
        </h1>
        <p className="mt-1.5 text-base text-ink-muted">
          Sessions are private to your account.
        </p>

        <form onSubmit={submit} className="mt-7 space-y-3">
          {mode === "sign-up" && (
            <div>
              <label htmlFor="name" className="mb-1.5 block text-base font-medium text-ink">
                Name
              </label>
              <Input
                id="name"
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                autoComplete="name"
                required
              />
            </div>
          )}

          <div>
            <label htmlFor="email" className="mb-1.5 block text-base font-medium text-ink">
              Email
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-base font-medium text-ink">
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              minLength={8}
              required
            />
          </div>

          {error && <ErrorBanner title="Could not continue" message={error} />}

          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="mt-5 text-base text-ink-muted">
          {mode === "sign-in" ? "No account yet?" : "Already have an account?"}{" "}
          <button
            onClick={() => {
              setMode(mode === "sign-in" ? "sign-up" : "sign-in");
              setError(null);
            }}
            className="text-accent-300 underline underline-offset-4 hover:text-accent-200"
          >
            {mode === "sign-in" ? "Create one" : "Sign in"}
          </button>
        </p>
      </div>
    </main>
  );
}
