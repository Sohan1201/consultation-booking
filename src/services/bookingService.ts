
import { DateTime } from "luxon";
import { PoolClient } from "pg";
import { checkQuestion } from "./questionSafety";

export class BookingError extends Error {
  constructor(
    public status: number,
    public code: string
  ) {
    super(code);
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
  const slotResult = await client.query(
    `SELECT id, start_at, duration_minutes
     FROM slots WHERE id = $1`,
    [slotId]
  );

  if (!slotResult.rowCount) {
    throw new BookingError(404, "SLOT_NOT_FOUND");
  }

  
const slot = slotResult.rows[0];
const start = DateTime.fromJSDate(slot.start_at, { zone: "utc" });
const end = start.plus({ minutes: slot.duration_minutes });

const day = start.setZone(timezone);
const dayStart = day.startOf("day").toUTC().toISO();
const dayEnd = day.plus({ days: 1 }).startOf("day").toUTC().toISO();

const dailyCount = await client.query(
  `SELECT COUNT(*)::int AS total
   FROM bookings b
   JOIN slots s ON s.id = b.slot_id
   WHERE b.user_id = $1
     AND b.status = 'confirmed'
     AND s.start_at >= $2::timestamptz
     AND s.start_at < $3::timestamptz
     AND ($4::uuid IS NULL OR b.id <> $4::uuid)`,
  [userId, dayStart, dayEnd, excludeBookingId ?? null]
);

if (dailyCount.rows[0].total >= 2) {
  throw new BookingError(409, "DAILY_SESSION_LIMIT");
}



  if (start.toMillis() <= Date.now()) {
    throw new BookingError(409, "SLOT_IN_THE_PAST");
  }

  
  
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


 
  for (const booking of existing.rows) {
    const existingStart = DateTime.fromJSDate(
      booking.start_at, { zone: "utc" }
    );
    const existingEnd = existingStart.plus({
      minutes: booking.duration_minutes
    });

    const gap = Math.max(
      start.toMillis() - existingEnd.toMillis(),
      existingStart.toMillis() - end.toMillis()
    );

    if (gap < 2 * 60 * 60 * 1000) {
      throw new BookingError(409, "TWO_HOUR_GAP_REQUIRED");
    }
  }

  return slot;
}
