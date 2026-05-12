import { ErrorCode } from "@calcom/lib/errorCodes";
import { HttpError } from "@calcom/lib/http-error";
import { getServerErrorFromUnknown, isPrismaError } from "@calcom/lib/server/getServerErrorFromUnknown";

// Map an error raised by booking persistence (prisma.booking.create and the
// surrounding writes inside the booking-creation transaction) into the booking
// layer's HttpError vocabulary.
//
// P2002 must be detected on the raw Prisma error BEFORE delegating to
// getServerErrorFromUnknown. In production that helper runs `redactError`,
// which replaces Prisma errors with a generic message-only `Error` stripped of
// the `code` field. Any P2002 check that ran after the wrapper-step would see
// `err.cause.code === undefined`, miss the unique-constraint signal, and let
// the 409 BookingConflict mapping silently regress to a 400 in production.
export function mapBookingPersistenceError(rawError: unknown): HttpError {
  if (isPrismaError(rawError) && rawError.code === "P2002") {
    return new HttpError({
      statusCode: 409,
      message: ErrorCode.BookingConflict,
    });
  }
  return getServerErrorFromUnknown(rawError);
}
