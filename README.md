Consultation Booking API

This project was built as part of the backend internship assignment. It provides APIs for practitioners to publish available consultation slots and for users to book, view, cancel, or reschedule their consultations.

The main focus is on handling booking rules correctly, validating questions before accepting bookings, and managing dates and times across different timezones.

**Technology used**

The backend is built with Node.js, Express.js, and TypeScript. PostgreSQL is used to store practitioners, available slots, and bookings. Zod handles request validation, Luxon is used for timezone calculations, and Vitest is used for automated tests.

**Getting started**

You will need Node.js, npm, and Docker Desktop installed.

Clone the repository and install the dependencies:

```bash
npm install
```

Create a `.env` file in the project root using `.env.example` as a reference. Set the database connection string to match the PostgreSQL configuration in `docker-compose.yml`.

Start the database:

```bash
docker compose up -d
```

Apply the database schema from PowerShell:

```powershell
Get-Content .\src\db\schema.sql -Raw | docker compose exec -T postgres psql -U consultation_user -d consultation_booking
```

Start the development server:

```bash
npm run dev
```

To compile the TypeScript code and run the automated tests:

```bash
npm run build
npm test
```

**Available endpoints**

| Method | Endpoint | Description |
|---|---|---|
| POST | `/practitioners/:id/slots` | Create an available consultation slot |
| GET | `/practitioners/:id/slots?date=YYYY-MM-DD` | View available slots for a date |
| POST | `/questions/check` | Check whether a consultation question is allowed |
| POST | `/bookings` | Book an available slot |
| PATCH | `/bookings/:id` | Cancel or reschedule a booking |
| GET | `/bookings/me` | View the current user's bookings |

Booking requests require the `x-user-id` and `x-timezone` headers. The availability endpoint requires the `x-timezone` header so that the requested date can be interpreted in the user's local timezone.

**A few implementation details**

All timestamps are stored as absolute instants in PostgreSQL and converted to the requested timezone when returned to the user. A database constraint prevents more than one confirmed booking from occupying the same slot. The booking logic also checks the user's daily session limit and the required gap between sessions.

Question safety checks currently use rule-based pattern matching. This is a deliberately simple implementation and may not recognize every possible way of expressing a prohibited question.

The project does not include a login system or Redis because neither is required for this assignment.

Further implementation choices and known limitations are documented in `DECISIONS.md`.