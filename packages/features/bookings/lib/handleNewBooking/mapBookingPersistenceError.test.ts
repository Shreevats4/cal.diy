import { ErrorCode } from "@calcom/lib/errorCodes";
import { describe, expect, it, vi } from "vitest";
import { mapBookingPersistenceError } from "./mapBookingPersistenceError";

class FakePrismaError extends Error {
  code: string;
  meta?: { target?: string[] };

  constructor(code: string, target?: string[]) {
    super("Prisma constraint failure");
    this.name = "PrismaClientKnownRequestError";
    this.code = code;
    this.meta = target ? { target } : undefined;
  }
}

describe("mapBookingPersistenceError", () => {
  it("maps a P2002 unique-constraint error to a 409 BookingConflict", () => {
    const result = mapBookingPersistenceError(new FakePrismaError("P2002", ["idempotencyKey"]));

    expect(result.statusCode).toBe(409);
    expect(result.message).toBe(ErrorCode.BookingConflict);
  });

  it("still maps P2002 to 409 even when production-style redaction would strip the Prisma code (regression for #29291)", async () => {
    // Simulate production-mode redaction: replace Prisma errors with a
    // message-only Error stripped of the `code` field. Before this helper
    // existed, the inline catch in RegularBookingService inspected
    // `err.cause.code` AFTER getServerErrorFromUnknown had already run
    // redactError, so the 409 mapping silently regressed to a 400 in prod.
    // This test pins the new behavior: we look at the raw error first and
    // do NOT depend on the redacted shape.
    vi.doMock("@calcom/lib/redactError", () => ({
      redactError: () => new Error("An error occurred while querying the database."),
    }));
    vi.resetModules();
    const { mapBookingPersistenceError: patched } = await import("./mapBookingPersistenceError");

    const result = patched(new FakePrismaError("P2002", ["idempotencyKey"]));

    expect(result.statusCode).toBe(409);
    expect(result.message).toBe(ErrorCode.BookingConflict);

    vi.doUnmock("@calcom/lib/redactError");
    vi.resetModules();
  });

  it("maps P2025 (record not found) to 404 via the fallback path", () => {
    const result = mapBookingPersistenceError(new FakePrismaError("P2025"));

    expect(result.statusCode).toBe(404);
  });

  it("maps non-P2002 Prisma errors to 400 via the fallback path", () => {
    const result = mapBookingPersistenceError(new FakePrismaError("P2003"));

    expect(result.statusCode).toBe(400);
  });

  it("delegates non-Prisma errors to getServerErrorFromUnknown", () => {
    const result = mapBookingPersistenceError(new Error("something unrelated exploded"));

    expect(result.statusCode).toBe(500);
  });
});
