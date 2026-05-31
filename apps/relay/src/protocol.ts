import { createHash, timingSafeEqual } from "node:crypto";

export type TunnelResponseHead = {
  type: "response-head";
  requestId: string;
  status: number;
  headers: Record<string, string>;
};

export type TunnelResponseChunk = {
  type: "response-chunk";
  requestId: string;
  bodyBase64: string;
};

export type TunnelResponseEnd = {
  type: "response-end";
  requestId: string;
};

export type TunnelResponseError = {
  type: "response-error";
  requestId: string;
  message: string;
};

export type TunnelResponseFrame =
  | TunnelResponseHead
  | TunnelResponseChunk
  | TunnelResponseEnd
  | TunnelResponseError;

export function verifyAccessTokenHash(accessTokenHash: string | null, authorization: string | null) {
  if (!accessTokenHash) {
    return true;
  }

  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }

  const token = authorization.slice("Bearer ".length);
  const hash = createHash("sha256").update(token).digest("hex");

  return (
    hash.length === accessTokenHash.length &&
    timingSafeEqual(Buffer.from(hash), Buffer.from(accessTokenHash))
  );
}

export function decodeResponseFrame(message: string): TunnelResponseFrame | null {
  try {
    const parsed = JSON.parse(message) as TunnelResponseFrame;
    if (
      !["response-head", "response-chunk", "response-end", "response-error"].includes(parsed.type) ||
      typeof parsed.requestId !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function createPendingTunnelResponse(timeoutMs: number, onComplete: () => void) {
  let didSendHead = false;
  let isComplete = false;
  let resolveResponse!: (response: Response) => void;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
    },
    cancel() {
      if (!isComplete) {
        isComplete = true;
        clearTimeout(timeout);
        onComplete();
      }
    }
  });
  const response = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  const timeout = setTimeout(() => {
    if (!didSendHead && !isComplete) {
      isComplete = true;
      controller.close();
      resolveResponse(new Response("Tunnel response timed out", { status: 504 }));
      onComplete();
    }
  }, timeoutMs);

  return {
    response,
    applyFrame(frame: TunnelResponseFrame) {
      if (isComplete) {
        return;
      }

      if (frame.type === "response-head") {
        didSendHead = true;
        clearTimeout(timeout);
        resolveResponse(
          new Response(stream, {
            status: frame.status,
            headers: frame.headers
          })
        );
        return;
      }

      if (frame.type === "response-chunk") {
        controller.enqueue(Buffer.from(frame.bodyBase64, "base64"));
        return;
      }

      isComplete = true;
      clearTimeout(timeout);
      onComplete();

      if (frame.type === "response-end") {
        controller.close();
        return;
      }

      if (didSendHead) {
        controller.error(new Error(frame.message));
        return;
      }

      controller.close();
      resolveResponse(new Response(frame.message, { status: 502 }));
    }
  };
}
