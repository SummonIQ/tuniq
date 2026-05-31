import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function createSecret(prefix: string, byteLength = 24) {
  return `${prefix}_${randomBytes(byteLength).toString("base64url")}`;
}

export function hashSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function getRelaySecret() {
  if (!process.env.TUNIQ_RELAY_SHARED_SECRET) {
    throw new Error("TUNIQ_RELAY_SHARED_SECRET is required");
  }

  return process.env.TUNIQ_RELAY_SHARED_SECRET;
}

export function verifySharedSecret(secret: string) {
  const expectedSecret = getRelaySecret();

  return (
    secret.length === expectedSecret.length &&
    timingSafeEqual(Buffer.from(secret), Buffer.from(expectedSecret))
  );
}

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

export function createRelayToken(agentId: string, expiresInSeconds = 60 * 60 * 24 * 30) {
  const payload = base64UrlEncode(
    JSON.stringify({
      agentId,
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    })
  );
  const signature = createHmac("sha256", getRelaySecret()).update(payload).digest("base64url");

  return `${payload}.${signature}`;
}

export function verifyRelayToken(token: string, expectedAgentId: string) {
  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return false;
  }

  const expectedSignature = createHmac("sha256", getRelaySecret())
    .update(payload)
    .digest("base64url");

  if (
    signature.length !== expectedSignature.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    return false;
  }

  let parsed: {
    agentId?: string;
    exp?: number;
  };

  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as typeof parsed;
  } catch {
    return false;
  }

  return (
    parsed.agentId === expectedAgentId &&
    typeof parsed.exp === "number" &&
    parsed.exp > Date.now() / 1000
  );
}
