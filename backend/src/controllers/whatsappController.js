// controllers/whatsappController.js
const supabase = require("../config/supabaseClient");

// ─── Twilio helpers ───────────────────────────────────────────────────────────
const getTwilioClient = () => {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    throw new Error("Twilio credentials are not configured");
  }
  return require("twilio")(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
};

const formatPhone = (phone) => {
  const cleaned = String(phone || "").replace(/\D/g, "");
  if (!cleaned) return null;

  if (cleaned.length === 10) return `+91${cleaned}`;              // 9317742542   → +919317742542
  if (cleaned.length === 11 && cleaned.startsWith("0")) return `+91${cleaned.slice(1)}`; // 09317742542  → +919317742542
  if (cleaned.length === 12 && cleaned.startsWith("91")) return `+${cleaned}`;  // 919317742542 → +919317742542
  if (cleaned.length === 13 && cleaned.startsWith("091")) return `+${cleaned.slice(1)}`; // 0919317742542 → +919317742542

  return `+${cleaned}`;  // anything else — just add +
};
// ─── Send using approved Meta template ───────────────────────────────────────
const sendWhatsAppTemplate = async (phone, contentSid, variables) => {
  const formatted = formatPhone(phone);
  if (!formatted) throw new Error("Invalid phone number");
  const client = getTwilioClient();
  const result = await client.messages.create({
    from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
    to: `whatsapp:${formatted}`,
    contentSid,
    contentVariables: JSON.stringify(variables),
  });
  return result.sid;
};

// ─── Date helpers (IST-safe) ──────────────────────────────────────────────────
const getISTDateOnly = (date = new Date()) => {
  const ist = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, "0");
  const d = String(ist.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const addDaysToDateOnly = (dateOnly, days) => {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

const formatDateForUser = (dateOnly) => {
  if (!dateOnly) return "";
  const [y, m, d] = dateOnly.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN");
};

// ═════════════════════════════════════════════════════════════════════════════
// SEND TO SINGLE USER  →  POST /api/v1/whatsapp/send
// ═════════════════════════════════════════════════════════════════════════════
const sendToUser = async (req, res) => {
  try {
    let { user_id, title, message, scheduled_at } = req.body;
    title = title?.trim();
    message = message?.trim();

    if (!user_id || !title || !message) {
      return res.status(400).json({
        success: false,
        message: "user_id, title, and message are required",
      });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, name, phone, is_active")
      .eq("id", parseInt(user_id))
      .maybeSingle();

    if (userError || !user)
      return res.status(404).json({ success: false, message: "User not found" });
    if (user.is_active === false)
      return res.status(400).json({ success: false, message: "User account is inactive" });
    if (!user.phone)
      return res.status(400).json({ success: false, message: "User has no phone number" });

    if (scheduled_at && new Date(scheduled_at) > new Date()) {
      const { data, error } = await supabase
        .from("whatsapp_notifications")
        .insert([{
          user_id: parseInt(user_id), title, message,
          target_type: "user", status: "pending",
          scheduled_at, created_by: req.user.id,
          updated_at: new Date().toISOString(),
        }])
        .select("*").single();

      if (error)
        return res.status(500).json({ success: false, message: "Failed to schedule message" });

      return res.status(201).json({
        success: true,
        message: `Message scheduled for ${scheduled_at}`,
        data,
      });
    }

    let provider_message_id = null;
    let status = "sent";
    let error_message = null;
    let sent_at = null;

    try {
      provider_message_id = await sendWhatsAppTemplate(
        user.phone,
        process.env.TWILIO_TEMPLATE_PERSONAL,
        { "1": user.name, "2": `${title} - ${message}` }
      );
      sent_at = new Date().toISOString();
      console.log("[SendToUser] WhatsApp sent. SID:", provider_message_id);
    } catch (smsErr) {
      console.error("[SendToUser] Twilio error:", smsErr.message);
      status = "failed";
      error_message = smsErr.message;
    }

    const { data, error } = await supabase
      .from("whatsapp_notifications")
      .insert([{
        user_id: parseInt(user_id), title, message,
        target_type: "user", status, provider_message_id,
        sent_at, error_message, created_by: req.user.id,
        updated_at: new Date().toISOString(),
      }])
      .select("*").single();

    if (error)
      return res.status(500).json({ success: false, message: "Failed to save notification" });

    if (status === "failed")
      return res.status(500).json({
        success: false,
        message: error_message || "Message failed",
        data,
      });

    return res.status(201).json({
      success: true,
      message: `WhatsApp message sent to ${user.name}`,
      data,
    });
  } catch (err) {
    console.error("[SendToUser] Unexpected error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// SEND BULK  →  POST /api/v1/whatsapp/send-bulk
// ═════════════════════════════════════════════════════════════════════════════
const sendBulk = async (req, res) => {
  try {
    let { user_ids, title, message, scheduled_at } = req.body;
    title = title?.trim();
    message = message?.trim();

    if (!Array.isArray(user_ids) || user_ids.length === 0)
      return res.status(400).json({ success: false, message: "user_ids array is required" });
    if (!title || !message)
      return res.status(400).json({ success: false, message: "title and message are required" });

    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, name, phone")
      .in("id", user_ids.map((id) => parseInt(id)))
      .eq("is_active", true)
      .not("phone", "is", null);

    if (usersError)
      return res.status(500).json({ success: false, message: "Failed to fetch users" });
    if (!users || users.length === 0)
      return res.status(404).json({ success: false, message: "No active users found" });

    if (scheduled_at && new Date(scheduled_at) > new Date()) {
      const records = users.map((user) => ({
        user_id: user.id, title, message,
        target_type: "bulk", status: "pending",
        scheduled_at, created_by: req.user.id,
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase.from("whatsapp_notifications").insert(records);
      if (error)
        return res.status(500).json({ success: false, message: "Failed to schedule" });

      return res.status(201).json({
        success: true,
        message: `${users.length} messages scheduled`,
        data: { scheduled_count: users.length },
      });
    }

    const results = { sent: 0, failed: 0, errors: [] };
    const records = [];

    for (const user of users) {
      let provider_message_id = null;
      let status = "sent";
      let error_message = null;
      let sent_at = null;

      try {
        provider_message_id = await sendWhatsAppTemplate(
          user.phone,
          process.env.TWILIO_TEMPLATE_BROADCAST,
          { "1": user.name, "2": `${title} - ${message}` }
        );
        sent_at = new Date().toISOString();
        results.sent++;
      } catch (smsErr) {
        status = "failed";
        error_message = smsErr.message;
        results.failed++;
        results.errors.push({ user_id: user.id, name: user.name, error: smsErr.message });
      }

      records.push({
        user_id: user.id, title, message,
        target_type: "bulk", status, provider_message_id,
        sent_at, error_message, created_by: req.user.id,
        updated_at: new Date().toISOString(),
      });
    }

    await supabase.from("whatsapp_notifications").insert(records);

    return res.status(200).json({
      success: true,
      message: `Bulk send complete — ${results.sent} sent, ${results.failed} failed`,
      data: { total: users.length, sent: results.sent, failed: results.failed },
    });
  } catch (err) {
    console.error("[SendBulk] Unexpected error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// BROADCAST  →  POST /api/v1/whatsapp/broadcast
// ═════════════════════════════════════════════════════════════════════════════
const broadcast = async (req, res) => {
  try {
    let { title, message, scheduled_at } = req.body;
    title = title?.trim();
    message = message?.trim();

    if (!title || !message)
      return res.status(400).json({ success: false, message: "title and message are required" });

    if (scheduled_at && new Date(scheduled_at) > new Date()) {
      const { data, error } = await supabase
        .from("whatsapp_notifications")
        .insert([{
          user_id: null, title, message,
          target_type: "all", status: "pending",
          scheduled_at, created_by: req.user.id,
          updated_at: new Date().toISOString(),
        }])
        .select("*").single();

      if (error)
        return res.status(500).json({ success: false, message: "Failed to schedule broadcast" });

      return res.status(201).json({
        success: true,
        message: `Broadcast scheduled for ${scheduled_at}`,
        data,
      });
    }

    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, name, phone")
      .eq("is_active", true)
      .not("phone", "is", null);

    if (usersError)
      return res.status(500).json({ success: false, message: "Failed to fetch users" });
    if (!users || users.length === 0)
      return res.status(404).json({ success: false, message: "No active users found" });

    const results = { sent: 0, failed: 0, errors: [] };
    const records = [];

    for (const user of users) {
      let provider_message_id = null;
      let status = "sent";
      let error_message = null;
      let sent_at = null;

      try {
        provider_message_id = await sendWhatsAppTemplate(
          user.phone,
          process.env.TWILIO_TEMPLATE_BROADCAST,
          { "1": user.name, "2": `${title} - ${message}` }
        );
        sent_at = new Date().toISOString();
        results.sent++;
      } catch (smsErr) {
        status = "failed";
        error_message = smsErr.message;
        results.failed++;
        results.errors.push({ user_id: user.id, name: user.name, error: smsErr.message });
      }

      records.push({
        user_id: user.id, title, message,
        target_type: "all", status, provider_message_id,
        sent_at, error_message, created_by: req.user.id,
        updated_at: new Date().toISOString(),
      });
    }

    await supabase.from("whatsapp_notifications").insert(records);

    return res.status(200).json({
      success: true,
      message: `Broadcast complete — ${results.sent} sent, ${results.failed} failed`,
      data: { total: users.length, sent: results.sent, failed: results.failed },
    });
  } catch (err) {
    console.error("[Broadcast] Unexpected error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// MEMBERSHIP CONFIRMATION — called after assign/renew
// ═════════════════════════════════════════════════════════════════════════════
const sendMembershipConfirmation = async ({
  userId, name, phone, plan, amount, startDate, endDate, paymentMethod, isRenewal,
}) => {
  try {
    if (!phone) return { success: false, error: "No phone number" };

    const title = isRenewal ? "Membership Renewed" : "Membership Confirmed";
    const fields = [
      `Name: ${name}`,
      `Phone: ${phone}`,
      `Plan: ${plan}`,
      `Amount Paid: ₹${Number(amount || 0).toLocaleString("en-IN")}`,
      `Joining Date: ${formatDateForUser(startDate)}`,
      `Expiry Date: ${formatDateForUser(endDate)}`,
      `Payment Mode: ${(paymentMethod || "cash").toUpperCase()}`,
    ];
    // Stored/logged with real line breaks for readability...
    const details = fields.join("\n");
    // ...but WhatsApp template variables reject newlines, so the sent
    // message uses a flat separator instead.
    const detailsFlat = fields.join(" | ");

    let provider_message_id = null;
    let status = "sent";
    let error_message = null;
    let sent_at = null;

    try {
      provider_message_id = await sendWhatsAppTemplate(
        phone,
        process.env.TWILIO_TEMPLATE_PERSONAL,
        { "1": name, "2": `${title} - ${detailsFlat}` }
      );
      sent_at = new Date().toISOString();
      console.log(`[MembershipConfirmation] Sent to ${name} — SID: ${provider_message_id}`);
    } catch (smsErr) {
      status = "failed";
      error_message = smsErr.message;
      console.error(`[MembershipConfirmation] Failed for ${name}:`, smsErr.message);
    }

    const { error: logError } = await supabase.from("whatsapp_notifications").insert([{
      user_id: userId || null,
      title,
      message: details,
      target_type: "user",
      status,
      provider_message_id,
      sent_at,
      error_message,
      created_by: null,
      updated_at: new Date().toISOString(),
    }]);
    if (logError) console.error("[MembershipConfirmation] Failed to log notification:", logError.message);

    return { success: status === "sent", error: error_message };
  } catch (err) {
    console.error("[MembershipConfirmation] Unexpected error:", err);
    return { success: false, error: err.message };
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// MEMBERSHIP EXPIRY ALERTS — called by cron
// ═════════════════════════════════════════════════════════════════════════════
const sendMembershipExpiryAlerts = async (daysBeforeExpiry = 3) => {
  try {
    const todayIST = getISTDateOnly();
    const targetDate = addDaysToDateOnly(todayIST, daysBeforeExpiry);

    console.log(`[ExpiryAlert] Checking memberships expiring on ${targetDate}`);

    const { data: memberships, error: fetchError } = await supabase
      .from("user_memberships")
      .select(`
        id, user_id, full_name, phone, monthly_plan, end_date, status,
        users ( id, name, phone )
      `)
      .eq("status", "active")
      .eq("end_date", targetDate);

    if (fetchError) return { success: false, error: fetchError.message };
    if (!memberships || memberships.length === 0) {
      console.log(`[ExpiryAlert] No memberships expiring in ${daysBeforeExpiry} day(s)`);
      return { success: true, sent: 0, failed: 0 };
    }

    const results = { sent: 0, failed: 0, skipped: 0, errors: [] };
    const records = [];

    for (const membership of memberships) {
      const phone = membership.users?.phone || membership.phone;
      const name = membership.users?.name || membership.full_name || "Member";
      const userId = membership.user_id;
      const plan = membership.monthly_plan || "your plan";
      const prettyExpiry = formatDateForUser(membership.end_date);

      if (!phone) { results.skipped++; continue; }

      // Duplicate check
      const { data: existing } = await supabase
        .from("whatsapp_notifications")
        .select("id")
        .eq("user_id", userId)
        .eq("target_type", "expiry_alert")
        .eq("status", "sent")
        .gte("created_at", `${todayIST}T00:00:00`)
        .ilike("message", `%${membership.end_date}%`)
        .limit(1)
        .maybeSingle();

      if (existing) { results.skipped++; continue; }

      const urgency = daysBeforeExpiry === 1
        ? "expires tomorrow"
        : `expires in 3 days on ${prettyExpiry}`;

      const title = daysBeforeExpiry === 1
        ? "⚠️ Membership Expires Tomorrow!"
        : "🔔 Membership Expiring in 3 Days";

      const message = `${plan} membership ${urgency}. Renew now!`;

      let provider_message_id = null;
      let status = "sent";
      let error_message = null;
      let sent_at = null;

      try {
        provider_message_id = await sendWhatsAppTemplate(
          phone,
          process.env.TWILIO_TEMPLATE_EXPIRY,
          {
            "1": name,
            "2": plan,
            "3": prettyExpiry,
          }
        );
        sent_at = new Date().toISOString();
        results.sent++;
      } catch (smsErr) {
        status = "failed";
        error_message = smsErr.message;
        results.failed++;
        results.errors.push({ user_id: userId, name, error: smsErr.message });
      }

      records.push({
        user_id: userId, title, message,
        target_type: "expiry_alert", status,
        provider_message_id, sent_at, error_message,
        created_by: null,
        updated_at: new Date().toISOString(),
      });
    }

    if (records.length > 0) {
      const { error: logError } = await supabase.from("whatsapp_notifications").insert(records);
      if (logError) console.error("[ExpiryAlert] Failed to log notifications:", logError.message);
    }

    console.log(`[ExpiryAlert] Done — sent: ${results.sent}, failed: ${results.failed}, skipped: ${results.skipped}`);
    return { success: true, ...results };
  } catch (err) {
    console.error("[ExpiryAlert] Unexpected error:", err);
    return { success: false, error: err.message };
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// REMAINING FUNCTIONS (unchanged)
// ═════════════════════════════════════════════════════════════════════════════
const retryFailed = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: notif } = await supabase
      .from("whatsapp_notifications")
      .select("id, user_id, title, message, status")
      .eq("id", parseInt(id))
      .maybeSingle();

    if (!notif)
      return res.status(404).json({ success: false, message: "Notification not found" });
    if (notif.status !== "failed")
      return res.status(400).json({ success: false, message: "Only failed messages can be retried" });

    const { data: user } = await supabase
      .from("users")
      .select("phone, name")
      .eq("id", notif.user_id)
      .maybeSingle();

    if (!user?.phone)
      return res.status(400).json({ success: false, message: "User phone not found" });

    let provider_message_id = null;
    let status = "sent";
    let error_message = null;
    let sent_at = null;

    try {
      provider_message_id = await sendWhatsAppTemplate(
        user.phone,
        process.env.TWILIO_TEMPLATE_PERSONAL,
        { "1": user.name, "2": `${notif.title} - ${notif.message}` }
      );
      sent_at = new Date().toISOString();
    } catch (smsErr) {
      status = "failed";
      error_message = smsErr.message;
    }

    const { data, error } = await supabase
      .from("whatsapp_notifications")
      .update({ status, provider_message_id, sent_at, error_message, updated_at: new Date().toISOString() })
      .eq("id", parseInt(id))
      .select("*").single();

    if (error)
      return res.status(500).json({ success: false, message: "Failed to update" });
    if (status === "failed")
      return res.status(500).json({ success: false, message: "Retry failed", error: error_message, data });

    return res.status(200).json({ success: true, message: "Message resent successfully", data });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const getAllNotifications = async (req, res) => {
  try {
    const { status, target_type, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = supabase
      .from("whatsapp_notifications")
      .select(`id, title, message, status, target_type, provider_message_id,
        sent_at, scheduled_at, error_message, created_at, updated_at,
        users!whatsapp_notifications_user_id_fkey ( id, name, phone )`,
        { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (status) query = query.eq("status", status);
    if (target_type) query = query.eq("target_type", target_type);

    const { data, error, count } = await query;
    if (error)
      return res.status(500).json({ success: false, message: "Failed to fetch notifications" });

    return res.status(200).json({
      success: true, count, page: parseInt(page),
      total_pages: Math.ceil(count / parseInt(limit)), data,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const getMyNotifications = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("whatsapp_notifications")
      .select("id, title, message, status, sent_at, scheduled_at, created_at")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error)
      return res.status(500).json({ success: false, message: "Failed to fetch" });

    return res.status(200).json({ success: true, count: data.length, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const getStats = async (req, res) => {
  try {
    const statuses = ["sent", "failed", "pending"];
    const counts = {};
    for (const s of statuses) {
      const { count } = await supabase
        .from("whatsapp_notifications")
        .select("id", { count: "exact", head: true })
        .eq("status", s);
      counts[s] = count || 0;
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count: todayCount } = await supabase
      .from("whatsapp_notifications")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent")
      .gte("sent_at", todayStart.toISOString());

    return res.status(200).json({
      success: true,
      data: { ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0), sent_today: todayCount || 0 },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const deleteNotification = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("whatsapp_notifications")
      .delete()
      .eq("id", parseInt(req.params.id))
      .select("id, title").maybeSingle();

    if (error)
      return res.status(500).json({ success: false, message: "Failed to delete" });
    if (!data)
      return res.status(404).json({ success: false, message: "Notification not found" });

    return res.status(200).json({ success: true, message: `Notification "${data.title}" deleted` });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
const handleIncomingMessage = async (req, res) => {
  try {
    const { From, Body } = req.body;
    const phone = From.replace("whatsapp:", "");
    const message = (Body || "").trim().toLowerCase();

    console.log(`[Webhook] Message from ${phone}: ${Body}`);

    const client = getTwilioClient();

    let replyText = "";

    if (message === "hi" || message === "hello") {
      replyText = `👋 Hello! Welcome to *True Fitness*!\n\nWe've added you to our updates list. You'll receive:\n🔔 Membership reminders\n🎂 Birthday wishes\n📢 Gym announcements\n\nSee you at the gym! 💪`;
    } else if (message === "help") {
      replyText = `🏋️ *True Fitness Support*\n\nFor help, please visit the gym or call us directly.\n\nThank you! 💪`;
    } else {
      replyText = `Thanks for messaging *True Fitness*! 💪\n\nWe'll get back to you soon. For urgent queries, please visit the gym directly.`;
    }

    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: From,
      body: replyText,
    });

    res.status(200).send("OK");
  } catch (err) {
    console.error("[Webhook] Error:", err.message);
    res.status(500).send("Error");
  }
};
const triggerExpiryAlerts = async (req, res) => {
  try {
    const days = parseInt(req.body.days);
    if (![1, 3].includes(days))
      return res.status(400).json({ success: false, message: "days must be 1 or 3" });

    const result = await sendMembershipExpiryAlerts(days);
    if (!result.success)
      return res.status(500).json({ success: false, message: "Failed", error: result.error });

    return res.status(200).json({
      success: true,
      message: `Expiry alerts triggered for ${days} day(s)`,
      data: { sent: result.sent, failed: result.failed, skipped: result.skipped },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

module.exports = {
  sendToUser, sendBulk, broadcast, retryFailed,
  getAllNotifications, getMyNotifications, getStats,
  deleteNotification, sendMembershipExpiryAlerts, triggerExpiryAlerts, handleIncomingMessage,
  sendMembershipConfirmation,
};