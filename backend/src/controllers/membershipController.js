const supabase = require("../config/supabaseClient");

const ALLOWED_STATUS = ["active", "inactive", "expired", "cancelled", "suspended"];

function normalizeDate(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

//make changes

function addDays(startDate, days) {
  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().split("T")[0];
}

async function getPlanByName(planName) {
  const { data, error } = await supabase
    .from("membership_plans")
    .select("id, name, duration_days, price, is_active")
    .eq("name", planName)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data || null;
}

// User: get current user's latest membership
exports.getMyMembership = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from("user_memberships")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch membership",
        error: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      data: data || null,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error while fetching membership",
      error: err.message,
    });
  }
};

// User: get membership history
exports.getMyMembershipHistory = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from("user_memberships")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch membership history",
        error: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      data: data || [],
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error while fetching membership history",
      error: err.message,
    });
  }
};

// Admin: assign/add membership
exports.assignMembership = async (req, res) => {
  try {
    const {
      user_id,
      full_name,
      name,
      phone,
      date_of_birth,
      monthly_plan,
      discount,
      status,
      start_date,
      payment_method,
      gym_id,
      currency,
      transaction_id,
    } = req.body;

    if (status && !ALLOWED_STATUS.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value",
      });
    }

    if (!monthly_plan || !String(monthly_plan).trim()) {
      return res.status(400).json({
        success: false,
        message: "Plan name is required",
      });
    }

    if (!start_date) {
      return res.status(400).json({
        success: false,
        message: "Start date is required",
      });
    }

    const normalizedStartDate = normalizeDate(start_date);
    if (!normalizedStartDate) {
      return res.status(400).json({
        success: false,
        message: "Invalid start date",
      });
    }

    const parsedDiscount = Number(discount || 0);
    if (Number.isNaN(parsedDiscount) || parsedDiscount < 0) {
      return res.status(400).json({
        success: false,
        message: "Discount must be a valid positive number",
      });
    }

    const plan = await getPlanByName(String(monthly_plan).trim());
    if (!plan) {
      return res.status(400).json({
        success: false,
        message: "Selected membership plan not found or inactive",
      });
    }

    const planPrice = Number(plan.price || 0);
    const durationDays = Number(plan.duration_days || 0);

    if (parsedDiscount > planPrice) {
      return res.status(400).json({
        success: false,
        message: "Discount cannot be greater than plan price",
      });
    }

    if (durationDays <= 0) {
      return res.status(400).json({
        success: false,
        message: "Selected plan has invalid duration",
      });
    }

    const resolvedEndDate = addDays(normalizedStartDate, durationDays);
    if (!resolvedEndDate) {
      return res.status(400).json({
        success: false,
        message: "Invalid end date",
      });
    }

    let resolvedUserId = user_id || null;
    let resolvedName = null;
    let resolvedPhone = phone || null;

    if (resolvedUserId) {
      const { data: existingUser, error: userError } = await supabase
        .from("users")
        .select("id, name, phone")
        .eq("id", resolvedUserId)
        .maybeSingle();

      if (userError) {
        return res.status(500).json({
          success: false,
          message: "Failed to verify user",
          error: userError.message,
        });
      }

      if (!existingUser) {
        return res.status(400).json({
          success: false,
          message: "Provided user_id does not exist",
        });
      }

      resolvedName = existingUser.name || null;
      resolvedPhone = existingUser.phone || resolvedPhone;
    } else {
      resolvedName = (full_name || name || "").trim() || null;

      if (!resolvedName) {
        return res.status(400).json({
          success: false,
          message: "Full name is required when user_id is not provided",
        });
      }
    }

    const membershipPayload = {
      user_id: resolvedUserId,
      full_name: resolvedName,
      phone: resolvedPhone,
      date_of_birth: date_of_birth || null,
      monthly_plan: plan.name,
      plan_price: planPrice,
      discount: parsedDiscount,
      status: status || "active",
      start_date: normalizedStartDate,
      end_date: resolvedEndDate,
      updated_at: new Date().toISOString(),
    };

    const { data: membership, error: membershipError } = await supabase
      .from("user_memberships")
      .insert([membershipPayload])
      .select()
      .single();

    if (membershipError) {
      return res.status(500).json({
        success: false,
        message: "Failed to add membership",
        error: membershipError.message,
        details: membershipError.details || null,
        hint: membershipError.hint || null,
        code: membershipError.code || null,
      });
    }

    const finalAmount = Number(membership.final_amount ?? planPrice - parsedDiscount);

    const paymentPayload = {
      user_id: resolvedUserId,
      amount: finalAmount,
      status: "success",              // ✅ matches your DB  constraint
      payment_date: new Date().toISOString(),
      plan_id: plan.id,
      gym_id: gym_id || null,
      currency: currency || "INR",
      payment_method: payment_method || "cash",
      transaction_id: transaction_id || `TF-${Date.now()}`,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      membership_end_date: resolvedEndDate,
    };

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .insert([paymentPayload])
      .select()
      .single();

    if (paymentError) {
      await supabase
        .from("user_memberships")
        .delete()
        .eq("id", membership.id);

      return res.status(500).json({
        success: false,
        message: "Membership created but receipt creation failed",
        error: paymentError.message,
        details: paymentError.details || null,
        hint: paymentError.hint || null,
        code: paymentError.code || null,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Membership added and receipt created successfully",
      data: {
        membership,
        payment,
      },
    });
  } catch (err) {
    console.error("[assignMembership]", err);
    return res.status(500).json({
      success: false,
      message: "Server error while adding membership",
      error: err.message,
    });
  }
};

// Admin: get all memberships
exports.getAllMemberships = async (req, res) => {
  try {
    const { status, limit, user_id, latest_only } = req.query;

    const todayStr = new Date().toISOString().split("T")[0];

    await supabase
      .from("user_memberships")
      .update({
        status: "expired",
        updated_at: new Date().toISOString(),
      })
      .lt("end_date", todayStr)
      .eq("status", "active");

    let query = supabase
      .from("user_memberships")
      .select("*")
      .order("created_at", { ascending: false });

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    if (user_id) {
      query = query.eq("user_id", user_id);
    }

    if (limit) {
      query = query.limit(Number(limit));
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch memberships",
        error: error.message,
      });
    }

    let result = data || [];

    if (String(latest_only) === "true") {
      const map = new Map();

      for (const item of result) {
        const key = item.user_id || `${item.full_name || ""}_${item.phone || ""}`;
        if (!map.has(key)) {
          map.set(key, item);
        }
      }

      result = Array.from(map.values());
    }

    return res.status(200).json({
      success: true,
      count: result.length,
      data: result,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error while fetching memberships",
      error: err.message,
    });
  }
};

// Admin: get one user's memberships
exports.getUserMembership = async (req, res) => {
  try {
    const { userId } = req.params;

    console.log("req.user:", req.user);
    console.log("params userId:", userId);

    if (req.user.role !== "admin" && Number(req.user.id) !== Number(userId)) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const { data, error } = await supabase
      .from("user_memberships")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch user memberships",
        error: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      data: data || [],
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error while fetching user memberships",
      error: err.message,
    });
  }
};
// Admin: update membership status
exports.updateMembershipStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !ALLOWED_STATUS.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value",
      });
    }

    const { data, error } = await supabase
      .from("user_memberships")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to update membership status",
        error: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Membership status updated successfully",
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error while updating membership status",
      error: err.message,
    });
  }
};

// Admin: renew membership
exports.renewMembership = async (req, res) => {
  try {
    const { id } = req.params;
    const { start_date, monthly_plan, discount } = req.body;

    if (!monthly_plan || !String(monthly_plan).trim()) {
      return res.status(400).json({ success: false, message: "Plan name is required" });
    }

    const { data: existingMembership, error: fetchError } = await supabase
      .from("user_memberships")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !existingMembership) {
      return res.status(404).json({ success: false, message: "Membership not found" });
    }

    const today = new Date().toISOString().split("T")[0];
    const newStartDate = normalizeDate(start_date || today);
    if (!newStartDate) {
      return res.status(400).json({ success: false, message: "Invalid start date" });
    }

    const parsedDiscount =
      discount !== undefined ? Number(discount) : Number(existingMembership.discount || 0);

    if (Number.isNaN(parsedDiscount) || parsedDiscount < 0) {
      return res.status(400).json({ success: false, message: "Discount must be a valid positive number" });
    }

    const plan = await getPlanByName(String(monthly_plan).trim());
    if (!plan) {
      return res.status(400).json({ success: false, message: "Selected membership plan not found or inactive" });
    }

    const newPlanPrice = Number(plan.price || 0);
    const durationDays = Number(plan.duration_days || 0);

    if (parsedDiscount > newPlanPrice) {
      return res.status(400).json({ success: false, message: "Discount cannot be greater than plan price" });
    }

    if (durationDays <= 0) {
      return res.status(400).json({ success: false, message: "Selected plan has invalid duration" });
    }

    // Calculate remaining days rollover
    let totalDays = durationDays;
    const existingEndDate = existingMembership.end_date ? new Date(existingMembership.end_date) : null;
    const todayDate = new Date(today);

    if (existingEndDate && existingEndDate > todayDate) {
      const remainingMs = existingEndDate - todayDate;
      const remainingDays = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
      totalDays = durationDays + remainingDays;
    }

    const newEndDate = addDays(newStartDate, totalDays);
    if (!newEndDate) {
      return res.status(400).json({ success: false, message: "Invalid end date" });
    }

    const updatePayload = {
      start_date: newStartDate,
      end_date: newEndDate,
      status: "active",
      monthly_plan: plan.name,
      plan_price: newPlanPrice,
      discount: parsedDiscount,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("user_memberships")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ success: false, message: "Failed to renew membership", error: error.message });
    }

    // ✅ Payment insert is INSIDE try block, BEFORE the final return
    const finalAmount = newPlanPrice - parsedDiscount;

    const paymentPayload = {
      user_id: existingMembership.user_id || null,
      amount: finalAmount,
      status: "success",
      payment_date: new Date().toISOString(),
      plan_id: plan.id,
      gym_id: existingMembership.gym_id || null,
      currency: req.body.currency || "INR",
      payment_method: req.body.payment_method || "cash",
      transaction_id: req.body.transaction_id || `TF-${Date.now()}`,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      membership_end_date: newEndDate, // ✅ actual end date with rollover
    };

    const { error: paymentError } = await supabase
      .from("payments")
      .insert([paymentPayload]);

    if (paymentError) {
      console.error("Receipt creation failed after renewal:", paymentError.message);
    }

    // ✅ Single final return
    return res.status(200).json({
      success: true,
      message: "Membership renewed successfully",
      data,
    });

  } catch (err) {
    console.error("[renewMembership]", err);
    return res.status(500).json({
      success: false,
      message: "Server error while renewing membership",
      error: err.message,
    });
  }
};
exports.modifyMembership = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      monthly_plan,
      discount,
      status,
      start_date,
      end_date,
      date_of_birth,
    } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Membership ID is required",
      });
    }

    const { data: existingMembership, error: fetchError } = await supabase
      .from("user_memberships")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !existingMembership) {
      return res.status(404).json({
        success: false,
        message: "Membership not found",
      });
    }

    const updatePayload = {
      updated_at: new Date().toISOString(),
    };

    if (status !== undefined) {
      if (!ALLOWED_STATUS.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status value",
        });
      }
      updatePayload.status = status;
    }

    if (date_of_birth !== undefined) {
      updatePayload.date_of_birth = date_of_birth || null;
    }

    const parsedDiscount =
      discount !== undefined
        ? Number(discount)
        : Number(existingMembership.discount || 0);

    if (Number.isNaN(parsedDiscount) || parsedDiscount < 0) {
      return res.status(400).json({
        success: false,
        message: "Discount must be a valid positive number",
      });
    }

    let resolvedPlanName = existingMembership.monthly_plan;
    let resolvedPlanPrice = Number(existingMembership.plan_price || 0);
    let resolvedDurationDays = null;

    if (monthly_plan && String(monthly_plan).trim()) {
      const plan = await getPlanByName(String(monthly_plan).trim());

      if (!plan) {
        return res.status(400).json({
          success: false,
          message: "Selected membership plan not found or inactive",
        });
      }

      resolvedPlanName = plan.name;
      resolvedPlanPrice = Number(plan.price || 0);
      resolvedDurationDays = Number(plan.duration_days || 0);

      if (resolvedDurationDays <= 0) {
        return res.status(400).json({
          success: false,
          message: "Selected plan has invalid duration",
        });
      }

      updatePayload.monthly_plan = resolvedPlanName;
      updatePayload.plan_price = resolvedPlanPrice;
    }

    if (parsedDiscount > resolvedPlanPrice) {
      return res.status(400).json({
        success: false,
        message: "Discount cannot be greater than plan price",
      });
    }

    updatePayload.discount = parsedDiscount;

    const normalizedStartDate =
      start_date !== undefined
        ? normalizeDate(start_date)
        : existingMembership.start_date;

    if (start_date !== undefined && !normalizedStartDate) {
      return res.status(400).json({
        success: false,
        message: "Invalid start date",
      });
    }

    if (normalizedStartDate) {
      updatePayload.start_date = normalizedStartDate;
    }

    if (end_date !== undefined) {
      const normalizedEndDate = normalizeDate(end_date);
      if (!normalizedEndDate) {
        return res.status(400).json({
          success: false,
          message: "Invalid end date",
        });
      }
      updatePayload.end_date = normalizedEndDate;
    } else if (resolvedDurationDays && normalizedStartDate) {
      const calculatedEndDate = addDays(normalizedStartDate, resolvedDurationDays);
      if (!calculatedEndDate) {
        return res.status(400).json({
          success: false,
          message: "Invalid calculated end date",
        });
      }
      updatePayload.end_date = calculatedEndDate;
    }

    const { data, error } = await supabase
      .from("user_memberships")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to modify membership",
        error: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Membership modified successfully",
      data,
    });
  } catch (err) {
    console.error("[modifyMembership]", err);
    return res.status(500).json({
      success: false,
      message: "Server error while modifying membership",
      error: err.message,
    });
  }
};

// Admin: stats
exports.getMembershipStats = async (req, res) => {
  try {
    const todayStr = new Date().toISOString().split("T")[0];

    const { error: expireError } = await supabase
      .from("user_memberships")
      .update({
        status: "expired",
        updated_at: new Date().toISOString(),
      })
      .lt("end_date", todayStr)
      .eq("status", "active");

    if (expireError) {
      return res.status(500).json({
        success: false,
        message: "Failed to refresh expired memberships",
        error: expireError.message,
      });
    }

    const { data, error } = await supabase
      .from("user_memberships")
      .select("*");

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch membership stats",
        error: error.message,
      });
    }

    const rows = data || [];

    const stats = {
      total: rows.length,
      counts: {
        active: 0,
        expired: 0,
        inactive: 0,
        cancelled: 0,
        suspended: 0,
      },
      totalRevenue: 0,
    };

    for (const member of rows) {
      const amount = Number(member.final_amount || 0);
      if (!Number.isNaN(amount)) {
        stats.totalRevenue += amount;
      }

      if (member.status === "active") stats.counts.active++;
      else if (member.status === "expired") stats.counts.expired++;
      else if (member.status === "inactive") stats.counts.inactive++;
      else if (member.status === "cancelled") stats.counts.cancelled++;
      else if (member.status === "suspended") stats.counts.suspended++;
    }

    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error while fetching membership stats",
      error: err.message,
    });
    
  }
};
// Admin: delete member (user + their memberships)
exports.deleteMember = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // 1. Delete all memberships for this user (ignore if none exist)
    await supabase
      .from("user_memberships")
      .delete()
      .eq("user_id", userId);

    // 2. Delete payments for this user (ignore if none exist)
    await supabase
      .from("payments")
      .delete()
      .eq("user_id", userId);

    // 3. Delete the user itself
    const { error: userError } = await supabase
      .from("users")
      .delete()
      .eq("id", userId);

    if (userError) {
      return res.status(500).json({
        success: false,
        message: "Failed to delete user",
        error: userError.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Member and all associated data deleted successfully",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error while deleting member",
      error: err.message,
    });
  }
};