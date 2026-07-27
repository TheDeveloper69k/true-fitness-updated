// cron/membershipStatusJob.js
//
// Runs every hour: flips any "active" membership whose end_date has
// passed over to "expired". Previously this only happened when an admin
// opened the members list or stats page — memberships could sit
// incorrectly marked "active" for weeks otherwise.

const cron = require("node-cron");
const { expireStaleMemberships } = require("../controllers/membershipController");

cron.schedule(
  "0 * * * *",
  async () => {
    console.log(`\n[CronJob] ── Membership Status Sync ── ${new Date().toISOString()}`);
    await expireStaleMemberships();
  },
  { timezone: "Asia/Kolkata" }
);

console.log("[CronJob] Membership status sync job registered — runs hourly");
