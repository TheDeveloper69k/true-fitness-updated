//membershipCleanupJob.js


const cron = require("node-cron");
const supabase = require("../config/supabaseClient");

// Runs daily at 6:00 AM India time.
cron.schedule(
    "0 6 * * *",
    async () => {
        console.log(
            `[MembershipCleanup] Starting at ${new Date().toISOString()}`
        );

        try {
            // PostgreSQL enforces the rolling one-month grace period,
            // keeps active memberships, and excludes membership ID 246.
            const { data: deleted, error } = await supabase.rpc(
                "cleanup_expired_memberships"
            );

            if (error) {
                throw error;
            }

            console.log(
                `[MembershipCleanup] Completed. Deleted ${deleted ?? 0} expired membership record(s).`
            );
        } catch (error) {
            console.error("[MembershipCleanup] Failed:", error.message);
        }
    },
    { timezone: "Asia/Kolkata" }
);

console.log(
    "[CronJob] Membership cleanup registered — daily at 6:00 AM IST"
);