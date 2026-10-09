// cron/membershipExpiryJob.js
//
// Runs daily at 5:00 AM IST
// Sends WhatsApp alerts to members whose membership expires in 3 days or 1 day
//
// Requires: npm install node-cron

const cron = require("node-cron");
const { sendMembershipExpiryAlerts } = require("../controllers/whatsappController");

// ─── Every day at 5:00 AM IST ─────────────────────────────────────────────────
cron.schedule(
  "0 5 * * *",
  async () => {
    console.log(`\n[CronJob] ── Membership Expiry Alerts ── ${new Date().toISOString()}`);

    // 3-day alert
    const r3 = await sendMembershipExpiryAlerts(3);
    console.log(`[CronJob] 3-day → sent: ${r3.sent ?? 0}, failed: ${r3.failed ?? 0}`);

    // 1-day alert
    const r1 = await sendMembershipExpiryAlerts(1);
    console.log(`[CronJob] 1-day → sent: ${r1.sent ?? 0}, failed: ${r1.failed ?? 0}`);
  },
  { timezone: "Asia/Kolkata" }
);

console.log("[CronJob] Membership expiry job registered — runs daily at 5:00 AM IST");
