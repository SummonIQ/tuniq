"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Enrollment = {
  agent: {
    id: string;
    name: string;
    enrollmentTokenExpiry: string;
  };
  enrollmentToken: string;
};

export function AgentEnrollmentForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsPending(true);

    const response = await fetch("/api/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ name })
    });

    setIsPending(false);

    if (!response.ok) {
      setError("Could not create enrollment");
      return;
    }

    const body = (await response.json()) as Enrollment;
    setEnrollment(body);
    setName("");
    router.refresh();
  }

  return (
    <div>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <input
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="Steven's MacBook"
          className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
          required
        />
        <button
          disabled={isPending}
          className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-on-accent disabled:opacity-60"
        >
          {isPending ? "Creating..." : "Create enrollment"}
        </button>
      </form>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      {enrollment ? (
        <div className="mt-4 rounded-md border border-line bg-surface p-3">
          <p className="text-xs font-semibold uppercase text-muted">One-time enrollment token</p>
          <code className="mt-2 block break-all rounded bg-card p-2 text-xs">
            {enrollment.enrollmentToken}
          </code>
          <p className="mt-2 text-xs leading-5 text-muted">
            This token is shown once and expires at{" "}
            {new Date(enrollment.agent.enrollmentTokenExpiry).toLocaleString()}.
          </p>
        </div>
      ) : null}
    </div>
  );
}
