require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const { execFile } = require("child_process");
const path = require("path");

const PORT = process.env.PORT || 4001;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const COOKIE_NAME = "deploy_dash_session";

if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 20) {
  console.error(
    "ADMIN_TOKEN is missing or too short. Set a long random value in .env (see .env.example). Refusing to start."
  );
  process.exit(1);
}

const sessionHash = crypto.createHash("sha256").update(ADMIN_TOKEN).digest("hex");

const app = express();
app.set("trust proxy", false);
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// Basic in-memory brute-force guard. Fine for a single-operator, local-only tool.
const attempts = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const entry = attempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + 15 * 60 * 1000;
  }
  entry.count += 1;
  attempts.set(ip, entry);
  return entry.count > 10;
}

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

app.post("/login", (req, res) => {
  if (isRateLimited(req.ip)) {
    return res.status(429).json({ error: "Too many attempts. Wait 15 minutes." });
  }
  const { token } = req.body || {};
  if (typeof token !== "string" || !timingSafeStringEqual(token, ADMIN_TOKEN)) {
    return res.status(401).json({ error: "Invalid token" });
  }
  res.cookie(COOKIE_NAME, sessionHash, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE !== "false",
    maxAge: 12 * 60 * 60 * 1000,
  });
  res.json({ ok: true });
});

app.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

function requireAuth(req, res, next) {
  const cookie = req.cookies[COOKIE_NAME];
  if (!cookie || !timingSafeStringEqual(cookie, sessionHash)) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

// Only ever runs the fixed scripts below — never accepts a command from the request.
function runScript(scriptName, res) {
  const scriptPath = path.join(__dirname, "scripts", scriptName);
  execFile(
    "bash",
    [scriptPath],
    { timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 },
    (err, stdout, stderr) => {
      res.json({
        ok: !err,
        exitCode: err ? err.code ?? 1 : 0,
        stdout,
        stderr: stderr || (err ? String(err.message) : ""),
      });
    }
  );
}

app.post("/api/deploy", requireAuth, (req, res) => runScript("deploy.sh", res));
app.post("/api/restart", requireAuth, (req, res) => runScript("restart.sh", res));
app.post("/api/logs", requireAuth, (req, res) => runScript("logs.sh", res));

// Bound to localhost only on purpose — reach it through an SSH tunnel.
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Deploy dashboard listening on 127.0.0.1:${PORT} (local only)`);
});
