// server.js

process.on("uncaughtException", (err) => {
  console.error("[UncaughtException]", err.message);
  console.error(err.stack);
  process.exit(1);
});

require("dotenv").config();

const app = require("./app");
const supabase = require("./config/supabaseClient");

const PORT = process.env.PORT || 8000;
const NODE_ENV = process.env.NODE_ENV || "development";

// ─── Check Supabase Connection ────────────────────────────────────────────────
const checkDatabaseConnection = async () => {
  try {
    const { error } = await supabase.from("users").select("id").limit(1);
    if (error) throw error;
    console.log("[DB] Supabase connected successfully");
  } catch (err) {
    console.error("[DB] Supabase connection failed:", err.message);
    console.error("[DB] Full error:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
    process.exit(1);
  }
};

// ─── Register Cron Jobs ───────────────────────────────────────────────────────
const registerCronJobs = () => {
  try {
    require("./cron/membershipExpiryJob");
    console.log("[Cron] Membership expiry alerts job registered");
  } catch (err) {
    console.error("[Cron] Failed to register cron jobs:", err.message);
  }

  // try {
  //   require("./cron/biometricCron");
  //   console.log("[Cron] Biometric sync job registered");
  // } catch (err) {
  //   console.error("[Cron] Failed to register biometric cron:", err.message);
  // }

  try {
    require("./cron/membershipStatusJob");
    console.log("[Cron] Membership status sync job registered");
  } catch (err) {
    console.error("[Cron] Failed to register membership status job:", err.message);
  }
};

// ─── Start Server ─────────────────────────────────────────────────────────────
const startServer = async () => {
  await checkDatabaseConnection();

  // Register cron jobs after DB is confirmed healthy
  registerCronJobs();

  const server = app.listen(PORT, () => {
    console.log("─────────────────────────────────────────");
    console.log(`  TrueFitness API`);
    console.log(`  Environment : ${NODE_ENV}`);
    console.log(`  Port        : ${PORT}`);
    console.log(`  URL         : http://localhost:${PORT}`);
    console.log(`  API Base    : http://localhost:${PORT}/api/v1`);
    console.log("─────────────────────────────────────────");
    try {
      require("./cron/birthdayWishJob");
      console.log("[Cron] Birthday wish job registered");
    } catch (err) {
      console.error("[Cron] Failed to register birthday job:", err.message);
    }

  });

  // Set server timeouts
  server.timeout = 30000;
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;

  // ─── Graceful Shutdown ──────────────────────────────────────────────────────
  const shutdown = (signal) => {
    console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);
    server.close(() => {
      console.log("[Server] All connections closed. Process exiting.");
      process.exit(0);
    });

    // Force shutdown after 10 seconds if graceful fails
    setTimeout(() => {
      console.error("[Server] Forced shutdown after timeout.");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (err) => {
    console.error("[UnhandledRejection]", err.message);
    console.error(err.stack);
    server.close(() => {
      console.log("[Server] Closed due to unhandled rejection.");
      process.exit(1);
    });
  });

  // Log memory usage every 30 minutes in production
  if (NODE_ENV === "production") {
    setInterval(() => {
      const mem = process.memoryUsage();
      console.log("[Memory]", {
        rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
      });
    }, 30 * 60 * 1000);
  }
};

startServer();