import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { DateTime } from "luxon";

let app: any;
let pool: any;

const prefix = `it-${process.pid}-${Date.now()}`;
const users = new Set<string>();
const practitioners = new Set<string>();
const zone = "Asia/Kolkata";

function user(label: string) {
  const id = `${prefix}-${label}`;
  users.add(id);
  return id;
}

function practitioner(label: string) {
  const id = `${prefix}-${label}`;
  practitioners.add(id);
  return id;
}

function at(hour: number, minute = 0, daysAhead = 4) {
  return DateTime.now().setZone(zone).plus({ days: daysAhead })
    .startOf("day").set({ hour, minute, second: 0, millisecond: 0 });
}

async function createSlot(practitionerId: string, start: DateTime) {
  const response = await request(app)
    .post(`/practitioners/${encodeURIComponent(practitionerId)}/slots`)
    .set("x-timezone", zone)
    .send({ startAt: start.toUTC().toISO(), durationMinutes: 30 });

  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body;
}

async function book(slotId: string, userId: string) {
  return request(app).post("/bookings")
    .set("x-user-id", userId)
    .set("x-timezone", zone)
    .send({ slotId, question: "I would like general guidance." });
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing.");

  const testUrl = new URL(process.env.DATABASE_URL);
  testUrl.pathname = "/consultation_booking_test";
  process.env.DATABASE_URL = testUrl.toString();

  // Import after setting DATABASE_URL because the pool is initialized at import.
  app = (await import("../src/app")).default;
  pool = (await import("../src/db/pool")).pool;
  await pool.query("SELECT 1");
}, 20000);

afterAll(async () => {
  if (!pool) return;

  try {
    if (users.size) {
      await pool.query("DELETE FROM bookings WHERE user_id = ANY($1::text[])", [[...users]]);
    }

    if (practitioners.size) {
      await pool.query(
        "DELETE FROM bookings WHERE slot_id IN (SELECT id FROM slots WHERE practitioner_id = ANY($1::text[]))",
        [[...practitioners]],
      );
      await pool.query("DELETE FROM slots WHERE practitioner_id = ANY($1::text[])", [[...practitioners]]);
      await pool.query("DELETE FROM practitioners WHERE id = ANY($1::text[])", [[...practitioners]]);
    }
  } finally {
    await pool.end();
  }
}, 20000);

describe("Booking API integration", () => {
  it("allows only one of two concurrent users to book a slot", async () => {
    const slot = await createSlot(practitioner("race"), at(9));
    const results = await Promise.all([book(slot.id, user("race-a")), book(slot.id, user("race-b"))]);

    expect(results.filter(r => r.status === 201)).toHaveLength(1);
    expect(results.filter(r => r.status === 409)).toHaveLength(1);
  });

  it("rejects a third booking on the same local day", async () => {
    const p = practitioner("daily");
    const u = user("daily");
    const slots = await Promise.all([createSlot(p, at(9)), createSlot(p, at(12)), createSlot(p, at(15))]);

    expect((await book(slots[0].id, u)).status).toBe(201);
    expect((await book(slots[1].id, u)).status).toBe(201);
    const third = await book(slots[2].id, u);
    expect(third.status).toBe(409);
    expect(third.body.error).toBe("DAILY_SESSION_LIMIT");
  });

  it("rejects sessions with less than a two-hour gap", async () => {
    const p = practitioner("gap-short");
    const u = user("gap-short");
    const first = await createSlot(p, at(9));
    const second = await createSlot(p, at(11, 29));

    expect((await book(first.id, u)).status).toBe(201);
    const result = await book(second.id, u);
    expect(result.status).toBe(409);
    expect(result.body.error).toBe("TWO_HOUR_GAP_REQUIRED");
  });

  it("allows sessions with exactly a two-hour gap between end and start", async () => {
    const p = practitioner("gap-exact");
    const u = user("gap-exact");
    const first = await createSlot(p, at(9));
    const second = await createSlot(p, at(11, 30));

    expect((await book(first.id, u)).status).toBe(201);
    expect((await book(second.id, u)).status).toBe(201);
  });

  it("rejects cancellation inside the six-hour cutoff", async () => {
    const slot = await createSlot(practitioner("cancel-cutoff"), DateTime.now().plus({ hours: 5, minutes: 2 }));
    const u = user("cancel-cutoff");
    const booking = await book(slot.id, u);
    expect(booking.status).toBe(201);

    const result = await request(app).patch(`/bookings/${booking.body.id}`)
      .set("x-user-id", u).set("x-timezone", zone).send({ action: "cancel" });

    expect(result.status).toBe(409);
    expect(result.body.error).toBe("CHANGE_CUTOFF_PASSED");
  });

  it("rejects moving a booking inside the six-hour cutoff", async () => {
    const p = practitioner("move-cutoff");
    const u = user("move-cutoff");
    const soon = await createSlot(p, DateTime.now().plus({ hours: 5, minutes: 2 }));
    const later = await createSlot(p, at(14));
    const booking = await book(soon.id, u);
    expect(booking.status).toBe(201);

    const result = await request(app).patch(`/bookings/${booking.body.id}`)
      .set("x-user-id", u).set("x-timezone", zone)
      .send({ action: "move", newSlotId: later.id });

    expect(result.status).toBe(409);
    expect(result.body.error).toBe("CHANGE_CUTOFF_PASSED");
  });

  it("rejects moving a booking to another user's occupied slot", async () => {
    const p = practitioner("occupied");
    const u1 = user("occupied-a");
    const u2 = user("occupied-b");
    const first = await createSlot(p, at(9));
    const occupied = await createSlot(p, at(12));
    const ownBooking = await book(first.id, u1);
    expect(ownBooking.status).toBe(201);
    expect((await book(occupied.id, u2)).status).toBe(201);

    const result = await request(app).patch(`/bookings/${ownBooking.body.id}`)
      .set("x-user-id", u1).set("x-timezone", zone)
      .send({ action: "move", newSlotId: occupied.id });

    expect(result.status).toBe(409);
    expect(result.body.error).toBe("SLOT_ALREADY_BOOKED");
  });

  it("returns booking times in the requested timezone", async () => {
    const slot = await createSlot(practitioner("timezone"), at(9));
    const u = user("timezone");
    expect((await book(slot.id, u)).status).toBe(201);

    const result = await request(app).get("/bookings/me")
      .set("x-user-id", u).set("x-timezone", zone);

    expect(result.status).toBe(200);
    const booking = result.body.find((item: any) => item.startAt);
    expect(booking).toBeDefined();
    const time = DateTime.fromISO(booking.startAt, { setZone: true });
    expect(time.isValid).toBe(true);
    expect(time.offset).toBe(330);
    expect(time.hour).toBe(9);
  });

  it("rejects an invalid timezone", async () => {
    const slot = await createSlot(practitioner("bad-zone"), at(9));
    const result = await request(app).post("/bookings")
      .set("x-user-id", user("bad-zone"))
      .set("x-timezone", "Not/A_Real_Zone")
      .send({ slotId: slot.id, question: "I would like general guidance." });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe("VALID_USER_AND_TIMEZONE_REQUIRED");
  });

  it("allows cancellation outside the cutoff", async () => {
    const slot = await createSlot(practitioner("cancel-early"), at(9));
    const u = user("cancel-early");
    const booking = await book(slot.id, u);
    expect(booking.status).toBe(201);

    const result = await request(app).patch(`/bookings/${booking.body.id}`)
      .set("x-user-id", u).set("x-timezone", zone).send({ action: "cancel" });

    expect(result.status).toBe(200);
    expect(result.body.status).toBe("cancelled");
  });

  it("allows moving a booking outside the cutoff to an available slot", async () => {
    const p = practitioner("move-early");
    const u = user("move-early");
    const original = await createSlot(p, at(9));
    const target = await createSlot(p, at(12));
    const booking = await book(original.id, u);
    expect(booking.status).toBe(201);

    const result = await request(app).patch(`/bookings/${booking.body.id}`)
      .set("x-user-id", u).set("x-timezone", zone)
      .send({ action: "move", newSlotId: target.id });

    expect(result.status).toBe(200);
    expect(result.body.slot_id).toBe(target.id);
  });
});
