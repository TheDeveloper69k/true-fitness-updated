const supabase = require("../config/supabaseClient");

// ─── Get All Receipts (with filters) ─────────────────────────
// GET /api/v1/receipts?search=&from=&to=&page=&limit=
const getReceipts = async (req, res) => {
    try {
        let { search, from, to, page = 1, limit = 20 } = req.query;
        page = parseInt(page) || 1;
        limit = parseInt(limit) || 20;
        const offset = (page - 1) * limit;

        // Resolve search term to matching user ids / a payment id BEFORE paginating,
        // so a match on an older page isn't hidden by the current page's slice.
        let matchedUserIds = null;
        let matchedPaymentId = null;

        if (search) {
            const q = search.trim();

            const { data: matchedUsers, error: userSearchError } = await supabase
                .from("users")
                .select("id")
                .or(`name.ilike.%${q}%,phone.ilike.%${q}%`);

            if (userSearchError) {
                console.error("[GetReceipts] User search error:", userSearchError);
                return res.status(500).json({ success: false, message: "Failed to search receipts" });
            }

            matchedUserIds = (matchedUsers || []).map((u) => u.id);

            if (/^\d+$/.test(q)) {
                matchedPaymentId = parseInt(q, 10);
            }

            if (matchedUserIds.length === 0 && matchedPaymentId === null) {
                return res.status(200).json({
                    success: true,
                    data: [],
                    pagination: { total: 0, page, limit, pages: 0 },
                });
            }
        }

        // Base query — join payments → users → membership_plans
        let query = supabase
            .from("payments")
            .select(`
        id,
        amount,
        currency,
        status,
        payment_method,
        transaction_id,
        payment_date,
        paid_at,
        membership_end_date,
        user:users!payments_user_id_fkey ( id, name, phone, email ),
        plan:membership_plans!payments_plan_id_fkey ( id, name, duration_days, price )
      `, { count: "exact" })
            .eq("status", "success")
            .order("payment_date", { ascending: false });

        if (search) {
            const orParts = [];
            if (matchedUserIds.length > 0) orParts.push(`user_id.in.(${matchedUserIds.join(",")})`);
            if (matchedPaymentId !== null) orParts.push(`id.eq.${matchedPaymentId}`);
            query = query.or(orParts.join(","));
        }

        // Date filters
        if (from) query = query.gte("payment_date", new Date(from).toISOString());
        if (to) {
            const toEnd = new Date(to);
            toEnd.setHours(23, 59, 59, 999);
            query = query.lte("payment_date", toEnd.toISOString());
        }

        query = query.range(offset, offset + limit - 1);

        const { data, error, count } = await query;

        if (error) {
            console.error("[GetReceipts] Error:", error);
            return res.status(500).json({ success: false, message: "Failed to fetch receipts" });
        }

        return res.status(200).json({
            success: true,
            data: data || [],
            pagination: {
                total: count,
                page,
                limit,
                pages: Math.ceil(count / limit),
            },
        });
    } catch (err) {
        console.error("[GetReceipts] Unexpected:", err);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

// ─── Get Single Receipt ───────────────────────────────────────
// GET /api/v1/receipts/:id
const getReceiptById = async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from("payments")
            .select(`
        id,
        amount,
        currency,
        status,
        payment_method,
        transaction_id,
        razorpay_order_id,
        payment_date,
        paid_at,
        membership_end_date,
        user:users!payments_user_id_fkey ( id, name, phone, email, whatsapp_number ),
        plan:membership_plans!payments_plan_id_fkey ( id, name, duration_days, price, features )
      `)
            .eq("id", id)
            .eq("status", "success")
            .maybeSingle();

        if (error) {
            console.error("[GetReceiptById] Error:", error);
            return res.status(500).json({ success: false, message: "Failed to fetch receipt" });
        }

        if (!data) {
            return res.status(404).json({ success: false, message: "Receipt not found" });
        }

        return res.status(200).json({ success: true, data });
    } catch (err) {
        console.error("[GetReceiptById] Unexpected:", err);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

// ─── Get Receipts Summary Stats ───────────────────────────────
// ─── Revenue range helpers (IST) ──────────────────────────────
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const istMonthStart = (monthOffset = 0) => {
    const istNow = new Date(Date.now() + IST_OFFSET_MS);
    const ms = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() + monthOffset, 1);
    return new Date(ms - IST_OFFSET_MS);
};

const labelForMonth = (d) => {
    const ist = new Date(d.getTime() + IST_OFFSET_MS);
    return `${MONTH_NAMES[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
};

const resolveRange = (range) => {
    const n = parseInt(range, 10);
    if (n >= 1 && n <= 3) {
        const from = istMonthStart(-n);
        const to = istMonthStart(0);
        const lastMonth = new Date(to.getTime() - 1);
        const label = n === 1
            ? labelForMonth(from)
            : `${labelForMonth(from)} – ${labelForMonth(lastMonth)}`;
        return { key: String(n), from, to, label };
    }
    const from = istMonthStart(0);
    return { key: "this_month", from, to: new Date(Date.now() + 1000), label: `This month (${labelForMonth(from)})` };
};

const fetchAllSuccessfulPayments = async () => {
    const pageSize = 1000;
    let all = [];
    for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
            .from("payments")
            .select("amount, payment_date")
            .eq("status", "success")
            .order("id", { ascending: true })
            .range(offset, offset + pageSize - 1);
        if (error) return { error };
        all = all.concat(data);
        if (data.length < pageSize) break;
    }
    return { data: all };
};

// GET /api/v1/receipts/stats?range=this_month|1|2|3
const getReceiptStats = async (req, res) => {
    try {
        const { data, error } = await fetchAllSuccessfulPayments();
        if (error) {
            return res.status(500).json({ success: false, message: "Failed to fetch stats" });
        }

        const total = data.length;
        const revenue = data.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

        const range = resolveRange(req.query.range);
        const inRange = data.filter(p => {
            const t = new Date(p.payment_date).getTime();
            return t >= range.from.getTime() && t < range.to.getTime();
        });
        const rangeRevenue = inRange.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

        return res.status(200).json({
            success: true,
            data: {
                total_receipts: total,
                total_revenue: revenue,
                month_receipts: inRange.length,
                month_revenue: rangeRevenue,
                range: range.key,
                range_label: range.label,
            },
        });
    } catch (err) {
        console.error("[GetReceiptStats] Unexpected:", err);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

module.exports = { getReceipts, getReceiptById, getReceiptStats };