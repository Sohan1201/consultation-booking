
import { Router } from "express";
import { DateTime, IANAZone } from "luxon";
import { z } from "zod";
import { pool } from "../db/pool";
import {
  BookingError,
  lockUser,
  validateQuestion,
  validateSchedule
} from "../services/bookingService";

const router = Router();

function identity(req: import("express").Request) {
  const userId = req.header("x-user-id");
  const timezone = req.header("x-timezone");

  if (!userId || userId.length > 200 ||
      !timezone || !IANAZone.isValidZone(timezone)) {
    throw new BookingError(400, "VALID_USER_AND_TIMEZONE_REQUIRED");
  }

  return { userId, timezone };
}

function sendError(error: unknown, res: import("express").Response) {
  if (error instanceof BookingError) {
    return res.status(error.status).json({ error: error.code });
  }

  console.error(error);
  return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
}

const createSchema = z.object({
  slotId: z.string().uuid(),
  question: z.string().trim().min(1).max(2000)
});

router.post("/", async (req, res) => {
  let client;

  try {
    const { userId, timezone } = identity(req);
    const parsed = createSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "INVALID_BOOKING",
        details: parsed.error.issues
      });
    }

    await validateQuestion(parsed.data.question);

    client = await pool.connect();
    await client.query("BEGIN");
    await lockUser(client, userId);

    const slot = await validateSchedule(
      client, userId, parsed.data.slotId, timezone
    );

    // Serialize booking attempts for the same slot.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [`booking-slot:${parsed.data.slotId}`]
    );

    const result = await client.query(
      `INSERT INTO bookings (slot_id, user_id, question)
       VALUES ($1, $2, $3)
       RETURNING id, slot_id, user_id, question, status, created_at`,
      [slot.id, userId, parsed.data.question]
    );

    await client.query("COMMIT");
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof Error &&
        "code" in error &&
        error.code === "23505") {
      return res.status(409).json({ error: "SLOT_ALREADY_BOOKED" });
    }
    return sendError(error, res);
  } finally {
    client?.release();
  }
});

const updateSchema = z.object({
  action: z.enum(["cancel", "move"]),
  newSlotId: z.string().uuid().optional()
}).refine(
  (data) => data.action !== "move" || !!data.newSlotId,
  { message: "newSlotId is required when moving a booking" }
);

router.patch("/:id", async (req, res) => {
  let client;

  try {
    const { userId, timezone } = identity(req);
    const parsed = updateSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "INVALID_UPDATE",
        details: parsed.error.issues
      });
    }

    client = await pool.connect();
    await client.query("BEGIN");
    await lockUser(client, userId);

    const found = await client.query(
      `SELECT b.*, s.start_at, s.duration_minutes
       FROM bookings b JOIN slots s ON s.id = b.slot_id
       WHERE b.id = $1 AND b.user_id = $2
       FOR UPDATE OF b`,
      [req.params.id, userId]
    );

    if (!found.rowCount) {
      throw new BookingError(404, "BOOKING_NOT_FOUND");
    }

    const booking = found.rows[0];

    if (booking.status !== "confirmed") {
      throw new BookingError(409, "BOOKING_NOT_ACTIVE");
    }

    if (DateTime.fromJSDate(booking.start_at, { zone: "utc" })
        .toMillis() - Date.now() < 6 * 60 * 60 * 1000) {
      throw new BookingError(409, "CHANGE_CUTOFF_PASSED");
    }

    if (parsed.data.action === "cancel") {
      const result = await client.query(
        `UPDATE bookings SET status = 'cancelled',
           updated_at = NOW()
         WHERE id = $1
         RETURNING id, status`,
        [req.params.id]
      );

      await client.query("COMMIT");
      return res.json(result.rows[0]);
    }

    const newSlotId = parsed.data.newSlotId!;

    if (newSlotId === booking.slot_id) {
      throw new BookingError(400, "SAME_SLOT");
    }

    const newSlot = await validateSchedule(
      client, userId, newSlotId, timezone, req.params.id
    );

    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [`booking-slot:${newSlotId}`]
    );

    const result = await client.query(
      `UPDATE bookings SET slot_id = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, slot_id, status`,
      [newSlot.id, req.params.id]
    );

    await client.query("COMMIT");
    return res.json(result.rows[0]);
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof Error &&
        "code" in error &&
        error.code === "23505") {
      return res.status(409).json({ error: "SLOT_ALREADY_BOOKED" });
    }
    return sendError(error, res);
  } finally {
    client?.release();
  }
});

router.get("/me", async (req, res) => {
  try {
    const { userId, timezone } = identity(req);

    const result = await pool.query(
      `SELECT b.id, b.question, b.status,
              s.start_at, s.duration_minutes, s.practitioner_id
       FROM bookings b JOIN slots s ON s.id = b.slot_id
       WHERE b.user_id = $1
       ORDER BY s.start_at DESC`,
      [userId]
    );

    return res.json(result.rows.map((booking) => ({
      ...booking,
      startAt: DateTime.fromJSDate(booking.start_at, { zone: "utc" })
        .setZone(timezone).toISO()
    })));
  } catch (error) {
    return sendError(error, res);
  }
});

export default router;
