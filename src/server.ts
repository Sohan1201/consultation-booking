
import "dotenv/config";
import express from "express";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "consultation-booking"
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
