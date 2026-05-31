"use client";

import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();

  return (
    <button
      className="rounded-md border border-line px-3 py-2 text-sm font-semibold hover:bg-surface"
      onClick={async () => {
        await signOut();
        router.push("/");
        router.refresh();
      }}
      type="button"
    >
      Sign out
    </button>
  );
}
