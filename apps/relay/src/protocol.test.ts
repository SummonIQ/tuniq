import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { createPendingTunnelResponse, verifyAccessTokenHash } from "./protocol";

describe("route bearer access", () => {
  test("allows public routes", () => {
    expect(verifyAccessTokenHash(null, null)).toBe(true);
  });

  test("rejects missing or wrong bearer tokens", () => {
    const hash = createHash("sha256").update("secret").digest("hex");

    expect(verifyAccessTokenHash(hash, null)).toBe(false);
    expect(verifyAccessTokenHash(hash, "Bearer wrong")).toBe(false);
  });

  test("accepts the matching bearer token", () => {
    const hash = createHash("sha256").update("secret").digest("hex");

    expect(verifyAccessTokenHash(hash, "Bearer secret")).toBe(true);
  });
});

describe("streaming response frames", () => {
  test("streams chunks in order", async () => {
    let completed = false;
    const pending = createPendingTunnelResponse(1_000, () => {
      completed = true;
    });

    pending.applyFrame({
      type: "response-head",
      requestId: "req_1",
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });
    const response = await pending.response;
    pending.applyFrame({
      type: "response-chunk",
      requestId: "req_1",
      bodyBase64: Buffer.from("data: one\n\n").toString("base64")
    });
    pending.applyFrame({
      type: "response-chunk",
      requestId: "req_1",
      bodyBase64: Buffer.from("data: two\n\n").toString("base64")
    });
    pending.applyFrame({ type: "response-end", requestId: "req_1" });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("data: one\n\ndata: two\n\n");
    expect(completed).toBe(true);
  });

  test("times out before response head", async () => {
    const pending = createPendingTunnelResponse(1, () => undefined);
    const response = await pending.response;

    expect(response.status).toBe(504);
  });
});
