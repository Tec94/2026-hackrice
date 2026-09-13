"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Archive,
  Check,
  History,
  LayoutGrid,
  LockKeyhole,
  LogOut,
  User,
} from "lucide-react";
import type { Session } from "@hackrice/contracts";
import { getSession, signOut, type AuthUser } from "@/services/auth-client";
import { Presence } from "@/components/ui/Presence";
import { Button } from "@/components/ui";
import { Logo } from "@/components/brand/Logo";
import { SlidingHighlight } from "@/components/ui/SlidingHighlight";

export function Brand() {
  return (
    <Link href="/" className="brand">
      <Logo size={28} decorative />
      Chartroom
    </Link>
  );
}
const states = ["exploring", "submitted", "revealed", "completed"] as const;
export function SessionTrack({
  status,
  revealReady = false,
}: {
  status: Session["status"];
  revealReady?: boolean;
}) {
  const current = states.indexOf(status);
  const pathname = usePathname();
  const transitionKey = pathname.match(/^\/replay\/[^/]+/)?.[0];
  return (
    <nav aria-label="Session progress" className="header-progress">
      <div className="state-track sliding-track">
        <SlidingHighlight
          index={current}
          count={states.length}
          transitionKey={transitionKey}
        />
        <ol>
          {states.map((state, index) => (
            <li
              key={state}
              aria-current={current === index ? "step" : undefined}
            >
              <span className="state-icon">
                {index < current ? (
                  <Check size={11} className="text-bull" />
                ) : index === current ? (
                  <span className="state-dot" />
                ) : state === "revealed" && !revealReady ? (
                  <LockKeyhole size={10} aria-label="Reveal locked" />
                ) : null}
              </span>
              {state[0].toUpperCase() + state.slice(1)}
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
export function AccountMenu() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    void getSession()
      .then(setUser)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const click = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", click);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", click);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        ref={trigger}
        className="icon-well motion-control rounded-full"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <User size={16} />
      </button>
      <Presence open={open} className="account-popover surface">
        {user ? (
          <div className="border-b border-line px-3 py-3">
            <p className="font-semibold text-ink">{user.name}</p>
            <p className="mt-1 break-all text-tiny text-ink-muted">
              {user.email}
            </p>
          </div>
        ) : (
          <Link href="/sign-in">Sign in</Link>
        )}
        {[
          ["/", "Markets", LayoutGrid],
          ["/history", "Your record", History],
          ["/history?view=archived", "Archived sessions", Archive],
        ].map(([href, label, Icon]) => {
          const Glyph = Icon as typeof Archive;
          return (
            <Link
              key={String(href)}
              href={String(href)}
              onClick={() => setOpen(false)}
            >
              <Glyph size={14} />
              {String(label)}
            </Link>
          );
        })}
        {user && (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await signOut();
                setUser(null);
                setOpen(false);
                router.push("/");
                router.refresh();
              } catch {
                setError("Could not sign out. Try again.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <LogOut size={14} />
            {busy ? "Signing out…" : "Sign out"}
          </button>
        )}
        {error && (
          <p role="alert" className="p-2 text-bear">
            {error}
          </p>
        )}
      </Presence>
    </div>
  );
}
export function AppHeader({
  status,
  timeframe,
  horizon,
  revealReady,
  landing = false,
}: {
  status?: Session["status"];
  timeframe?: string;
  horizon?: string;
  revealReady?: boolean;
  landing?: boolean;
}) {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    if (landing)
      void getSession()
        .then((user) => setSignedIn(!!user))
        .catch(() => {});
  }, [landing]);
  return (
    <header className="app-header">
      <Brand />
      {status && (
        <div className="flex items-center gap-2 rounded-xl bg-[#141416] px-3 py-2 text-tiny">
          <b>SOL / USDT</b>
          <span className="text-ink-muted">
            {timeframe} · {horizon}
          </span>
        </div>
      )}
      {status && (
        <div className="header-progress mx-auto">
          <SessionTrack status={status} revealReady={revealReady} />
        </div>
      )}
      <nav className="app-nav" aria-label="Main navigation">
        {landing && !signedIn ? (
          <>
            <Link href="#how" className="hidden sm:block">
              How it works
            </Link>
            <Link href="#coach" className="hidden sm:block">
              The coach
            </Link>
            <Link href="#faq" className="hidden md:block">
              FAQ
            </Link>
            <Link href="/sign-in">Sign in</Link>
            <Link
              href="/sign-in?mode=sign-up"
              className="control-surface motion-control rounded-lg px-4 py-3 font-semibold text-ink"
            >
              Create account
            </Link>
          </>
        ) : (
          <>
            <Link href="/#markets">Markets</Link>
            <Link href="/history">Your record</Link>
            <AccountMenu />
          </>
        )}
      </nav>
    </header>
  );
}
