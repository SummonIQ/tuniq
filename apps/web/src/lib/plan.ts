export const freeMaxRouteTimeoutMs = 60_000;
export const freeMonthlyTransferLimitBytes = 1_073_741_824;

const proStatuses = new Set(["active", "trialing"]);

export class BillingRequiredError extends Error {
  statusCode = 402;

  constructor(message: string) {
    super(message);
    this.name = "BillingRequiredError";
  }
}

export function isProStatus(status: string | null | undefined) {
  return typeof status === "string" && proStatuses.has(status);
}

export function assertProStatus(status: string | null | undefined, message: string) {
  if (!isProStatus(status)) {
    throw new BillingRequiredError(message);
  }
}

export function isBillingRequiredError(error: unknown): error is BillingRequiredError {
  return error instanceof BillingRequiredError;
}
