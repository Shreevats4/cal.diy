import { ErrorCode } from "@calcom/lib/errorCodes";
import { Prisma } from "@calcom/prisma/client";
import { describe, expect, it } from "vitest";
import { mapBookingPersistenceError } from "./mapBookingPersistenceError";

const PRISMA_VERSION = "6.16.1";

function prismaError(code: string, target?: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Prisma constraint failure: ${code}`, {
    code,
    clientVersion: PRISMA_VERSION,
    meta: target ? { modelName: "Booking", target } : undefined,
  });
}

describe("mapBookingPersistenceError", () => {
  it("maps a P2002 unique-constraint error to a 409 BookingConflict", () => {
    const result = mapBookingPersistenceError(prismaError("P2002", ["idempotencyKey"]));

    expect(result.statusCode).toBe(409);
    expect(result.message).toBe(ErrorCode.BookingConflict);
  });

  it("reads P2002 off the raw Prisma error, not off the post-redaction wrapper (regression for #29291)", () => {
    // In production, getServerErrorFromUnknown runs redactError on Prisma errors,
    // replacing them with a generic message-only Error stripped of the `code` field.
    // The previous inline catch in RegularBookingService checked `err.cause.code`
    // AFTER that wrapper-step, so P2002 became undetectable in production and the
    // 409 BookingConflict mapping silently regressed to a 400. This test pins the
    // ordering — the helper must inspect the raw Prisma error first, before any
    // redaction-prone wrapper has a chance to drop the code.
    const raw = prismaError("P2002", ["idempotencyKey"]);
    expect(raw.code).toBe("P2002");

    const result = mapBookingPersistenceError(raw);

    expect(result.statusCode).toBe(409);
    expect(result.message).toBe(ErrorCode.BookingConflict);
  });

  it("maps P2025 (record not found) to 404 via the fallback path", () => {
    const result = mapBookingPersistenceError(prismaError("P2025"));

    expect(result.statusCode).toBe(404);
  });

  it("maps non-P2002 Prisma errors to 400 via the fallback path", () => {
    const result = mapBookingPersistenceError(prismaError("P2003"));

    expect(result.statusCode).toBe(400);
  });

  it("delegates non-Prisma errors to getServerErrorFromUnknown", () => {
    const result = mapBookingPersistenceError(new Error("something unrelated exploded"));

    expect(result.statusCode).toBe(500);
  });
});
