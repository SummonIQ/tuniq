import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { getPrisma } from "./prisma";

export async function getCurrentUser() {
  const session = await auth.api.getSession({
    headers: await headers()
  });

  return session?.user ?? null;
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/sign-in");
  }

  return getPrisma().user.upsert({
    where: { id: user.id },
    update: {
      email: user.email,
      name: user.name,
      emailVerified: Boolean(user.emailVerified),
      image: user.image
    },
    create: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: Boolean(user.emailVerified),
      image: user.image
    }
  });
}
