// End-to-end verification of the production-mode bug closed by this PR
// (issue #29291).
//
// Why a separate file: redactError reads IS_PRODUCTION at module load via
// `@calcom/lib/constants`, and getServerErrorFromUnknown imports redactError
// at module load. Mocking IS_PRODUCTION for individual tests within the
// regular suite would leak state across tests. Isolating the prod-mode path
// in its own file with a hoisted vi.mock keeps the bug demonstration crisp
// and reproducible.

import { describe, expect, it, vi } from "vitest";

// Force IS_PRODUCTION = true for everything that imports from @calcom/lib/constants
// in this file. Hoisted by vi to run before the imports below.
vi.mock("@calcom/lib/constants", async () => {
  const actual = await vi.importActual<typeof import("@calcom/lib/constants")>("@calcom/lib/constants");
  return {
    ...actual,
    IS_PRODUCTION: true,
  };
});

import { ErrorCode } from "@calcom/lib/errorCodes";
import { getServerErrorFromUnknown } from "@calcom/lib/server/getServerErrorFromUnknown";
import { Prisma } from "@calcom/prisma/client";
import { mapBookingPersistenceError } from "./mapBookingPersistenceError";

function p2002Error(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed on idempotencyKey", {
    code: "P2002",
    clientVersion: "6.16.1",
    meta: { modelName: "Booking", target: ["idempotencyKey"] },
  });
}

describe("issue #29291 root cause — production-mode error mapping", () => {
  it("documents the bug: getServerErrorFromUnknown(P2002) leaks as 400 with the code stripped in production", () => {
    // This is the path the OLD inline catch in RegularBookingService took.
    // It demonstrates WHY the catch failed in production: the wrapper-step
    // ran redactError on the Prisma error, leaving cause.code === undefined.
    const wrapped = getServerErrorFromUnknown(p2002Error());

    expect(wrapped.statusCode).toBe(400);

    const cause = wrapped.cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as { code?: unknown }).code).toBeUndefined();

    // What the old inline catch would have evaluated:
    //   if (err.cause?.code === "P2002") throw 409
    // …with cause.code === undefined, the check is false and the 400 leaks.
    const oldCatchWouldDetectP2002 =
      cause && typeof cause === "object" && "code" in cause && (cause as { code?: string }).code === "P2002";
    expect(oldCatchWouldDetectP2002).toBe(false);
  });

  it("the fix: mapBookingPersistenceError(P2002) returns 409 BookingConflict regardless of production redaction", () => {
    const mapped = mapBookingPersistenceError(p2002Error());

    expect(mapped.statusCode).toBe(409);
    expect(mapped.message).toBe(ErrorCode.BookingConflict);
  });
});
