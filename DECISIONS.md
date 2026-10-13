Technical Decisions

This document records the main choices made while building the consultation booking API, along with the reasoning behind them and the parts that still need validation.

**Technology choices**

I used Node.js and Express.js to build the API, with TypeScript to catch type-related mistakes during development. PostgreSQL stores the application data and enforces important database constraints. Zod validates incoming requests, Luxon handles timezone calculations, and Vitest is used for automated tests.

**Database design**

Practitioners, slots, and bookings are stored in separate tables. A booking refers to a slot, and a partial unique index ensures that only one confirmed booking can exist for a slot at a time. Cancelled bookings do not permanently prevent a slot from being booked again.

Timestamps use PostgreSQL's `TIMESTAMPTZ` type so that the application can work with the same instant regardless of the user's timezone.

**Booking rules**

The application checks whether a question is allowed before creating a booking. It also checks slot availability, the maximum of two sessions per user per local calendar day, the required two-hour gap between sessions, and the six-hour restriction on cancellations and rescheduling.

Database transactions and advisory locks are used to coordinate booking operations. These mechanisms need to be tested under concurrent requests to confirm that all rules remain correct when multiple requests arrive at the same time.

**Question safety**

The current question checker uses regular expressions to recognize the five prohibited categories specified in the assignment. Each category has its own reason code.

This approach is easy to understand and test, but it has limitations. It can miss indirect wording or flag a question that uses the same words in a different context. The existing tests cover representative examples rather than every possible phrasing.

**Scope decisions**

I did not add authentication, a frontend, or Redis. The assignment allows user identification through a request header and describes Redis as optional, so these additions were not necessary for the requested implementation.

**Remaining validation**

The most important cases to verify are simultaneous attempts to book the same slot, the daily limit across local calendar boundaries, the two-hour gap across midnight, and cancellations or rescheduling near the six-hour cutoff. These require tests against PostgreSQL, not just isolated unit tests.

**Use of AI**

AI tools were used to assist with project planning, code drafting, implementation explanations, debugging and  test development. I reviewed and tested the implementation, made decisions about the project structure and behavior, and am responsible for the submitted work. I am continuing to strengthen my understanding of the implementation so that I can explain the technical decisions, demonstrate the behavior, and make modifications during the interview.