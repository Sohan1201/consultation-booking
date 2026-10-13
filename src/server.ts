import slotRoutes from "./routes/slotRoutes";
import questionRoutes from "./routes/questionRoutes";
import "dotenv/config";
import bookingRoutes from "./routes/bookingRoutes";
import express from "express";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use("/questions", questionRoutes);
app.use("/", slotRoutes);
app.use("/bookings", bookingRoutes);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "consultation-booking"
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
