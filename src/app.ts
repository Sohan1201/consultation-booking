import express from "express";
import questionRoutes from "./routes/questionRoutes";
import slotRoutes from "./routes/slotRoutes";
import bookingRoutes from "./routes/bookingRoutes";

const app = express();

app.use(express.json());
app.use("/questions", questionRoutes);
app.use("/", slotRoutes);
app.use("/bookings", bookingRoutes);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "consultation-booking",
  });
});

export default app;
