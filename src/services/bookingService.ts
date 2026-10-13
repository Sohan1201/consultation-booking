import { DateTime } from "luxon";
import { PoolClient } from "pg";
import { checkQuestion } from "./questionSafety";

export class BookingError extends Error {
  constructor(
    public status: number,
    public code: string
  ) {
    super(code);
    this.name = "BookingError";
  }
}

export async function lockUser(
  client: PoolClient,
  userId: string
) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    [`booking-user:${userId}`]
  );
}

export async function validateQuestion(question: string) {
  const result = checkQuestion(question);

  if (!result.allowed) {
    throw new BookingError(422, result.reasonCode);
  }
}

export async function validateSchedule(
  client: PoolClient,
  userId: string,
  slotId: string,
  timezone: string,
  excludeBookingId?: string
) {
  // 1. Find the requested slot.
  const slotResult = await client.query(
    `SELECT id, start_at, duration_minutes
     FROM slots
     WHERE id = $1`,
    [slotId]
  );

  if (!slotResult.rowCount) {
    throw new BookingError(404, "SLOT_NOT_FOUND");
  }

  const slot = slotResult.rows[0];

  const start = DateTime.fromJSDate(slot.start_at, {
    zone: "utc"
  });

  const end = start.plus({
    minutes: slot.duration_minutes
  });

  // 2. Reject slots that have already started.
  if (start.toMillis() <= Date.now()) {
    throw new BookingError(409, "SLOT_IN_THE_PAST");
  }

  // 3. Calculate the proposed session's local calendar day.
  const day = start.setZone(timezone);

  const dayStart = day
    .startOf("day")
    .toUTC()
    .toISO();

  const dayEnd = day
    .plus({ days: 1 })
    .startOf("day")
    .toUTC()
    .toISO();

  if (!dayStart || !dayEnd) {
    throw new BookingError(400, "INVALID_TIMEZONE_OR_DATE");
  }

  // 4. Enforce a maximum of two confirmed sessions per local day.
  // Exclude the current booking when rescheduling.
  const dailyCount = await client.query(
    `SELECT COUNT(*)::int AS total
     FROM bookings b
     JOIN slots s ON s.id = b.slot_id
     WHERE b.user_id = $1
       AND b.status = 'confirmed'
       AND s.start_at >= $2::timestamptz
       AND s.start_at < $3::timestamptz
       AND ($4::uuid IS NULL OR b.id <> $4::uuid)`,
    [
      userId,
      dayStart,
      dayEnd,
      excludeBookingId ?? null
    ]
  );

  if (dailyCount.rows[0].total >= 2) {
    throw new BookingError(409, "DAILY_SESSION_LIMIT");
  }

  // 5. Find existing sessions that could violate the two-hour gap.
  const existing = await client.query(
    `SELECT s.start_at, s.duration_minutes
     FROM bookings b
     JOIN slots s ON s.id = b.slot_id
     WHERE b.user_id = $1
       AND b.status = 'confirmed'
       AND s.start_at < $3::timestamptz
       AND s.start_at + s.duration_minutes * INTERVAL '1 minute'
           > $2::timestamptz
       AND ($4::uuid IS NULL OR b.id <> $4::uuid)
     FOR UPDATE OF b`,
    [
      userId,
      start.minus({ hours: 2 }).toUTC().toISO(),
      end.plus({ hours: 2 }).toUTC().toISO(),
      excludeBookingId ?? null
    ]
  );

  // 6. Enforce a minimum two-hour gap.
  for (const booking of existing.rows) {
    const existingStart = DateTime.fromJSDate(
      booking.start_at,
      { zone: "utc" }
    );

    const existingEnd = existingStart.plus({
      minutes: booking.duration_minutes
    });

    let gap: number;

    if (start.toMillis() >= existingEnd.toMillis()) {
      gap = start.toMillis() - existingEnd.toMillis();
    } else if (existingStart.toMillis() >= end.toMillis()) {
      gap = existingStart.toMillis() - end.toMillis();
    } else {
      // Overlapping sessions have zero gap.
      gap = 0;
    }

    if (gap < 2 * 60 * 60 * 1000) {
      throw new BookingError(409, "TWO_HOUR_GAP_REQUIRED");
    }
  }

  return slot;
}