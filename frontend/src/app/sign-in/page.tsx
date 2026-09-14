"use client";

import { Suspense, useEffect, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Brand } from "@/components/layout/AppHeader";
import { ChartIllustration } from "@/components/landing/ChartIllustration";
import { Button, ErrorBanner, Input } from "@/components/ui";
import {
  getSession,
  safeReturnPath,
  signIn,
  signUp,
} from "@/services/auth-client";

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

  const [mode, setMode] = useState<"sign-in" | "sign-up">(
    params.get("mode") === "sign-up" ? "sign-up" : "sign-in",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let mounted = true;
    void getSession()
      .catch(() => null)
      .then((user) => {
        if (!mounted) return;
        if (user) router.replace(next);
        else setCheckingSession(false);
      });
    return () => {
      mounted = false;
    };
  }, [next, router]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "sign-up") await signUp(name, email, password);
      else await signIn(email, password);
      router.replace(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  if (checkingSession) {
    return (
      <main className="grid min-h-screen place-items-center">
        <p role="status" className="text-ink-muted">
          Checking account…
        </p>
      </main>
    );
  }

  return (
    <main className="page-shell auth-layout">
      <div className="auth-form">
        <div className="mb-10">
          <Brand />
        </div>
        <h1 className="text-title font-semibold tracking-tight text-ink">
          {mode === "sign-in" ? "Sign in" : "Create your account"}
        </h1>
        <p className="mt-1.5 text-base text-ink-muted">
          Your replay is waiting. We’ll bring you straight back to it.
        </p>

        <div
          className="segmented sliding-track auth-tabs mt-6"
          style={
            {
              "--track-count": 2,
              "--active-index": mode === "sign-up" ? 0 : 1,
            } as CSSProperties
          }
        >
          <span className="sliding-highlight" aria-hidden="true" />
          {(["sign-up", "sign-in"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
                setError("");
              }}
            >
              {value === "sign-up" ? "Create account" : "Sign in"}
            </button>
          ))}
        </div>
        <div className="auth-panels mt-7">
          {(["sign-up", "sign-in"] as const).map((panelMode) => (
            <form
              key={panelMode}
              onSubmit={submit}
              className="auth-panel space-y-3"
              data-active={mode === panelMode}
              data-mode={panelMode}
              inert={mode !== panelMode}
              aria-hidden={mode !== panelMode}
            >
              {panelMode === "sign-up" && (
                <div>
                  <label
                    htmlFor={`${panelMode}-name`}
                    className="mb-1.5 block text-base font-medium text-ink"
                  >
                    Name
                  </label>
                  <Input
                    id={`${panelMode}-name`}
                    value={name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setName(e.target.value)
                    }
                    autoComplete="name"
                    required
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor={`${panelMode}-email`}
                  className="mb-1.5 block text-base font-medium text-ink"
                >
                  Email
                </label>
                <Input
                  id={`${panelMode}-email`}
                  type="email"
                  value={email}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setEmail(e.target.value)
                  }
                  autoComplete="email"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor={`${panelMode}-password`}
                  className="mb-1.5 block text-base font-medium text-ink"
                >
                  Password
                </label>
                <Input
                  id={`${panelMode}-password`}
                  type="password"
                  value={password}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setPassword(e.target.value)
                  }
                  autoComplete={
                    panelMode === "sign-in"
                      ? "current-password"
                      : "new-password"
                  }
                  minLength={8}
                  required
                />
              </div>

              {error && (
                <ErrorBanner title="Could not continue" message={error} />
              )}

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={busy}
              >
                {busy
                  ? "Working…"
                  : panelMode === "sign-in"
                    ? "Sign in"
                    : "Create account and continue"}
              </Button>
            </form>
          ))}
        </div>

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
      <section className="w-full">
        <h2 className="text-title font-semibold">How a replay works</h2>
        <p className="mb-6 mt-3 text-ink-muted">
          Study the visible chart. Explain your reasoning. Then reveal the
          hidden horizon.
        </p>
        <ChartIllustration />
      </section>
    </main>
  );
}
