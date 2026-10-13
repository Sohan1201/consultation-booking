
import { Router } from "express";
import { DateTime } from "luxon";
import { z } from "zod";
import { pool } from "../db/pool";

const router = Router();

const createSlotSchema = z.object({
  startAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(15).max(480)
});

const timezoneSchema = z.string().min(1).max(100);

router.post("/practitioners/:id/slots", async (req, res, next) => {
  const parsed = createSlotSchema.safeParse(req.body);
  const practitionerId = req.params.id;

  if (!parsed.success) {
    return res.status(400).json({
      error: "INVALID_SLOT",
      details: parsed.error.issues
    });
  }

  const start = DateTime.fromISO(parsed.data.startAt, { setZone: true });

  if (!start.isValid || start.toUTC().toMillis() <= Date.now()) {
    return res.status(400).json({ error: "INVALID_START_TIME" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Serialize slot creation for this practitioner.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [practitionerId]
    );

    await client.query(
      `INSERT INTO practitioners (id, name)
       VALUES ($1, $1)
       ON CONFLICT (id) DO NOTHING`,
      [practitionerId]
    );

    const startUtc = start.toUTC().toISO();
    const endUtc = start.toUTC()
      .plus({ minutes: parsed.data.durationMinutes })
      .toISO();

    const overlap = await client.query(
      `SELECT 1 FROM slots
       WHERE practitioner_id = $1
         AND start_at < $3::timestamptz
         AND start_at + duration_minutes * INTERVAL '1 minute'
             > $2::timestamptz
       LIMIT 1`,
      [practitionerId, startUtc, endUtc]
    );

    if (overlap.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "SLOT_OVERLAP" });
    }

    const result = await client.query(
      `INSERT INTO slots (practitioner_id, start_at, duration_minutes)
       VALUES ($1, $2, $3)
       RETURNING id, practitioner_id, start_at, duration_minutes`,
      [practitionerId, startUtc, parsed.data.durationMinutes]
    );

    await client.query("COMMIT");
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    return next(error);
  } finally {
    client.release();
  }
});

router.get("/practitioners/:id/slots", async (req, res, next) => {
  const date = req.query.date;
  const timezone = req.header("x-timezone");

  if (typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      typeof timezone !== "string") {
    return res.status(400).json({
      error: "DATE_AND_X_TIMEZONE_REQUIRED"
    });
  }

  const zoneCheck = timezoneSchema.safeParse(timezone);
  const day = DateTime.fromISO(date, { zone: timezone });

  if (!zoneCheck.success || !day.isValid ||
      day.toISODate() !== date) {
    return res.status(400).json({
      error: "INVALID_DATE_OR_TIMEZONE"
    });
  }

  try {
    const startUtc = day.startOf("day").toUTC().toISO();
    const endUtc = day.plus({ days: 1 }).startOf("day").toUTC().toISO();

    const result = await pool.query(
      `SELECT s.id, s.practitioner_id, s.start_at, s.duration_minutes
       FROM slots s
       WHERE s.practitioner_id = $1
         AND s.start_at >= $2
         AND s.start_at < $3
         AND NOT EXISTS (
           SELECT 1 FROM bookings b
           WHERE b.slot_id = s.id AND b.status = 'confirmed'
         )
       ORDER BY s.start_at`,
      [req.params.id, startUtc, endUtc]
    );

    return res.json({
      date,
      timezone,
      slots: result.rows.map((slot) => ({
        ...slot,
        startAt: DateTime.fromJSDate(slot.start_at)
          .setZone(timezone)
          .toISO()
      }))
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
