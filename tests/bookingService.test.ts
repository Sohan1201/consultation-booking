import { describe, it, expect, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  BookingError,
  validateSchedule,
} from "../src/services/bookingService";

const HOUR = 60 * 60 * 1000;

function makeClient(options?: {
  existingStart?: Date;
  existingDuration?: number;
  dailyCount?: number;
}) {
  const slotStart = new Date(Date.now() + 48 * HOUR);

  const query = vi.fn()
    .mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        id: "slot-1",
        start_at: slotStart,
        duration_minutes: 30,
      }],
    })
    .mockResolvedValueOnce({
      rows: [{ total: options?.dailyCount ?? 0 }],
    })
    .mockResolvedValueOnce({
      rows: options?.existingStart
        ? [{
            start_at: options.existingStart,
            duration_minutes: options.existingDuration ?? 30,
          }]
        : [],
    });

  return {
    client: { query } as unknown as PoolClient,
    slotStart,
  };
}

async function runValidation(
  options?: Parameters<typeof makeClient>[0]
) {
  const { client, slotStart } = makeClient(options);

  return validateSchedule(
    client,
    "test-user",
    "slot-1",
    "Asia/Kolkata"
  );
}

describe("Booking schedule rules", () => {
  it("allows a valid future slot", async () => {
    await expect(runValidation()).resolves.toBeDefined();
  });

  it("rejects a third session on the same local day", async () => {
    await expect(
      runValidation({ dailyCount: 2 })
    ).rejects.toMatchObject({
      status: 409,
      code: "DAILY_SESSION_LIMIT",
    });
  });

  it("rejects overlapping sessions", async () => {
    const { slotStart } = makeClient();

    await expect(
      runValidation({
        existingStart: new Date(slotStart.getTime() + 15 * 60 * 1000),
        existingDuration: 30,
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "TWO_HOUR_GAP_REQUIRED",
    });
  });

  it("rejects sessions less than two hours apart", async () => {
    const { slotStart } = makeClient();

    // Existing session ends 1 hour before the proposed session.
    await expect(
      runValidation({
        existingStart: new Date(
          slotStart.getTime() - 90 * 60 * 1000
        ),
        existingDuration: 30,
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "TWO_HOUR_GAP_REQUIRED",
    });
  });

  it("allows sessions exactly two hours apart", async () => {
    const { slotStart } = makeClient();

    await expect(
      runValidation({
        existingStart: new Date(
          slotStart.getTime() - 150 * 60 * 1000
        ),
        existingDuration: 30,
      })
    ).resolves.toBeDefined();
  });

  it("rejects a slot that has already started", async () => {
    const { client } = makeClient();
    const pastSlot = new Date(Date.now() - 60_000);

    const query = vi.fn().mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        id: "slot-1",
        start_at: pastSlot,
        duration_minutes: 30,
      }],
    });

    const pastClient = { query } as unknown as PoolClient;

    await expect(
      validateSchedule(
        pastClient,
        "test-user",
        "slot-1",
        "Asia/Kolkata"
      )
    ).rejects.toMatchObject({
      status: 409,
      code: "SLOT_IN_THE_PAST",
    });
  });
});