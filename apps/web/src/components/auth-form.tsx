"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signIn, signUp } from "@/lib/auth-client";
import { ThemeToggle } from "@/components/theme-toggle";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);
  const isSignUp = mode === "sign-up";

  async function submit(formData: FormData) {
    if (isPending) return;
    setError("");
    setIsPending(true);

    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const name = String(formData.get("name") ?? "").trim() || email.split("@")[0];

    try {
      const result = isSignUp
        ? await signUp.email({ email, password, name })
        : await signIn.email({ email, password });

      if (result?.error) {
        const message =
          result.error.message ??
          (result.error.code ? `Authentication failed (${result.error.code})` : "Authentication failed");
        setError(message);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not reach authentication service. Check your connection and try again."
      );
    } finally {
      setIsPending(false);
    }
  }

  function clearError() {
    if (error) setError("");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-surface px-6 text-foreground">
      <section className="w-full max-w-md rounded-lg border border-line bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="text-lg font-semibold">
            Tuniq
          </Link>
          <ThemeToggle />
        </div>
        <h1 className="mt-8 text-2xl font-semibold tracking-tight">
          {isSignUp ? "Create your workspace" : "Sign in"}
        </h1>
        <form action={submit} className="mt-6 space-y-4" aria-busy={isPending}>
          <fieldset disabled={isPending} className="contents">
            {isSignUp ? (
              <label className="block text-sm font-medium">
                Name
                <input
                  name="name"
                  autoComplete="name"
                  onChange={clearError}
                  className="mt-2 w-full rounded-md border border-line bg-background px-3 py-2 disabled:opacity-60"
                  required
                />
              </label>
            ) : null}
            <label className="block text-sm font-medium">
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                onChange={clearError}
                aria-invalid={Boolean(error)}
                className="mt-2 w-full rounded-md border border-line bg-background px-3 py-2 disabled:opacity-60 aria-[invalid=true]:border-danger"
                required
              />
            </label>
            <label className="block text-sm font-medium">
              Password
              <input
                name="password"
                type="password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                onChange={clearError}
                aria-invalid={Boolean(error)}
                className="mt-2 w-full rounded-md border border-line bg-background px-3 py-2 disabled:opacity-60 aria-[invalid=true]:border-danger"
                minLength={8}
                required
              />
            </label>
            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger"
              >
                <svg
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v4" />
                  <path d="M12 16h.01" />
                </svg>
                <span>{error}</span>
              </div>
            ) : null}
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? (
                <>
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="9"
                      stroke="currentColor"
                      strokeOpacity="0.25"
                      strokeWidth="2.5"
                    />
                    <path
                      d="M21 12a9 9 0 0 0-9-9"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeWidth="2.5"
                    />
                  </svg>
                  {isSignUp ? "Creating account..." : "Signing in..."}
                </>
              ) : isSignUp ? (
                "Create account"
              ) : (
                "Sign in"
              )}
            </button>
          </fieldset>
        </form>
        <p className="mt-5 text-sm text-muted">
          {isSignUp ? "Already have an account?" : "Need an account?"}{" "}
          <Link className="font-semibold text-foreground" href={isSignUp ? "/sign-in" : "/sign-up"}>
            {isSignUp ? "Sign in" : "Sign up"}
          </Link>
        </p>
      </section>
    </main>
  );
}
