"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSession, type AuthUser } from "@/services/auth-client";

export function LandingAccount() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let revision = 0;
    const refresh = async () => {
      const current = ++revision;
      const session = await getSession().catch(() => null);
      if (mounted && current === revision) {
        setUser(session);
        setLoading(false);
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      mounted = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);

  if (loading) return <span className="text-base text-ink-muted" role="status">Checking account…</span>;

  return (
    <Link
      href={user ? "/history" : "/sign-in?next=%2F"}
      aria-label={user ? `Signed in as ${user.name || user.email}. View your record` : "Sign in"}
      className="inline-flex min-h-touch min-w-0 items-center px-2 text-base text-ink-muted transition-colors hover:text-ink motion-reduce:transition-none"
    >
      <span className="truncate">{user ? user.name || user.email : "Sign in"}</span>
    </Link>
  );
}
