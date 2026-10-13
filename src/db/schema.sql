
CREATE TABLE IF NOT EXISTS practitioners (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    practitioner_id TEXT NOT NULL
        REFERENCES practitioners(id),
    start_at TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER NOT NULL
        CHECK (duration_minutes BETWEEN 15 AND 480),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (start_at > '-infinity'::timestamptz),
    UNIQUE (practitioner_id, start_at)
);

CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id UUID NOT NULL REFERENCES slots(id),
    user_id TEXT NOT NULL,
    question TEXT NOT NULL
        CHECK (length(trim(question)) > 0),
    status TEXT NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('confirmed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A slot may have only one active booking.
CREATE UNIQUE INDEX IF NOT EXISTS
    one_confirmed_booking_per_slot
ON bookings(slot_id)
WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS bookings_user_status_idx
ON bookings(user_id, status);

CREATE INDEX IF NOT EXISTS slots_practitioner_start_idx
ON slots(practitioner_id, start_at);
