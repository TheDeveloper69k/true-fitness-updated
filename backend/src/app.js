// app.js

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

const app = express();
app.set("trust proxy", 1);

// ─── Security Headers ─────────────────────────────────────────
app.use(helmet());

// ─── CORS ─────────────────────────────────────────────────────
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    return callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));

// ─── Rate Limiter (BEFORE routes) ─────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
});
app.use(globalLimiter);

// ─── Compression ──────────────────────────────────────────────
app.use(compression());

// ─── Logging ──────────────────────────────────────────────────
if (process.env.NODE_ENV !== "test") {
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
}

// ─── Body Parsing ─────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ─── Health Check ─────────────────────────────────────────────
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "TrueFitness API is running",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/v1/health", (req, res) => {
  res.status(200).json({
    success: true,
    status: "healthy",
    uptime: process.uptime(),
  });
});

// ─── Routes ───────────────────────────────────────────────────
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const gymRoutes = require("./routes/gymRoutes");
const trainerRoutes = require("./routes/trainerRoutes");
const membershipRoutes = require("./routes/membershipRoutes");
const membershipPlanRoutes = require("./routes/membershipPlanRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const whatsappRoutes = require("./routes/whatsappRoutes");
const dietRoutes = require("./routes/dietRoutes");
const receiptsRoutes = require("./routes/receiptRoutes");
const gymPlanRoutes = require("./routes/gymPlanRoutes");
const biometricRoutes = require("./routes/biometricRoutes");
const { protect } = require("./middlewares/authMiddleware");

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/gyms", gymRoutes);
app.use("/api/v1/trainers", trainerRoutes);
app.use("/api/v1/memberships", membershipRoutes);
app.use("/api/v1/plans", membershipPlanRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/whatsapp", whatsappRoutes);
app.use("/api/v1/diet", dietRoutes);
app.use("/api/v1/receipts", receiptsRoutes);
app.use("/api/v1/gym-plans", gymPlanRoutes);
app.use("/api/v1/biometric", protect, biometricRoutes);

// ─── 404 Handler ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ─── Global Error Handler ─────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("[GlobalError]", err.message);

  if (err.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "Request payload too large",
    });
  }

  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON in request body",
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

module.exports = app;