// ─────────────────────────────────────────────
//  Utilities
// ─────────────────────────────────────────────

const setText = (id, val) => {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
};

const capitalize = (s = "") => s.charAt(0).toUpperCase() + s.slice(1);

const formatDate = (d) => {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN");
};

const escapeHtml = (str = "") =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const escapeJsString = (str = "") =>
  String(str).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────

let currentMemberFilter = "all";
let cachedPlans = [];
let cachedTrainers = [];
let cachedMemberRows = [];
let membersSearchQuery = "";
let memberSearchTimer = null;

// ─────────────────────────────────────────────
//  Navigation / sidebar
// ─────────────────────────────────────────────

function navigate(page, el = null) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.getElementById(`page-${page}`)?.classList.add("active");

  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  if (el) el.classList.add("active");

  if (page === "membership") {
    loadAdminPlans();
  }
  if (page === "diet") {
  initWeeklyDietBuilder();
  loadDiet("all");
}
  if (page === "receipts") loadReceipts(1);
  if (page === "gym-plans") loadGymPlans();
}

function toggleSidebar() {
  document.getElementById("sidebar")?.classList.toggle("collapsed");
}

// ─────────────────────────────────────────────
//  Bulk checkbox
// ─────────────────────────────────────────────

function toggleAll(source, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = source.checked;
  });
}

// ─────────────────────────────────────────────
//  Global topbar search
// ─────────────────────────────────────────────

function handleSearch(value) {
  const q = value.trim().toLowerCase();

  ["dashMemberBody", "memberBody"].forEach((tbodyId) => {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    [...tbody.querySelectorAll("tr")].forEach((tr) => {
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  });
}

// ─────────────────────────────────────────────
//  Members page — dedicated search
// ─────────────────────────────────────────────

function debouncedMemberSearch(value) {
  clearTimeout(memberSearchTimer);
  memberSearchTimer = setTimeout(() => {
    membersSearchQuery = value.trim().toLowerCase();
    renderMemberTable("memberBody", cachedMemberRows, currentMemberFilter);
  }, 280);
}

function clearMemberSearch() {
  const input = document.getElementById("memberSearch");
  if (input) input.value = "";
  membersSearchQuery = "";
  renderMemberTable("memberBody", cachedMemberRows, currentMemberFilter);
}

// ─────────────────────────────────────────────
//  Modal helpers
// ─────────────────────────────────────────────

function openModal(title, desc, bodyHtml, onConfirm, confirmText = "Continue") {
  const overlay = document.getElementById("modalOverlay");
  const titleEl = document.getElementById("modalTitle");
  const descEl = document.getElementById("modalDesc");
  const bodyEl = document.getElementById("modalBody");
  const confirmBtn = document.getElementById("modalConfirmBtn");

  if (!overlay || !titleEl || !descEl || !bodyEl || !confirmBtn) return;

  titleEl.textContent = title || "Modal";
  descEl.textContent = desc || "";
  bodyEl.innerHTML = bodyHtml || "";
  overlay.style.display = "flex";

  const newBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
  newBtn.textContent = confirmText;

  newBtn.onclick = async () => {
    try {
      newBtn.disabled = true;
      await onConfirm?.();
    } catch (err) {
      console.error("Modal confirm error:", err);
      showToast("Something went wrong", "error");
    } finally {
      newBtn.disabled = false;
    }
  };
}

function closeModal() {
  const overlay = document.getElementById("modalOverlay");
  if (overlay) overlay.style.display = "none";

  const bodyEl = document.getElementById("modalBody");
  if (bodyEl) bodyEl.innerHTML = "";
}

window.onclick = function (e) {
  const overlay = document.getElementById("modalOverlay");
  if (e.target === overlay) closeModal();
};

// ─────────────────────────────────────────────
//  Toast
// ─────────────────────────────────────────────

function showToast(message, type = "info") {
  console.log(`[${type.toUpperCase()}] ${message}`);
  alert(message);
}

// ─────────────────────────────────────────────
//  Dashboard stats
// ─────────────────────────────────────────────

async function loadDashboardStats() {
  const memberRes = await API.get("/memberships/stats");

  if (memberRes?.ok) {
    const d = memberRes.data.data || {};
    const counts = d.counts || {};

    setText("totalMembers", d.total ?? 0);
    setText("activeMembers", counts.active ?? 0);
    setText("expiredMembers", counts.expired ?? 0);
  } else {
    setText("totalMembers", 0);
    setText("activeMembers", 0);
    setText("expiredMembers", 0);
  }
}

async function loadTrainerStats() {
  const res = await API.get("/trainers/admin/stats/summary");

  if (!res?.ok) {
    setText("totalTrainers", 0);
    setText("activeTrainers", 0);
    setText("assignedMembersCount", 0);
    return;
  }

  const d = res.data.data || {};
  setText("totalTrainers", d.total ?? 0);
  setText("activeTrainers", d.active ?? 0);
  setText("assignedMembersCount", d.assigned_members ?? 0);
}

// ─────────────────────────────────────────────
//  Members  — load + render
// ─────────────────────────────────────────────

function setMemberFilter(filter) {
  currentMemberFilter = filter || "all";
  membersSearchQuery = "";
  const input = document.getElementById("memberSearch");
  if (input) input.value = "";
  loadMembers();
}

async function loadMembers(targetTbodyId = "memberBody") {
  let endpoint = "/memberships";

  if (currentMemberFilter !== "all") {
    endpoint += `?status=${encodeURIComponent(currentMemberFilter)}`;
  }

  const res = await API.get(endpoint);

  if (!res?.ok) {
    cachedMemberRows = [];
    renderMemberTable(targetTbodyId, [], currentMemberFilter);
    if (targetTbodyId === "memberBody") {
      renderMemberTable("dashMemberBody", [], currentMemberFilter);
    }
    return;
  }

  const rows = res.data.data || [];
  cachedMemberRows = rows;

  renderMemberTable(targetTbodyId, rows, currentMemberFilter);

  if (targetTbodyId === "memberBody") {
    renderMemberTable("dashMemberBody", rows, currentMemberFilter);
  }
}

function highlightMatch(text, query) {
  const safe = escapeHtml(String(text));
  if (!query) return safe;

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(
    new RegExp(escaped, "gi"),
    (match) => `<span class="hl">${match}</span>`
  );
}

function renderMemberTable(tbodyId, rows, filter = "all") {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  let filtered = rows;
  const isSearchable = tbodyId === "memberBody";

  if (isSearchable && membersSearchQuery) {
    filtered = rows.filter((m) => {
      const name = (m.name || m.full_name || "").toLowerCase();
      const phone = (m.phone || "").toLowerCase();
      return name.includes(membersSearchQuery) || phone.includes(membersSearchQuery);
    });
  }

  if (isSearchable) {
    const infoEl = document.getElementById("memberSearchInfo");
    if (infoEl) {
      if (membersSearchQuery) {
        infoEl.style.display = "block";
        infoEl.innerHTML = `Showing <strong>${filtered.length}</strong> of <strong>${rows.length}</strong> members for &ldquo;<strong>${escapeHtml(membersSearchQuery)}</strong>&rdquo;`;
      } else {
        infoEl.style.display = "none";
      }
    }
  }

  if (!filtered.length) {
    let emptyText;
    if (isSearchable && membersSearchQuery) {
      emptyText = `No members found for &ldquo;${escapeHtml(membersSearchQuery)}&rdquo;`;
    } else if (filter === "all") {
      emptyText = "No members found";
    } else {
      emptyText = `No ${filter} members found`;
    }

    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;padding:20px;color:gray">
          ${emptyText}
        </td>
      </tr>`;
    return;
  }

  const hlQuery = isSearchable ? membersSearchQuery : "";

  tbody.innerHTML = filtered
    .map((m) => {
      const statusClass =
        m.status === "active"
          ? "green"
          : m.status === "expired" || m.status === "cancelled"
            ? "red"
            : "amber";

      const memberName = m.name || m.full_name || "User";
      const safeName = highlightMatch(memberName, hlQuery);
      const safeNameForJs = escapeJsString(memberName);
      const phone = m.phone || "-";
      const safePhone = highlightMatch(phone, hlQuery);
      const dob = formatDate(m.date_of_birth);
      const joiningDate = formatDate(m.start_date);
      const plan = escapeHtml(m.monthly_plan || "-");
      const amount = Number(m.final_amount ?? 0);

      // user_id = actual user, m.id = membership row
      const deleteUserId = m.user_id || m.id;

      return `
      <tr>
        <td><input type="checkbox"/></td>
        <td>${safeName}</td>
        <td>${safePhone}</td>
        <td>${dob}</td>
        <td>${joiningDate}</td>
        <td>${plan}</td>
        <td>₹${amount.toLocaleString("en-IN")}</td>
        <td><span class="pill pill-${statusClass}">${capitalize(m.status || "—")}</span></td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="tc-btn" onclick="openStatusModal(${m.id}, '${m.status || "active"}')">✏️ Status</button>
            <button class="tc-btn" onclick="openRenewMembershipModal(${m.id}, '${safeNameForJs}', '${escapeJsString(m.monthly_plan || "")}')">🔄 Renew</button>
            <button class="tc-btn" style="color:#f87171;border-color:rgba(232,40,26,.35)"
              onclick="openDeleteMemberModal('${deleteUserId}', '${safeNameForJs}')">🗑 Delete</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

// ─────────────────────────────────────────────
//  Add Member modal
// ─────────────────────────────────────────────

function openAddMemberModal() {
  openModal(
    "👤 Add New Member",
    "Register a new user account",
    `
    <div class="form-group"><label>Full Name</label><input id="mName" type="text" autocomplete="off" placeholder="John Doe"/></div>
    <div class="form-group"><label>Phone</label><input id="mPhone" type="tel" autocomplete="off" placeholder="9876543210" maxlength="10" oninput="this.value=this.value.replace(/\\D/g,'').slice(0,10)"/></div>
    <div class="form-group"><label>Email (optional)</label><input id="mEmail" type="email" autocomplete="off" placeholder="john@example.com"/></div>
    <div class="form-group">
      <label>Password</label>
      <div style="position:relative">
        <input id="mPass" type="password" autocomplete="new-password" placeholder="Password" style="padding-right:40px;width:100%"/>
        <span onclick="const i=document.getElementById('mPass');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'👁':'🙈'" 
          style="position:absolute;right:10px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:16px;user-select:none">👁</span>
      </div>
    </div>
    `,
    addMember,
    "Create User"
  );
}

async function addMember() {
  console.log("ADD MEMBER CLICKED");
  const name = document.getElementById("mName")?.value?.trim() || "";
  const phone = document.getElementById("mPhone")?.value?.trim() || "";
  const email = document.getElementById("mEmail")?.value?.trim() || "";
  const password = document.getElementById("mPass")?.value?.trim() || "";

  if (!name) return showToast("Full name is required", "error");
  if (name.length < 2) return showToast("Please enter a valid full name", "error");
  if (!phone) return showToast("Phone is required", "error");
  if (!/^[0-9]{10}$/.test(phone)) return showToast("Phone number must be exactly 10 digits", "error");
  if (!password) return showToast("Password is required", "error");
  if (password.length < 6) return showToast("Password must be at least 6 characters", "error");

  const payload = { name, phone, password };
  if (email) payload.email = email;

  const res = await API.post("/auth/register", payload);

  if (res?.ok) {
    const userId = res?.data?.data?.id;
    closeModal();

    // ❌ Removed loadDashboardStats() and loadMembers() here
    // Table will refresh after step 2 completes (assignMembership) 
    // or after cancel (handleSkip) — never in between

    if (userId) {
      setTimeout(() => openAssignMembershipModal(userId, name, true), 300);
    }
    return;
  }

  showToast(res?.data?.message || "Failed to create user", "error");
}
// ─────────────────────────────────────────────
//  ADMIN PLAN MANAGEMENT
// ─────────────────────────────────────────────

async function loadAdminPlans() {
  const res = await API.get('/plans');
  if (!res || !res.ok) return;
  const plans = res.data.data || [];
  window.currentPlans = plans;

  const container = document.getElementById("adminPlansContainer");
  if (!container) return;

  if (!plans.length) {
    container.innerHTML = `<div class="gen-card" style="text-align:center;color:var(--muted);grid-column:1/-1">No plans found. Add your first plan.</div>`;
    return;
  }

  container.innerHTML = "";

  plans.forEach(plan => {
    const div = document.createElement("div");
    div.className = `plan-card${plan.is_active ? '' : ' inactive'}`;

    const features = Array.isArray(plan.features)
      ? plan.features
      : typeof plan.features === 'string'
        ? plan.features.split(',').map(f => f.trim()).filter(Boolean)
        : [];

    const featuresHtml = features.length
      ? `<ul>${features.map(f => `<li>${f}</li>`).join('')}</ul>`
      : '';

    const popularHtml = plan.name === "3 Months"
      ? `<div class="popular-badge">⭐ Popular</div>`
      : '';

    div.innerHTML = `
      <div class="plan-name">${plan.name}</div>
      <div class="plan-price">₹${Number(plan.price).toLocaleString('en-IN')}</div>
      <div class="plan-period">${plan.duration_days} days</div>
      ${featuresHtml}
      ${popularHtml}
      <div class="plan-actions">
        <button onclick="editPlan(${plan.id})">✏️ Edit</button>
        <button onclick="togglePlan(${plan.id}, ${plan.is_active})">
          ${plan.is_active ? '⛔ Deactivate' : '✅ Activate'}
        </button>
        
      </div>
    `;

    container.appendChild(div);
  });
}

function openAddPlanModal() {
  openModal(
    "Add Plan",
    "Create new membership plan",
    `
    <div class="form-group">
      <label>Name</label>
      <input id="planName" />
    </div>
    <div class="form-group">
      <label>Price</label>
      <input id="planPrice" type="number" />
    </div>
    <div class="form-group">
      <label>Duration</label>
      <input id="planDuration" type="number" />
    </div>
    <div class="form-group">
      <label>Features (comma separated)</label>
      <input id="planFeatures" placeholder="Gym, Trainer, Diet" />
    </div>
    `,
    async () => {
      const name = document.getElementById("planName").value;
      const price = document.getElementById("planPrice").value;
      const duration = document.getElementById("planDuration").value;
      const features = document
        .getElementById("planFeatures")
        .value
        .split(",")
        .map(f => f.trim());

      const res = await API.post('/plans', {
        name,
        price,
        duration_days: duration,
        features
      });

      if (res?.ok) {
        showToast("Plan added", "success");
        loadAdminPlans();
        closeModal();
      }
    }
  );
}

async function deletePlan(id) {
  if (!confirm("Deactivate this plan instead of deleting?")) return;

  const res = await API.put(`/plans/${id}`, { is_active: false });

  if (res?.ok) {
    showToast("Plan deactivated instead of deleted", "success");
    loadAdminPlans();
  }
}

async function fetchPlans() {
  const res = await API.get("/plans");
  if (!res?.ok) return [];
  return res.data.data || [];
}

async function ensurePlansLoaded() {
  if (cachedPlans.length) return cachedPlans;
  cachedPlans = await fetchPlans();
  return cachedPlans;
}

function fillPlanDropdown(selectId, selectedName = "") {
  const select = document.getElementById(selectId);
  if (!select) return;

  if (!cachedPlans.length) {
    select.innerHTML = `<option value="">No plans found</option>`;
    return;
  }

  select.innerHTML = `<option value="">Select Plan</option>`;

  cachedPlans.forEach((plan) => {
    const option = document.createElement("option");
    option.value = plan.name;
    option.textContent = `${plan.name} - ₹${plan.price} / ${plan.duration_days} days`;
    option.dataset.price = plan.price;
    option.dataset.duration = plan.duration_days;

    if (selectedName && plan.name === selectedName) {
      option.selected = true;
    }

    select.appendChild(option);
  });
}

function handleAssignPlanChange() {
  const planSelect = document.getElementById("planName");
  const priceInput = document.getElementById("planPrice");
  const durationInput = document.getElementById("planDuration");

  if (!planSelect) return;

  const selectedOption = planSelect.options[planSelect.selectedIndex];
  if (priceInput) priceInput.value = selectedOption?.dataset?.price || "";
  if (durationInput) durationInput.value = selectedOption?.dataset?.duration || "";
}

function handleRenewPlanChange() {
  const planSelect = document.getElementById("renewPlanName");
  const priceInput = document.getElementById("renewPlanPrice");
  const durationInput = document.getElementById("renewPlanDuration");

  if (!planSelect) return;

  const selectedOption = planSelect.options[planSelect.selectedIndex];
  if (priceInput) priceInput.value = selectedOption?.dataset?.price || "";
  if (durationInput) durationInput.value = selectedOption?.dataset?.duration || "";
}

// ─────────────────────────────────────────────
//  Assign Membership modal
// ─────────────────────────────────────────────

async function openAssignMembershipModal(userId, name, deletable = false) {
  await ensurePlansLoaded();

  const restoreDefaultOverlayClick = () => {
    window.onclick = function (e) {
      const overlay = document.getElementById("modalOverlay");
      if (e.target === overlay) closeModal();
    };
  };

  const handleSkip = async () => {
    if (deletable) {
      await API.delete(`/memberships/user/${userId}`);
      showToast("Member registration cancelled", "info");
      closeModal();

      window._currentSkipHandler = null;
      restoreDefaultOverlayClick();

      await loadDashboardStats();
      await loadMembers();
    } else {
      closeModal();

      window._currentSkipHandler = null;
      restoreDefaultOverlayClick();
    }
  };

  window._currentSkipHandler = handleSkip;

  window.onclick = function (e) {
    const overlay = document.getElementById("modalOverlay");
    if (e.target === overlay && window._currentSkipHandler) {
      window._currentSkipHandler();
    }
  };

  openModal(
    "💎 Assign Membership",
    `User: ${name}`,
    `
    <div class="form-group"><label>Date of Birth</label><input id="dob" type="date"/></div>

    <div class="form-group">
      <label>Plan Name</label>
      <select id="planName" onchange="handleAssignPlanChange()">
        <option value="">Select Plan</option>
      </select>
    </div>

    <div class="form-group">
      <label>Plan Price</label>
      <input id="planPrice" type="number" readonly />
    </div>

    <div class="form-group">
      <label>Duration (Days)</label>
      <input id="planDuration" type="number" readonly />
    </div>

    <div class="form-group">
      <label>Discount</label>
      <input id="discount" type="number" min="0" value="0" />
    </div>

    <div class="form-group">
      <label>Status</label>
      <select id="memberStatus">
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="cancelled">Cancelled</option>
        <option value="suspended">Suspended</option>
      </select>
    </div>

    <div class="form-group">
      <label>Start Date</label>
      <input id="startDate" type="date" value="${new Date().toISOString().split("T")[0]}"/>
    </div>

    <div class="form-group">
      <label>Payment Method</label>
      <select id="paymentMethod">
        <option value="cash">Cash</option>
        <option value="upi">UPI</option>
        <option value="card">Card</option>
        <option value="bank_transfer">Bank Transfer</option>
      </select>
    </div>

    <div style="margin-top:8px">
      <button class="tc-btn" style="width:100%;color:#f87171;border-color:rgba(232,40,26,.35)"
        onclick="window._currentSkipHandler()">✕ Cancel & Discard Member</button>
    </div>
    `,
    () => assignMembership(userId, true),
    "Continue"
  );

  fillPlanDropdown("planName");
}

async function assignMembership(userId, assigned = false) {
  const monthly_plan = document.getElementById("planName")?.value?.trim() || "";
  const discount = document.getElementById("discount")?.value?.trim() || "0";
  const date_of_birth = document.getElementById("dob")?.value || null;
  const status = document.getElementById("memberStatus")?.value || "active";
  const start_date = document.getElementById("startDate")?.value || "";
  const payment_method =
  document.getElementById("paymentMethod").value;

  if (!monthly_plan) return showToast("Plan name is required", "error");
  if (!start_date) return showToast("Start date is required", "error");

  const payload = {
  user_id: parseInt(userId, 10),
  monthly_plan,
  discount: parseFloat(discount || 0),
  date_of_birth,
  status,
  start_date,
  payment_method,
};

  const res = await API.post("/memberships/assign", payload);

  if (res?.ok) {
    showToast("Membership added successfully", "success");

    // ✅ Restore default window.onclick after successful assign
    window.onclick = function (e) {
      const overlay = document.getElementById("modalOverlay");
      if (e.target === overlay) closeModal();
    };
    window._currentSkipHandler = null;

    closeModal();
    await loadDashboardStats();
    await loadMembers();
  } else {
    showToast(res?.data?.message || "Failed to assign membership", "error");
  }
}
// ─────────────────────────────────────────────
//  Status modal
// ─────────────────────────────────────────────

function openStatusModal(membershipId, currentStatus) {
  openModal(
    "✏️ Update Status",
    `Current status: ${capitalize(currentStatus)}`,
    `
    <div class="form-group">
      <label>New Status</label>
      <select id="newStatus">
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="expired">Expired</option>
        <option value="cancelled">Cancelled</option>
        <option value="suspended">Suspended</option>
      </select>
    </div>
    `,
    () => updateMembershipStatus(membershipId),
    "Update"
  );

  setTimeout(() => {
    const select = document.getElementById("newStatus");
    if (select) select.value = currentStatus || "active";
  }, 0);
}

async function updateMembershipStatus(membershipId) {
  const status = document.getElementById("newStatus")?.value;

  const res = await API.patch(`/memberships/${membershipId}/status`, { status });

  if (res?.ok) {
    showToast("Status updated successfully", "success");
    closeModal();
    await loadDashboardStats();
    await loadMembers();
  } else {
    showToast(res?.data?.message || "Failed to update status", "error");
  }
}

// ─────────────────────────────────────────────
//  Renew Membership modal
// ─────────────────────────────────────────────

async function openRenewMembershipModal(membershipId, memberName, currentPlan) {
  await ensurePlansLoaded();

  openModal(
    "🔄 Renew Membership",
    `Renew plan for ${memberName}`,
    `
    <div class="form-group">
      <label>Plan Name</label>
      <select id="renewPlanName" onchange="handleRenewPlanChange()">
        <option value="">Select Plan</option>
      </select>
    </div>

    <div class="form-group">
      <label>Plan Price</label>
      <input id="renewPlanPrice" type="number" readonly />
    </div>

    <div class="form-group">
      <label>Duration (Days)</label>
      <input id="renewPlanDuration" type="number" readonly />
    </div>

    <div class="form-group">
      <label>Discount</label>
      <input id="renewDiscount" type="number" min="0" value="0" />
    </div>

    <div class="form-group">
      <label>Start Date</label>
      <input id="renewStartDate" type="date" value="${new Date().toISOString().split("T")[0]}" />
    </div>
    `,
    () => renewMembership(membershipId),
    "Continue"
  );

  fillPlanDropdown("renewPlanName", currentPlan || "");
  handleRenewPlanChange();
}

async function renewMembership(membershipId) {
  const monthly_plan = document.getElementById("renewPlanName")?.value?.trim() || "";
  const discount = document.getElementById("renewDiscount")?.value?.trim() || "0";
  const start_date = document.getElementById("renewStartDate")?.value || "";

  if (!monthly_plan) return showToast("Plan name is required", "error");
  if (!start_date) return showToast("Start date is required", "error");

  const res = await API.patch(`/memberships/${membershipId}/renew`, {
    monthly_plan,
    discount: parseFloat(discount || 0),
    start_date,
  });

  if (res?.ok) {
    showToast("Membership renewed successfully", "success");
    closeModal();
    await loadDashboardStats();
    await loadMembers();
  } else {
    showToast(res?.data?.message || "Failed to renew membership", "error");
  }
}

// ─────────────────────────────────────────────
//  Delete Member
// ─────────────────────────────────────────────

function openDeleteMemberModal(userId, memberName) {
  openModal(
    "🗑 Delete Member",
    `Permanently delete "${memberName}"?`,
    `<p style="font-size:13px;color:#f87171;line-height:1.6">
      ⚠️ This will <strong>permanently remove</strong> the member,
      all their memberships, and payment records.<br/><br/>
      This action <strong>cannot be undone</strong>.
    </p>`,
    async () => {
      const res = await API.delete(`/memberships/user/${userId}`);

      if (res?.ok) {
        showToast("Member deleted successfully 🗑️", "success");
        closeModal();
        await loadDashboardStats();
        await loadMembers();
        return;
      }

      showToast(res?.data?.message || "Failed to delete member", "error");
    },
    "Delete"
  );
}

// ─────────────────────────────────────────────
//  Trainers — helpers
// ─────────────────────────────────────────────

async function fetchTrainers(activeOnly = false) {
  const endpoint = activeOnly
    ? "/trainers?active=true&limit=100"
    : "/trainers?limit=100";
  const res = await API.get(endpoint);
  if (!res?.ok) return [];
  return res.data.data || [];
}

async function ensureTrainersLoaded(activeOnly = false) {
  cachedTrainers = await fetchTrainers(activeOnly);
  return cachedTrainers;
}

function fillTrainerDropdown(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;

  if (!cachedTrainers.length) {
    select.innerHTML = `<option value="">No active trainers found</option>`;
    return;
  }

  select.innerHTML = `<option value="">Select Trainer</option>`;

  cachedTrainers.forEach((trainer) => {
    const option = document.createElement("option");
    option.value = trainer.id;
    option.textContent = `${trainer.name} - ${trainer.specialization || "General"} (${trainer.experience || 0} yrs)`;
    select.appendChild(option);
  });
}

// ─────────────────────────────────────────────
//  Add Trainer modal
// ─────────────────────────────────────────────

function openAddTrainerModal() {
  openModal(
    "🏋️ Add Trainer",
    "Create a new trainer profile",
    `
    <div class="form-group">
      <label>Trainer Name</label>
      <input id="trainerName" type="text" placeholder="Rahul Sharma" />
    </div>

    <div class="form-group">
      <label>Specialization</label>
      <input id="trainerSpecialization" type="text" placeholder="Weight Training" />
    </div>

    <div class="form-group">
      <label>Experience (Years)</label>
      <input id="trainerExperience" type="number" min="0" placeholder="2" />
    </div>

    <div class="form-group">
      <label>Phone</label>
      <input id="trainerPhone" type="tel" placeholder="9876543210" maxlength="10" oninput="this.value=this.value.replace(/\\D/g,'').slice(0,10)" />
    </div>
    `,
    addTrainer,
    "Create Trainer"
  );
}

async function addTrainer() {
  const name = document.getElementById("trainerName")?.value?.trim() || "";
  const specialization = document.getElementById("trainerSpecialization")?.value?.trim() || "";
  const experience = document.getElementById("trainerExperience")?.value?.trim() || "0";
  const phone = document.getElementById("trainerPhone")?.value?.trim() || "";

  if (!name) return showToast("Trainer name is required", "error");
  if (name.length < 2) return showToast("Please enter a valid trainer name", "error");

  if (phone && !/^[0-9]{10,15}$/.test(phone)) {
    return showToast("Phone must be 10 to 15 digits only", "error");
  }

  const payload = {
    name,
    specialization: specialization || null,
    experience: parseInt(experience || "0", 10),
    phone: phone || null,
  };

  const res = await API.post("/trainers", payload);

  if (res?.ok) {
    showToast("Trainer created successfully", "success");
    closeModal();
    await loadTrainerStats();
    await loadTrainers();
    return;
  }

  showToast(res?.data?.message || "Failed to create trainer", "error");
}

// ─────────────────────────────────────────────
//  Trainers — load + render
// ─────────────────────────────────────────────

async function loadTrainers() {
  const res = await API.get("/trainers?limit=100");

  if (!res?.ok) {
    renderTrainerGrid([]);
    return;
  }

  const rows = res.data.data || [];
  cachedTrainers = rows;
  renderTrainerGrid(rows);
}

function renderTrainerGrid(rows) {
  const grid = document.getElementById("trainerGrid");
  if (!grid) return;

  if (!rows.length) {
    grid.innerHTML = `
      <div class="trainer-card-wrap" style="text-align:center;color:gray">
        No trainers found
      </div>
    `;
    return;
  }

  grid.innerHTML = rows
    .map((t) => {
      const name = escapeHtml(t.name || "Trainer");
      const spec = escapeHtml(t.specialization || "Not specified");
      const exp = Number(t.experience || 0);
      const phone = escapeHtml(t.phone || "-");
      const activeText = t.is_active ? "Active" : "Inactive";
      const activeClass = t.is_active ? "green" : "red";
      const safeNameForJs = escapeJsString(t.name || "Trainer");
      const safeSpecForJs = escapeJsString(t.specialization || "");
      const safePhoneForJs = escapeJsString(t.phone || "");

      return `
        <div class="trainer-card-wrap">
          <div class="tc-top">
            <div class="admin-avatar">${name.slice(0, 2).toUpperCase()}</div>
            <div>
              <h3 style="font-size:15px">${name}</h3>
              <p style="font-size:12px;color:var(--muted)">${spec}</p>
            </div>
          </div>

          <div class="tc-meta">
            <span>📞 ${phone}</span>
            <span>🕒 ${exp} yrs</span>
          </div>

          <div style="margin-bottom:12px">
            <span class="pill pill-${activeClass}">${activeText}</span>
          </div>

          <div class="tc-footer">
            <button class="tc-btn" onclick="openEditTrainerModal(${t.id}, '${safeNameForJs}', '${safeSpecForJs}', '${t.experience || 0}', '${safePhoneForJs}')">✏️ Edit</button>
            <button class="tc-btn" onclick="toggleTrainerStatus(${t.id})">${t.is_active ? "⛔ Disable" : "✅ Enable"}</button>
            <button class="tc-btn" onclick="deleteTrainer(${t.id}, '${safeNameForJs}')">🗑 Delete</button>
          </div>

          <div class="tc-footer" style="margin-top:8px">
            <button class="tc-btn" onclick="viewTrainerMembers(${t.id}, '${safeNameForJs}')">👥 Members</button>
          </div>
        </div>
      `;
    })
    .join("");
}

// ─────────────────────────────────────────────
//  Edit Trainer modal
// ─────────────────────────────────────────────

function openEditTrainerModal(id, name, specialization, experience, phone) {
  openModal(
    "✏️ Edit Trainer",
    `Update trainer details for ${name}`,
    `
    <div class="form-group">
      <label>Trainer Name</label>
      <input id="editTrainerName" type="text" value="${escapeHtml(name)}" />
    </div>

    <div class="form-group">
      <label>Specialization</label>
      <input id="editTrainerSpecialization" type="text" value="${escapeHtml(specialization || "")}" />
    </div>

    <div class="form-group">
      <label>Experience</label>
      <input id="editTrainerExperience" type="number" min="0" value="${escapeHtml(String(experience || 0))}" />
    </div>

    <div class="form-group">
      <label>Phone</label>
     <input id="editTrainerPhone" type="tel" value="${escapeHtml(phone || "")}" maxlength="10" oninput="this.value=this.value.replace(/\\D/g,'').slice(0,10)" />
    </div>
    `,
    () => updateTrainer(id),
    "Update"
  );
}

async function updateTrainer(id) {
  const name = document.getElementById("editTrainerName")?.value?.trim() || "";
  const specialization = document.getElementById("editTrainerSpecialization")?.value?.trim() || "";
  const experience = document.getElementById("editTrainerExperience")?.value?.trim() || "0";
  const phone = document.getElementById("editTrainerPhone")?.value?.trim() || "";

  if (!name) return showToast("Trainer name is required", "error");
  if (phone && !/^[0-9]{10,15}$/.test(phone)) {
    return showToast("Phone must be 10 to 15 digits only", "error");
  }

  const payload = {
    name,
    specialization: specialization || null,
    experience: parseInt(experience || "0", 10),
    phone: phone || null,
  };

  const res = await API.put(`/trainers/${id}`, payload);

  if (res?.ok) {
    showToast("Trainer updated successfully", "success");
    closeModal();
    await loadTrainerStats();
    await loadTrainers();
    return;
  }

  showToast(res?.data?.message || "Failed to update trainer", "error");
}

async function toggleTrainerStatus(id) {
  const res = await API.patch(`/trainers/${id}/toggle-status`, {});

  if (res?.ok) {
    showToast(res?.data?.message || "Trainer status updated", "success");
    await loadTrainerStats();
    await loadTrainers();
    return;
  }

  showToast(res?.data?.message || "Failed to update trainer status", "error");
}

async function deleteTrainer(id, name) {
  openModal(
    "🗑 Delete Trainer",
    `Are you sure you want to delete ${name}?`,
    `<p style="font-size:13px;color:#bbb">This action cannot be undone.</p>`,
    async () => {
      const res = await API.delete(`/trainers/${id}`);

      if (res?.ok) {
        showToast("Trainer deleted successfully", "success");
        closeModal();
        await loadTrainerStats();
        await loadTrainers();
        return;
      }

      showToast(res?.data?.message || "Failed to delete trainer", "error");
    },
    "Delete"
  );
}

// ─────────────────────────────────────────────
//  Assign Trainer modal
// ─────────────────────────────────────────────

async function openAssignTrainerModal() {
  await ensureTrainersLoaded(true);

  openModal(
    "👤 Assign Trainer",
    "Search member by phone and assign an active trainer",
    `
    <div class="form-group">
      <label>Member Phone</label>
      <input id="assignMemberPhone" type="tel" placeholder="Enter member phone number" />
    </div>

    <div style="margin-bottom:12px">
      <button class="tc-btn" style="width:100%" onclick="searchMemberForTrainerAssign()">🔍 Search Member</button>
    </div>

    <div id="assignMemberResult" style="margin-bottom:12px"></div>

    <div class="form-group">
      <label>Select Trainer</label>
      <select id="assignTrainerId">
        <option value="">Select Trainer</option>
      </select>
    </div>
    `,
    assignTrainerToMember,
    "Assign Trainer"
  );

  fillTrainerDropdown("assignTrainerId");
}

async function searchMemberForTrainerAssign() {
  const phone = document.getElementById("assignMemberPhone")?.value?.trim() || "";
  const resultBox = document.getElementById("assignMemberResult");

  if (!phone) return showToast("Member phone is required", "error");
  if (!/^[0-9]{10,15}$/.test(phone)) return showToast("Enter valid phone number", "error");

  if (resultBox) {
    resultBox.innerHTML = `<p style="font-size:12px;color:#aaa">Searching member...</p>`;
  }

  const res = await API.get(`/users/search?phone=${encodeURIComponent(phone)}`);

  if (!res?.ok) {
    if (resultBox) {
      resultBox.innerHTML = `<p style="font-size:12px;color:#ff6b6b">Member not found</p>`;
      delete resultBox.dataset.memberId;
    }
    return;
  }

  const member = res.data.data;
  if (!member) {
    if (resultBox) {
      resultBox.innerHTML = `<p style="font-size:12px;color:#ff6b6b">Member not found</p>`;
      delete resultBox.dataset.memberId;
    }
    return;
  }

  if (resultBox) {
    resultBox.dataset.memberId = member.id;
    resultBox.innerHTML = `
      <div style="padding:12px;border:1px solid #333;border-radius:8px;background:#181818">
        <div style="font-weight:600">${escapeHtml(member.name || "User")}</div>
        <div style="font-size:12px;color:#aaa">Phone: ${escapeHtml(member.phone || "-")}</div>
        <div style="font-size:12px;color:#aaa">Email: ${escapeHtml(member.email || "-")}</div>
        <div style="font-size:12px;color:#aaa">Role: ${escapeHtml(member.role || "user")}</div>
      </div>
    `;
  }
}

async function assignTrainerToMember() {
  const resultBox = document.getElementById("assignMemberResult");
  const trainerId = document.getElementById("assignTrainerId")?.value || "";
  const memberId = resultBox?.dataset?.memberId || "";

  if (!memberId) return showToast("Please search member first", "error");
  if (!trainerId) return showToast("Please select a trainer", "error");

  const res = await API.post("/trainers/assign-member", {
    member_id: parseInt(memberId, 10),
    trainer_id: parseInt(trainerId, 10),
  });

  if (res?.ok) {
    showToast(res?.data?.message || "Trainer assigned successfully", "success");
    closeModal();
    await loadTrainerStats();
    await loadTrainers();
    return;
  }

  showToast(res?.data?.message || "Failed to assign trainer", "error");
}

// ─────────────────────────────────────────────
//  Trainer members modal
// ─────────────────────────────────────────────

async function viewTrainerMembers(trainerId, trainerName) {
  const res = await API.get(`/trainers/${trainerId}/members`);

  if (!res?.ok) {
    return showToast(res?.data?.message || "Failed to fetch trainer members", "error");
  }

  const rows = res.data.data || [];

  const bodyHtml = rows.length
    ? rows
      .map((row) => {
        const member = row.users || {};
        return `
            <div style="padding:10px;border:1px solid #333;border-radius:8px;margin-bottom:8px;background:#181818">
              <div style="font-weight:600">${escapeHtml(member.name || "User")}</div>
              <div style="font-size:12px;color:#aaa">Phone: ${escapeHtml(member.phone || "-")}</div>
              <div style="font-size:12px;color:#aaa">Email: ${escapeHtml(member.email || "-")}</div>
              <div style="font-size:12px;color:#aaa">Assigned: ${formatDate(row.assigned_at)}</div>
              <div style="margin-top:8px">
                <button class="tc-btn" onclick="removeTrainerAssignment(${member.id})">❌ Remove Assignment</button>
              </div>
            </div>
          `;
      })
      .join("")
    : `<p style="font-size:13px;color:#aaa">No members assigned to this trainer.</p>`;

  openModal(
    `👥 ${trainerName}`,
    "Assigned members",
    bodyHtml,
    () => closeModal(),
    "Close"
  );
}

async function removeTrainerAssignment(memberId) {
  const res = await API.delete(`/trainers/member/${memberId}/remove`);

  if (res?.ok) {
    showToast("Trainer removed from member successfully", "success");
    closeModal();
    await loadTrainerStats();
    await loadTrainers();
    return;
  }

  showToast(res?.data?.message || "Failed to remove trainer assignment", "error");
}

// ═════════════════════════════════════════════
//  NOTIFICATIONS MODULE
// ═════════════════════════════════════════════

let notifPage = 1;
const NOTIF_LIMIT = 15;
let notifTotalPages = 1;
let notifTypeFilter = "";
let notifTargetFilter = "";

async function initNotifications() {
  notifPage = 1;
  notifTypeFilter = "";
  notifTargetFilter = "";

  document.querySelectorAll(".notif-filter-btn").forEach((b, i) => {
    b.classList.toggle("notif-filter-active", i === 0);
  });

  document.querySelectorAll(".notif-target-btn").forEach((b, i) => {
    b.classList.toggle("notif-filter-active", i === 0);
  });

  await loadNotifications();
}

async function loadNotifications() {
  const tbody = document.getElementById("notifHistoryBody");
  const stats = document.getElementById("notifStats");

  if (tbody) tbody.innerHTML = notifLoadingRow();

  let endpoint = `/notifications?page=${notifPage}&limit=${NOTIF_LIMIT}`;
  if (notifTypeFilter) endpoint += `&type=${encodeURIComponent(notifTypeFilter)}`;
  if (notifTargetFilter) endpoint += `&target_type=${encodeURIComponent(notifTargetFilter)}`;

  const res = await API.get(endpoint);

  if (!res?.ok) {
    if (tbody) tbody.innerHTML = notifEmptyRow("Failed to load notifications");
    return;
  }

  const { data = [], count = 0, total_pages = 1 } = res.data;
  notifTotalPages = total_pages;

  if (stats) {
    const broadcast = data.filter((n) => n.target_type === "all").length;
    const personal = data.filter((n) => n.target_type === "user").length;

    stats.innerHTML = `
      <span class="notif-stat-pill">📋 Total: <strong>${count}</strong></span>
      <span class="notif-stat-pill">📢 Broadcast: <strong>${broadcast}</strong></span>
      <span class="notif-stat-pill">👤 Personal: <strong>${personal}</strong></span>
    `;
  }

  renderNotifPagination();

  if (!data.length) {
    if (tbody) tbody.innerHTML = notifEmptyRow("No notifications found");
    return;
  }

  if (tbody) tbody.innerHTML = data.map(renderNotifRow).join("");
}

function renderNotifRow(n) {
  const typeClass = {
    info: "notif-type-info",
    success: "notif-type-success",
    warning: "notif-type-warning",
    error: "notif-type-error",
  }[n.type] || "notif-type-info";

  const typeIcon = {
    info: "ℹ️",
    success: "✅",
    warning: "⚠️",
    error: "❌",
  }[n.type] || "ℹ️";

  const targetBadge =
    n.target_type === "all"
      ? `<span class="pill pill-green">📢 Broadcast</span>`
      : `<span class="pill pill-amber">👤 Personal</span>`;

  const memberInfo =
    n.target_type === "user" && n.users
      ? `<div class="notif-member-chip"><span>👤 ${escapeHtml(n.users.name || "—")}</span><span>📞 ${escapeHtml(n.users.phone || "—")}</span></div>`
      : "";

  const date = n.created_at
    ? new Date(n.created_at).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    : "—";

  const scheduledBadge = n.scheduled_at
    ? `<span class="notif-scheduled">🕒 ${new Date(n.scheduled_at).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })}</span>`
    : "";

  const activeBadge =
    n.is_active === false
      ? `<span class="pill pill-red" style="font-size:10px">Inactive</span>`
      : "";

  return `
    <tr>
      <td><span class="notif-type-badge ${typeClass}">${typeIcon} ${escapeHtml(n.type || "info")}</span></td>
      <td>
        <div class="notif-title-cell">
          <strong>${escapeHtml(n.title || "—")}</strong>
          <div class="notif-msg-preview">${escapeHtml((n.message || "").slice(0, 80))}${(n.message || "").length > 80 ? "…" : ""}</div>
          ${memberInfo}
          ${scheduledBadge}
          ${activeBadge}
        </div>
      </td>
      <td>${targetBadge}</td>
      <td style="font-size:12px;color:var(--muted)">${date}</td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="tc-btn" onclick="openViewNotifModal(${n.id})">👁 View</button>
          <button class="tc-btn" onclick="openEditNotifModal(${n.id}, '${escapeJsString(n.title || "")}', '${escapeJsString(n.message || "")}', '${n.type || "info"}', '${n.is_active}')">✏️ Edit</button>
          <button class="tc-btn" style="color:#f87171" onclick="deleteNotifConfirm(${n.id}, '${escapeJsString(n.title || "")}')">🗑 Delete</button>
        </div>
      </td>
    </tr>
  `;
}

function notifLoadingRow() {
  return `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted)">Loading…</td></tr>`;
}

function notifEmptyRow(msg = "No data") {
  return `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted)">${msg}</td></tr>`;
}

function renderNotifPagination() {
  const el = document.getElementById("notifPagination");
  if (!el) return;
  if (notifTotalPages <= 1) {
    el.innerHTML = "";
    return;
  }

  el.innerHTML = `
    <div class="notif-pagination">
      <button class="tc-btn" ${notifPage <= 1 ? "disabled" : ""} onclick="notifChangePage(${notifPage - 1})">← Prev</button>
      <span style="font-size:13px;color:var(--muted)">Page ${notifPage} / ${notifTotalPages}</span>
      <button class="tc-btn" ${notifPage >= notifTotalPages ? "disabled" : ""} onclick="notifChangePage(${notifPage + 1})">Next →</button>
    </div>
  `;
}

function notifChangePage(page) {
  notifPage = page;
  loadNotifications();
}

function setNotifTypeFilter(val, btn) {
  notifTypeFilter = val;
  notifPage = 1;
  document.querySelectorAll(".notif-filter-btn").forEach((b) => b.classList.remove("notif-filter-active"));
  if (btn) btn.classList.add("notif-filter-active");
  loadNotifications();
}

function setNotifTargetFilter(val, btn) {
  notifTargetFilter = val;
  notifPage = 1;
  document.querySelectorAll(".notif-target-btn").forEach((b) => b.classList.remove("notif-filter-active"));
  if (btn) btn.classList.add("notif-filter-active");
  loadNotifications();
}

async function openSendNotifModal() {
  openModal(
    "🔔 Send Notification",
    "Create and send a new notification",
    `
    <div class="form-group">
      <label>Target Type</label>
      <select id="notifTargetType" onchange="handleNotifTargetTypeChange()">
        <option value="all">📢 Broadcast — All Members</option>
        <option value="user">👤 Specific Member</option>
      </select>
    </div>

    <div id="notifMemberSearchWrap" style="display:none">
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <div class="form-group" style="flex:1;margin-bottom:0">
          <label>Search by Phone</label>
          <input id="notifMemberPhone" type="tel" placeholder="Enter member phone" />
        </div>
        <div style="display:flex;align-items:flex-end">
          <button type="button" class="tc-btn" onclick="searchMemberForNotif()" style="padding:10px 14px">🔍</button>
        </div>
      </div>
      <div id="notifMemberResult" style="margin-bottom:10px"></div>
    </div>

    <div class="form-group">
      <label>Title</label>
      <input id="notifTitle" type="text" placeholder="e.g. Membership Expiring Soon" maxlength="100" />
    </div>

    <div class="form-group">
      <label>Message</label>
      <textarea id="notifMessage" rows="3" placeholder="Write your notification message…" style="resize:vertical"></textarea>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label>Type</label>
        <select id="notifType">
          <option value="info">ℹ️ Info</option>
          <option value="success">✅ Success</option>
          <option value="warning">⚠️ Warning</option>
          <option value="error">❌ Error</option>
        </select>
      </div>

      <div class="form-group">
        <label>Schedule (optional)</label>
        <input id="notifScheduledAt" type="datetime-local" />
      </div>
    </div>

    <div class="form-group">
      <label>Action URL (optional)</label>
      <input id="notifActionUrl" type="url" placeholder="https://..." />
    </div>
    `,
    sendNotification,
    "Send Notification"
  );
}

function handleNotifTargetTypeChange() {
  const val = document.getElementById("notifTargetType")?.value;
  const wrap = document.getElementById("notifMemberSearchWrap");
  if (wrap) wrap.style.display = val === "user" ? "block" : "none";
}

async function searchMemberForNotif() {
  const phone = document.getElementById("notifMemberPhone")?.value?.trim() || "";
  const resultBox = document.getElementById("notifMemberResult");

  if (!phone) return showToast("Enter phone number", "error");
  if (!/^[0-9]{10,15}$/.test(phone)) return showToast("Enter a valid phone number", "error");

  if (resultBox) resultBox.innerHTML = `<p style="font-size:12px;color:#aaa">Searching…</p>`;

  const res = await API.get(`/users/search?phone=${encodeURIComponent(phone)}`);

  if (!res?.ok || !res.data?.data) {
    if (resultBox) {
      resultBox.innerHTML = `<p style="font-size:12px;color:#f87171">Member not found</p>`;
      delete resultBox.dataset.memberId;
    }
    return;
  }

  const member = res.data.data;

  if (resultBox) {
    resultBox.dataset.memberId = member.id;
    resultBox.innerHTML = `
      <div style="padding:10px;border:1px solid #2b6a3a;border-radius:8px;background:#0e2318">
        <div style="font-weight:600;font-size:13px">✅ ${escapeHtml(member.name || "User")}</div>
        <div style="font-size:11px;color:#aaa">ID: ${member.id} · Phone: ${escapeHtml(member.phone || "—")}</div>
      </div>
    `;
  }
}

async function sendNotification() {
  const targetType = document.getElementById("notifTargetType")?.value || "all";
  const title = document.getElementById("notifTitle")?.value?.trim() || "";
  const message = document.getElementById("notifMessage")?.value?.trim() || "";
  const scheduledAt = document.getElementById("notifScheduledAt")?.value || "";

  if (!title) return showToast("Title is required", "error");
  if (!message) return showToast("Message is required", "error");

  let memberId = null;

  if (targetType === "user") {
    const resultBox = document.getElementById("notifMemberResult");
    memberId = resultBox?.dataset?.memberId;
    if (!memberId) return showToast("Please search and select a member first", "error");
  }

  const scheduledIso = scheduledAt ? new Date(scheduledAt).toISOString() : undefined;

  // ── 1. Send WhatsApp ──────────────────────────────────────
  let waRes;
  if (targetType === "user") {
    waRes = await API.post("/whatsapp/send", {
      user_id: parseInt(memberId, 10),
      title,
      message,
      ...(scheduledIso && { scheduled_at: scheduledIso }),
    });
  } else {
    waRes = await API.post("/whatsapp/broadcast", {
      title,
      message,
      ...(scheduledIso && { scheduled_at: scheduledIso }),
    });
  }

  if (!waRes?.ok) {
    showToast(waRes?.data?.message || "WhatsApp send failed ❌", "error");
    return;
  }

  // ── 2. Save to notifications (optional — don't block on failure) ──
  const notifPayload = {
    title, message,
    type: document.getElementById("notifType")?.value || "info",
    target_type: targetType,
    ...(memberId && { user_id: parseInt(memberId, 10) }),
    ...(scheduledIso && { scheduled_at: scheduledIso }),
    ...(document.getElementById("notifActionUrl")?.value?.trim() && {
      action_url: document.getElementById("notifActionUrl").value.trim()
    }),
  };

  await API.post("/notifications", notifPayload).catch(() => {});

  showToast("✅ WhatsApp message sent!", "success");
  closeModal();
  await loadNotifications();
}

function openExpiryReminderModal() {
  openModal(
    "⏰ Send Expiry Reminder",
    "Send a membership expiry warning to a specific member",
    `
    <div style="display:flex;gap:8px;margin-bottom:8px">
      <div class="form-group" style="flex:1;margin-bottom:0">
        <label>Member Phone</label>
        <input id="expiryMemberPhone" type="tel" placeholder="Member phone number" />
      </div>
      <div style="display:flex;align-items:flex-end">
        <button type="button" class="tc-btn" onclick="searchMemberForExpiry()" style="padding:10px 14px">🔍</button>
      </div>
    </div>

    <div id="expiryMemberResult" style="margin-bottom:12px"></div>

    <div class="form-group">
      <label>Days Until Expiry</label>
      <select id="expiryDays">
        <option value="3">3 days</option>
        <option value="1">1 day (urgent)</option>
      </select>
    </div>

    <div class="form-group">
      <label>Custom Message (optional)</label>
      <textarea id="expiryCustomMsg" rows="2" placeholder="Leave blank to use default message"></textarea>
    </div>
    `,
    sendExpiryReminder,
    "Send Reminder"
  );
}

async function searchMemberForExpiry() {
  const phone = document.getElementById("expiryMemberPhone")?.value?.trim() || "";
  const resultBox = document.getElementById("expiryMemberResult");

  if (!phone || !/^[0-9]{10,15}$/.test(phone)) return showToast("Enter a valid phone", "error");
  if (resultBox) resultBox.innerHTML = `<p style="font-size:12px;color:#aaa">Searching…</p>`;

  const res = await API.get(`/users/search?phone=${encodeURIComponent(phone)}`);

  if (!res?.ok || !res.data?.data) {
    if (resultBox) {
      resultBox.innerHTML = `<p style="font-size:12px;color:#f87171">Member not found</p>`;
      delete resultBox.dataset.memberId;
    }
    return;
  }

  const m = res.data.data;

  if (resultBox) {
    resultBox.dataset.memberId = m.id;
    resultBox.dataset.memberName = m.name || "Member";
    resultBox.innerHTML = `
      <div style="padding:10px;border:1px solid #2b6a3a;border-radius:8px;background:#0e2318">
        <div style="font-weight:600;font-size:13px">✅ ${escapeHtml(m.name || "User")}</div>
        <div style="font-size:11px;color:#aaa">ID: ${m.id} · Phone: ${escapeHtml(m.phone || "—")}</div>
      </div>
    `;
  }
}

async function sendExpiryReminder() {
  const resultBox = document.getElementById("expiryMemberResult");
  const memberId = resultBox?.dataset?.memberId;
  const memberName = resultBox?.dataset?.memberName || "Member";
  const days = document.getElementById("expiryDays")?.value || "3";
  const customMsg = document.getElementById("expiryCustomMsg")?.value?.trim() || "";

  if (!memberId) return showToast("Please search and select a member first", "error");

  const defaultMsg = `Dear ${memberName}, your gym membership expires in ${days} day(s). Please renew to continue enjoying TrueFitness. 💪`;

  const payload = {
    title: `⏰ Membership Expiring in ${days} Day(s)`,
    message: customMsg || defaultMsg,
    type: days === "1" ? "error" : "warning",
    target_type: "user",
    user_id: parseInt(memberId, 10),
  };

  const res = await API.post("/notifications", payload);

  if (!res?.ok) {
    showToast(res?.data?.message || "Failed to send reminder", "error");
    return;
  }

  const waRes = await API.post("/whatsapp/send", {
    user_id: parseInt(memberId, 10),
    title: payload.title,
    message: payload.message,
  });

  if (!waRes?.ok) {
    showToast(waRes?.data?.message || "WhatsApp send failed", "error");
    return;
  }

  showToast("Expiry reminder sent ✅", "success");
  closeModal();
  await loadNotifications();
}

async function triggerExpiryAlertsNow() {
  // Ask admin which alert to trigger
  openModal(
    "⏰ Run Expiry Alert Job",
    "Choose which expiry alert to trigger",
    `
    <div class="form-group">
      <label>Days Before Expiry</label>
      <select id="expiryAlertDays">
        <option value="3">3 Days Before Expiry</option>
        <option value="1">1 Day Before Expiry (Urgent)</option>
      </select>
    </div>
    <p style="font-size:12px;color:#aaa;margin-top:8px">
      This will send WhatsApp alerts to all members whose membership expires in the selected number of days.
    </p>
    `,
    async () => {
      const days = parseInt(document.getElementById("expiryAlertDays")?.value || "3");

      const res = await API.post("/whatsapp/trigger-expiry-alerts", { days });

      if (res?.ok) {
        showToast(`✅ Expiry alerts sent — ${res.data?.data?.sent || 0} sent, ${res.data?.data?.failed || 0} failed`, "success");
      } else {
        showToast(res?.data?.message || "Failed to trigger expiry alerts", "error");
      }
    },
    "Send Alerts"
  );
}

async function openViewNotifModal(id) {
  const res = await API.get(`/notifications?page=1&limit=100`);
  if (!res?.ok) return showToast("Failed to load notification", "error");

  const notif = (res.data.data || []).find((n) => Number(n.id) === Number(id));
  if (!notif) return showToast("Notification not found", "error");

  openModal(
    "👁 View Notification",
    `Notification ID: ${notif.id}`,
    `
    <div class="form-group"><label>Title</label><input type="text" value="${escapeHtml(notif.title || "")}" readonly></div>
    <div class="form-group"><label>Type</label><input type="text" value="${escapeHtml(notif.type || "")}" readonly></div>
    <div class="form-group"><label>Target</label><input type="text" value="${escapeHtml(notif.target_type || "")}" readonly></div>
    <div class="form-group"><label>Message</label><textarea rows="5" readonly>${escapeHtml(notif.message || "")}</textarea></div>
    `,
    () => closeModal(),
    "Close"
  );
}

function openEditNotifModal(id, title, message, type, isActive) {
  openModal(
    "✏️ Edit Notification",
    `Update notification #${id}`,
    `
    <div class="form-group">
      <label>Title</label>
      <input id="editNotifTitle" type="text" value="${escapeHtml(title || "")}" />
    </div>
    <div class="form-group">
      <label>Message</label>
      <textarea id="editNotifMessage" rows="4">${escapeHtml(message || "")}</textarea>
    </div>
    <div class="form-group">
      <label>Type</label>
      <select id="editNotifType">
        <option value="info">Info</option>
        <option value="success">Success</option>
        <option value="warning">Warning</option>
        <option value="error">Error</option>
      </select>
    </div>
    <div class="form-group">
      <label>Status</label>
      <select id="editNotifActive">
        <option value="true">Active</option>
        <option value="false">Inactive</option>
      </select>
    </div>
    `,
    () => updateNotification(id),
    "Update"
  );

  setTimeout(() => {
    const typeEl = document.getElementById("editNotifType");
    const activeEl = document.getElementById("editNotifActive");
    if (typeEl) typeEl.value = type || "info";
    if (activeEl) activeEl.value = String(isActive) === "false" ? "false" : "true";
  }, 0);
}

async function updateNotification(id) {
  const title = document.getElementById("editNotifTitle")?.value?.trim() || "";
  const message = document.getElementById("editNotifMessage")?.value?.trim() || "";
  const type = document.getElementById("editNotifType")?.value || "info";
  const is_active = document.getElementById("editNotifActive")?.value === "true";

  if (!title) return showToast("Title is required", "error");
  if (!message) return showToast("Message is required", "error");

  const res = await API.put(`/notifications/${id}`, {
    title,
    message,
    type,
    is_active,
  });

  if (res?.ok) {
    showToast("Notification updated successfully", "success");
    closeModal();
    await loadNotifications();
  } else {
    showToast(res?.data?.message || "Failed to update notification", "error");
  }
}

function deleteNotifConfirm(id, title) {
  openModal(
    "🗑 Delete Notification",
    `Are you sure you want to delete "${title}"?`,
    `<p style="font-size:13px;color:#bbb">This action cannot be undone.</p>`,
    async () => {
      const res = await API.delete(`/notifications/${id}`);
      if (res?.ok) {
        showToast("Notification removed successfully 🗑️", "success");
        closeModal();
        await loadNotifications();
        return;
      }
      showToast(res?.data?.message || "Failed to delete notification", "error");
    },
    "Delete"
  );
}

window.openSendNotifModal = openSendNotifModal;
window.handleNotifTargetTypeChange = handleNotifTargetTypeChange;
window.searchMemberForNotif = searchMemberForNotif;
window.openExpiryReminderModal = openExpiryReminderModal;
window.searchMemberForExpiry = searchMemberForExpiry;
window.sendExpiryReminder = sendExpiryReminder;
window.triggerExpiryAlertsNow = triggerExpiryAlertsNow;
window.openViewNotifModal = openViewNotifModal;
window.openEditNotifModal = openEditNotifModal;
window.deleteNotifConfirm = deleteNotifConfirm;

// ─────────────────────────────────────────────
//  Diet — Add (Admin)
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
//  Diet — Add (Admin)
// ─────────────────────────────────────────────

async function searchUserForDiet(value) {
  const resultBox = document.getElementById("dietUserResult");
  const hiddenId  = document.getElementById("dietUserId");

  if (!value || value.length < 3) {
    if (resultBox) resultBox.innerHTML = "";
    if (hiddenId)  hiddenId.value = "";
    return;
  }

  if (resultBox) resultBox.innerHTML = `<div style="padding:8px;color:#aaa;font-size:12px">Searching...</div>`;

  const res = await API.get(`/users/search?phone=${encodeURIComponent(value)}`);

  if (!res?.ok || !res.data?.data) {
    if (resultBox) resultBox.innerHTML = `<div style="padding:8px;color:#f87171;font-size:12px">User not found</div>`;
    if (hiddenId)  hiddenId.value = "";
    return;
  }

  const user = res.data.data;
  if (hiddenId) hiddenId.value = user.id;

  if (resultBox) resultBox.innerHTML = `
    <div style="padding:10px;border:1px solid #2b6a3a;border-radius:6px;background:#0e2318;margin-top:6px">
      <div style="font-weight:600;font-size:13px;color:#4ade80">✅ ${escapeHtml(user.name || "User")}</div>
      <div style="font-size:11px;color:#aaa">ID: ${user.id} · Phone: ${escapeHtml(user.phone || "—")}</div>
    </div>
  `;
}

// ── Slot row builder ──

let slotCount = 0;

function addSlotRow() {
  slotCount++;
  const id = slotCount;
  const container = document.getElementById("slotsContainer");
  if (!container) return;

  const row = document.createElement("div");
  row.id = `slot-row-${id}`;
  row.style.cssText = `
    display:grid;
    grid-template-columns:110px 1fr 1fr 90px 1fr auto;
    gap:8px;
    align-items:end;
    margin-bottom:10px;
    padding:10px;
    border:1px solid #2b2b2b;
    border-radius:10px;
    background:#151515;
  `;

  row.innerHTML = `
    <div class="form-group" style="margin:0">
      <label style="font-size:11px;color:#888">Time</label>
      <input class="slot-time" type="text" placeholder="8:00 AM" style="width:100%;padding:8px;border-radius:7px;border:1px solid #333;background:#1a1a1a;color:#fff;font-size:12px" />
    </div>
    <div class="form-group" style="margin:0">
      <label style="font-size:11px;color:#888">Label</label>
      <input class="slot-label" type="text" placeholder="Breakfast" style="width:100%;padding:8px;border-radius:7px;border:1px solid #333;background:#1a1a1a;color:#fff;font-size:12px" />
    </div>
    <div class="form-group" style="margin:0">
      <label style="font-size:11px;color:#888">Food</label>
      <input class="slot-food" type="text" placeholder="Oats + banana" style="width:100%;padding:8px;border-radius:7px;border:1px solid #333;background:#1a1a1a;color:#fff;font-size:12px" />
    </div>
    <div class="form-group" style="margin:0">
      <label style="font-size:11px;color:#888">Calories</label>
      <input class="slot-calories" type="number" placeholder="350" style="width:100%;padding:8px;border-radius:7px;border:1px solid #333;background:#1a1a1a;color:#fff;font-size:12px" />
    </div>
    <div class="form-group" style="margin:0">
      <label style="font-size:11px;color:#888">Notes (optional)</label>
      <input class="slot-notes" type="text" placeholder="No sugar" style="width:100%;padding:8px;border-radius:7px;border:1px solid #333;background:#1a1a1a;color:#fff;font-size:12px" />
    </div>
    <button onclick="removeSlotRow(${id})" style="padding:8px 10px;background:rgba(232,40,26,.15);border:1px solid rgba(232,40,26,.3);color:#f87171;border-radius:8px;cursor:pointer;font-size:14px;height:36px;align-self:end">✕</button>
  `;

  container.appendChild(row);
}

function removeSlotRow(id) {
  document.getElementById(`slot-row-${id}`)?.remove();
}

function collectSlots() {
  const rows = document.querySelectorAll("#slotsContainer > div");
  const slots = [];

  rows.forEach(row => {
    const time     = row.querySelector(".slot-time")?.value?.trim() || "";
    const label    = row.querySelector(".slot-label")?.value?.trim() || "";
    const food     = row.querySelector(".slot-food")?.value?.trim() || "";
    const calories = row.querySelector(".slot-calories")?.value?.trim() || "";
    const notes    = row.querySelector(".slot-notes")?.value?.trim() || "";

    if (time && label && food) {
      slots.push({
        time,
        label,
        food_name: food,
        calories: calories ? Number(calories) : null,
        notes: notes || null,
      });
    }
  });

  return slots;
}

async function submitDietPlan() {
  const userId = document.getElementById("dietUserId")?.value?.trim();
  const day    = document.getElementById("dietDay")?.value?.trim();
  const slots  = collectSlots();

  if (!userId)          return showToast("Please search and select a member", "error");
  if (!day)             return showToast("Day is required (e.g. Monday)", "error");
  if (slots.length < 1) return showToast("Add at least one meal slot", "error");

  const res = await API.post("/diet", {
    user_id: Number(userId),
    day,
    slots,
  });

  if (res?.ok) {
    showToast("Diet plan saved successfully ✅", "success");

    // Reset form
    document.getElementById("dietUserSearch").value = "";
    document.getElementById("dietUserId").value = "";
    document.getElementById("dietUserResult").innerHTML = "";
    document.getElementById("dietDay").value = "";
    document.getElementById("slotsContainer").innerHTML = "";
    slotCount = 0;

    loadDiet("all");
  } else {
    showToast(res?.data?.error || "Failed to save diet plan", "error");
  }
}

// ── Load & Render Diet Plans ──

async function loadDiet(userId = null) {
  const list = document.getElementById("adminDietList");
  if (!list) return;

  list.innerHTML = "<p style='color:gray;padding:12px'>Loading...</p>";

  if (!userId) userId = document.getElementById("dietUserId")?.value || "all";

  let res;
  try {
    res = userId === "all"
      ? await API.get("/diet")
      : await API.get(`/diet/${userId}`);

    if (!res?.ok) {
      list.innerHTML = "<p style='color:#f87171;padding:12px'>Failed to load diet plans</p>";
      return;
    }

    const data = res.data?.data || [];

    if (!data.length) {
      list.innerHTML = "<p style='color:gray;padding:12px'>No diet plans found</p>";
      return;
    }

    list.innerHTML = data.map(plan => {
      const name  = escapeHtml(plan.users?.name || "Unknown");
      const phone = escapeHtml(plan.users?.phone || "—");
      const day   = escapeHtml(plan.day || "—");
      const slots = Array.isArray(plan.slots) ? plan.slots : [];

      const slotsHtml = slots.length
        ? slots.map(s => `
            <div style="display:flex;align-items:flex-start;gap:12px;padding:8px 10px;border-radius:8px;background:#1a1a1a;margin-bottom:6px">
              <div style="min-width:72px;font-size:11px;color:#fbbf24;font-weight:700;padding-top:2px">${escapeHtml(s.time || "—")}</div>
              <div style="flex:1">
                <div style="font-size:12px;font-weight:700;color:#fff">${escapeHtml(s.label || "—")}</div>
                <div style="font-size:12px;color:#ccc;margin-top:2px">${escapeHtml(s.food_name || "—")}</div>
                <div style="display:flex;gap:10px;margin-top:4px;flex-wrap:wrap">
                  ${s.calories ? `<span style="font-size:11px;color:#4ade80">🔥 ${s.calories} kcal</span>` : ""}
                  ${s.notes    ? `<span style="font-size:11px;color:#a1a1aa">📝 ${escapeHtml(s.notes)}</span>` : ""}
                </div>
              </div>
            </div>
          `).join("")
        : `<p style="font-size:12px;color:#666">No slots added</p>`;

      return `
        <div style="padding:16px;border-bottom:1px solid #2b2b2b">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:36px;height:36px;border-radius:50%;background:rgba(232,40,26,.16);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px">
                ${name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style="font-weight:700;font-size:14px">${name}</div>
                <div style="font-size:11px;color:var(--muted)">📞 ${phone}</div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-size:12px;font-weight:700;padding:5px 12px;border-radius:999px;background:rgba(37,99,235,.15);border:1px solid rgba(37,99,235,.3);color:#93c5fd">
                📅 ${day}
              </span>
              <button onclick="deleteDietPlan('${plan.id}', '${plan.user_id}')"
                style="background:rgba(232,40,26,.14);border:1px solid rgba(232,40,26,.3);color:#f87171;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px">
                🗑 Delete
              </button>
            </div>
          </div>
          ${slotsHtml}
        </div>
      `;
    }).join("");

  } catch (err) {
    console.error("LOAD DIET ERROR:", err);
    list.innerHTML = "<p style='color:#f87171;padding:12px'>Something went wrong</p>";
  }
}

async function deleteDietPlan(id, userId) {
  if (!confirm("Delete this diet plan?")) return;

  const res = await API.delete(`/diet/${id}`);

  if (res?.ok) {
    showToast("Diet plan deleted ✅", "success");
    loadDiet(userId || "all");
  } else {
    showToast("Delete failed", "error");
  }}
  // ─────────────────────────────────────────────
//  WEEKLY DIET PLAN — 7-day builder
// ─────────────────────────────────────────────

const WEEK_DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
let activeDietDay = "Monday";
let dietSlotCounters = {};   // { "Monday": 0, "Tuesday": 0, … }

function initWeeklyDietBuilder() {
  const tabsEl   = document.getElementById("dietDayTabs");
  const panelsEl = document.getElementById("dietDayPanels");
  if (!tabsEl || !panelsEl) return;

  tabsEl.innerHTML   = "";
  panelsEl.innerHTML = "";
  dietSlotCounters   = {};

  WEEK_DAYS.forEach((day, i) => {
    dietSlotCounters[day] = 0;

    // Tab button
    const btn = document.createElement("button");
    btn.id        = `diet-tab-${day}`;
    btn.textContent = day.slice(0,3);   // Mon, Tue, …
    btn.style.cssText = `
      padding:8px 14px;
      border-radius:10px;
      border:1px solid var(--border);
      background:${i === 0 ? "rgba(232,40,26,.14)" : "#151515"};
      color:${i === 0 ? "#fff" : "var(--muted)"};
      border-color:${i === 0 ? "rgba(232,40,26,.38)" : "var(--border)"};
      font-size:13px;
      font-weight:700;
      cursor:pointer;
      transition:.18s;
    `;
    btn.onclick = () => switchDietDay(day);
    tabsEl.appendChild(btn);

    // Panel
    const panel = document.createElement("div");
    panel.id = `diet-panel-${day}`;
    panel.style.display = i === 0 ? "block" : "none";
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-size:14px;font-weight:700;color:#ccc">🍽 ${day} — Meal Slots</span>
        <button class="tc-btn" onclick="addDietSlot('${day}')">+ Add Slot</button>
      </div>
      <div id="diet-slots-${day}"></div>
    `;
    panelsEl.appendChild(panel);
  });

  activeDietDay = "Monday";
}

function switchDietDay(day) {
  WEEK_DAYS.forEach(d => {
    const tab   = document.getElementById(`diet-tab-${d}`);
    const panel = document.getElementById(`diet-panel-${d}`);
    const isActive = d === day;
    if (tab) {
      tab.style.background   = isActive ? "rgba(232,40,26,.14)" : "#151515";
      tab.style.color        = isActive ? "#fff" : "var(--muted)";
      tab.style.borderColor  = isActive ? "rgba(232,40,26,.38)" : "var(--border)";
    }
    if (panel) panel.style.display = isActive ? "block" : "none";
  });
  activeDietDay = day;
}

function addDietSlot(day) {
  dietSlotCounters[day] = (dietSlotCounters[day] || 0) + 1;
  const id = dietSlotCounters[day];
  const container = document.getElementById(`diet-slots-${day}`);
  if (!container) return;

  const row = document.createElement("div");
  row.id = `diet-slot-${day}-${id}`;
  row.style.cssText = `
    display:grid;
    grid-template-columns:110px 1fr 1fr 90px 1fr auto;
    gap:8px;
    align-items:end;
    margin-bottom:10px;
    padding:10px;
    border:1px solid #2b2b2b;
    border-radius:10px;
    background:#151515;
  `;
  row.innerHTML = `
    <div class="form-group" style="margin:0">
      <label style="font-size:11px;color:#888">Time</label>
      <input class="slot-time" type="text" placeholder="8:00 AM"
        style="width:100%;padding:8px;border-radius:7px;border:1px solid #333;background:#1a1a1a;color:#fff;font-size:12px"/>
    </div>
    <div class="form-group" style="margin:0">
      <label style="font-size:11px;color:#888">Label</label>
      <input class="slot-label" type="text" placeholder="Breakfast"
        style="width:100%;padding:8px;border-radius:7px;border:1px solid #333;background:#1a1a1a;color:#fff;font-size:12px"/>
    </div>
    <div class="form-group" style="margin:0">
      <label style="font-size:11px;color:#888">Food</label>
      <input class="slot-food" type="text" placeholder="Oats + banana"
        style="width:100%;padding:8px;border-radius:7px;border:1px solid #333;background:#1a1a1a;color:#fff;font-size:12px"/>
    </div>
    <div class="form-group" style="margin:0">
      <label style="font-size:11px;color:#888">Calories</label>
      <input class="slot-calories" type="number" placeholder="350"
        style="width:100%;padding:8px;border-radius:7px;border:1px solid #333;background:#1a1a1a;color:#fff;font-size:12px"/>
    </div>
    <div class="form-group" style="margin:0">
      <label style="font-size:11px;color:#888">Notes</label>
      <input class="slot-notes" type="text" placeholder="optional"
        style="width:100%;padding:8px;border-radius:7px;border:1px solid #333;background:#1a1a1a;color:#fff;font-size:12px"/>
    </div>
    <button onclick="document.getElementById('diet-slot-${day}-${id}').remove()"
      style="padding:8px 10px;background:rgba(232,40,26,.15);border:1px solid rgba(232,40,26,.3);color:#f87171;border-radius:8px;cursor:pointer;font-size:14px;height:36px;align-self:end">✕</button>
  `;
  container.appendChild(row);
}

function collectDaySlots(day) {
  const container = document.getElementById(`diet-slots-${day}`);
  if (!container) return [];
  const slots = [];
  container.querySelectorAll("div[id^='diet-slot-']").forEach(row => {
    const time     = row.querySelector(".slot-time")?.value?.trim()     || "";
    const label    = row.querySelector(".slot-label")?.value?.trim()    || "";
    const food     = row.querySelector(".slot-food")?.value?.trim()     || "";
    const calories = row.querySelector(".slot-calories")?.value?.trim() || "";
    const notes    = row.querySelector(".slot-notes")?.value?.trim()    || "";
    if (time && label && food) {
      slots.push({
        time,
        label,
        food_name: food,
        calories: calories ? Number(calories) : null,
        notes: notes || null,
      });
    }
  });
  return slots;
}

async function submitWeeklyDietPlan() {
  const userId = document.getElementById("dietUserId")?.value?.trim();
  if (!userId) return showToast("Please search and select a member", "error");

  // Collect only days that have at least one slot
  const daysToSubmit = WEEK_DAYS.filter(day => collectDaySlots(day).length > 0);

  if (!daysToSubmit.length) return showToast("Add at least one meal slot to any day", "error");

  let successCount = 0;
  let failCount    = 0;

  for (const day of daysToSubmit) {
    const slots = collectDaySlots(day);
    const res   = await API.post("/diet", {
      user_id: Number(userId),
      day,
      slots,
    });
    if (res?.ok) successCount++;
    else failCount++;
  }

  if (successCount > 0) {
    showToast(`✅ ${successCount} day(s) saved successfully${failCount ? `, ${failCount} failed` : ""}`, "success");

    // Reset
    document.getElementById("dietUserSearch").value     = "";
    document.getElementById("dietUserId").value         = "";
    document.getElementById("dietUserResult").innerHTML = "";
    initWeeklyDietBuilder();

    loadDiet("all");
  } else {
    showToast("Failed to save diet plan", "error");
  }
}


// ═════════════════════════════════════════════
//  GYM PLANS MODULE
// ═════════════════════════════════════════════

let gymPlanDayCount = 0;

// ── Search member ──
async function searchUserForGymPlan(value) {
  const resultBox = document.getElementById("gymPlanUserResult");
  const hiddenId  = document.getElementById("gymPlanUserId");

  if (!value || value.length < 3) {
    if (resultBox) resultBox.innerHTML = "";
    if (hiddenId)  hiddenId.value = "";
    return;
  }

  if (resultBox) resultBox.innerHTML = `<div style="padding:8px;color:#aaa;font-size:12px">Searching...</div>`;

  const res = await API.get(`/users/search?phone=${encodeURIComponent(value)}`);

  if (!res?.ok || !res.data?.data) {
    if (resultBox) resultBox.innerHTML = `<div style="padding:8px;color:#f87171;font-size:12px">User not found</div>`;
    if (hiddenId)  hiddenId.value = "";
    return;
  }

  const user = res.data.data;
  if (hiddenId) hiddenId.value = user.id;

  if (resultBox) resultBox.innerHTML = `
    <div style="padding:10px;border:1px solid #2b6a3a;border-radius:6px;background:#0e2318;margin-top:6px">
      <div style="font-weight:600;font-size:13px;color:#4ade80">✅ ${escapeHtml(user.name || "User")}</div>
      <div style="font-size:11px;color:#aaa">ID: ${user.id} · Phone: ${escapeHtml(user.phone || "—")}</div>
    </div>
  `;
}

// ── Add a day block ──
function addGymPlanDay() {
  gymPlanDayCount++;
  const id = gymPlanDayCount;
  const container = document.getElementById("gymPlanDaysContainer");
  if (!container) return;

  const row = document.createElement("div");
  row.id = `gym-day-${id}`;
  row.style.cssText = `
    padding:14px;
    border:1px solid #2b2b2b;
    border-radius:12px;
    background:#151515;
    margin-bottom:12px;
  `;

  row.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px;flex:1">
        <span style="font-size:13px;color:#888;white-space:nowrap">📅 Day Label</span>
        <input class="gym-day-label" type="text" placeholder="e.g. Monday / Day 1 / Push Day"
          style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid #333;background:#1a1a1a;color:#fff;font-size:13px" />
      </div>
      <button onclick="removeGymDay(${id})"
        style="margin-left:12px;padding:7px 12px;background:rgba(232,40,26,.14);border:1px solid rgba(232,40,26,.3);color:#f87171;border-radius:8px;cursor:pointer;font-size:12px;white-space:nowrap">
        ✕ Remove
      </button>
    </div>

    <div class="gym-exercises-container" style="margin-bottom:10px"></div>

    <button onclick="addGymExercise(${id})"
      style="padding:7px 14px;background:#1a1a1a;border:1px solid #333;color:#aaa;border-radius:8px;cursor:pointer;font-size:12px;transition:.2s"
      onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#aaa'">
      + Add Exercise
    </button>
  `;

  container.appendChild(row);
}

function removeGymDay(id) {
  document.getElementById(`gym-day-${id}`)?.remove();
}

// ── Add exercise row inside a day ──
function addGymExercise(dayId) {
  const dayEl = document.getElementById(`gym-day-${dayId}`);
  if (!dayEl) return;

  const container = dayEl.querySelector(".gym-exercises-container");
  if (!container) return;

  const ex = document.createElement("div");
  ex.style.cssText = `
    display:grid;
    grid-template-columns:2fr 70px 70px 80px 110px auto;
    gap:6px;
    align-items:end;
    margin-bottom:8px;
    padding:8px;
    border-radius:8px;
    background:#1c1c1c;
  `;

  ex.innerHTML = `
    <div>
      <div style="font-size:10px;color:#555;margin-bottom:3px;font-weight:600;text-transform:uppercase">Exercise</div>
      <input class="ex-name" type="text" placeholder="e.g. Bench Press"
        style="width:100%;padding:7px 8px;border-radius:6px;border:1px solid #2b2b2b;background:#121212;color:#fff;font-size:12px;outline:none" />
    </div>
    <div>
      <div style="font-size:10px;color:#555;margin-bottom:3px;font-weight:600;text-transform:uppercase">Sets</div>
      <input class="ex-sets" type="number" min="1" placeholder="3"
        style="width:100%;padding:7px 8px;border-radius:6px;border:1px solid #2b2b2b;background:#121212;color:#fff;font-size:12px;outline:none" />
    </div>
    <div>
      <div style="font-size:10px;color:#555;margin-bottom:3px;font-weight:600;text-transform:uppercase">Reps</div>
      <input class="ex-reps" type="text" placeholder="10-12"
        style="width:100%;padding:7px 8px;border-radius:6px;border:1px solid #2b2b2b;background:#121212;color:#fff;font-size:12px;outline:none" />
    </div>
    <div>
      <div style="font-size:10px;color:#555;margin-bottom:3px;font-weight:600;text-transform:uppercase">Rest</div>
      <input class="ex-rest" type="text" placeholder="60s"
        style="width:100%;padding:7px 8px;border-radius:6px;border:1px solid #2b2b2b;background:#121212;color:#fff;font-size:12px;outline:none" />
    </div>
    <div>
      <div style="font-size:10px;color:#555;margin-bottom:3px;font-weight:600;text-transform:uppercase">Notes</div>
      <input class="ex-notes" type="text" placeholder="optional"
        style="width:100%;padding:7px 8px;border-radius:6px;border:1px solid #2b2b2b;background:#121212;color:#fff;font-size:12px;outline:none" />
    </div>
    <button onclick="this.parentElement.remove()"
      style="padding:7px 10px;background:rgba(232,40,26,.12);border:1px solid rgba(232,40,26,.22);color:#f87171;border-radius:6px;cursor:pointer;font-size:13px;align-self:end;height:32px">
      ✕
    </button>
  `;

  container.appendChild(ex);
}

// ── Collect all days data ──
function collectGymPlanDays() {
  const dayRows = document.querySelectorAll("#gymPlanDaysContainer > div");
  const days = {};

  dayRows.forEach(row => {
    const label = row.querySelector(".gym-day-label")?.value?.trim() || "";
    if (!label) return;

    const exercises = [];
    row.querySelectorAll(".gym-exercises-container > div").forEach(ex => {
      const name  = ex.querySelector(".ex-name")?.value?.trim()  || "";
      const sets  = ex.querySelector(".ex-sets")?.value?.trim()  || "";
      const reps  = ex.querySelector(".ex-reps")?.value?.trim()  || "";
      const rest  = ex.querySelector(".ex-rest")?.value?.trim()  || "";
      const notes = ex.querySelector(".ex-notes")?.value?.trim() || "";
      if (name) exercises.push({
        name,
        sets:  sets  || null,
        reps:  reps  || null,
        rest:  rest  || null,
        notes: notes || null,
      });
    });

    days[label] = exercises;
  });

  return days;
}

// ── Submit ──
async function submitGymPlan() {
  const userId    = document.getElementById("gymPlanUserId")?.value?.trim();
  const weekLabel = document.getElementById("gymPlanWeekLabel")?.value?.trim();
  const days      = collectGymPlanDays();

  if (!userId)                    return showToast("Please search and select a member", "error");
  if (!Object.keys(days).length)  return showToast("Add at least one day", "error");

  const hasExercise = Object.values(days).some(exArr => exArr.length > 0);
  if (!hasExercise) return showToast("Add at least one exercise in a day", "error");

  const res = await API.post("/gym-plans", {
    user_id:    Number(userId),
    week_label: weekLabel || null,
    days,
  });

  if (res?.ok) {
    showToast("Gym plan saved successfully ✅", "success");

    // Reset form
    document.getElementById("gymPlanUserSearch").value  = "";
    document.getElementById("gymPlanUserId").value      = "";
    document.getElementById("gymPlanUserResult").innerHTML = "";
    document.getElementById("gymPlanWeekLabel").value   = "";
    document.getElementById("gymPlanDaysContainer").innerHTML = "";
    gymPlanDayCount = 0;

    loadGymPlans();
  } else {
    showToast(res?.data?.message || "Failed to save gym plan", "error");
  }
}

// ── Load & render all gym plans ──
async function loadGymPlans() {
  const list = document.getElementById("adminGymPlanList");
  if (!list) return;

  list.innerHTML = "<p style='color:gray;padding:12px'>Loading...</p>";

  const res = await API.get("/gym-plans");

  if (!res?.ok) {
    list.innerHTML = "<p style='color:#f87171;padding:12px'>Failed to load gym plans</p>";
    return;
  }

  const data = res.data?.data ?? res.data?.data ?? [];

  if (!data.length) {
    list.innerHTML = "<p style='color:gray;padding:12px'>No gym plans found</p>";
    return;
  }

  list.innerHTML = data.map(plan => {
    const name      = escapeHtml(plan.users?.name  || "Unknown");
    const phone     = escapeHtml(plan.users?.phone || "—");
    const weekLabel = escapeHtml(plan.week_label   || "No label");
    const days      = typeof plan.days === "object" ? plan.days : {};
    const dayKeys   = Object.keys(days);

    const daysHtml = dayKeys.length
      ? dayKeys.map(dayKey => {
          const exercises = Array.isArray(days[dayKey]) ? days[dayKey] : [];

          const exHtml = exercises.length
            ? `<div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
                ${exercises.map(e => `
                  <div style="display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:7px;background:#1a1a1a;flex-wrap:wrap">
                    <span style="font-size:13px;color:#fff;font-weight:600;min-width:120px">${escapeHtml(e.name || "—")}</span>
                    ${e.sets  ? `<span style="font-size:11px;color:#93c5fd;background:rgba(37,99,235,.12);border:1px solid rgba(37,99,235,.22);padding:3px 8px;border-radius:999px">${e.sets} sets</span>` : ""}
                    ${e.reps  ? `<span style="font-size:11px;color:#4ade80;background:rgba(22,163,74,.12);border:1px solid rgba(22,163,74,.22);padding:3px 8px;border-radius:999px">${e.reps} reps</span>` : ""}
                    ${e.rest  ? `<span style="font-size:11px;color:#fbbf24;background:rgba(217,119,6,.12);border:1px solid rgba(217,119,6,.22);padding:3px 8px;border-radius:999px">⏱ ${e.rest}</span>` : ""}
                    ${e.notes ? `<span style="font-size:11px;color:#a1a1aa">📝 ${escapeHtml(e.notes)}</span>` : ""}
                  </div>
                `).join("")}
              </div>`
            : `<p style="font-size:12px;color:#555;margin-top:6px">No exercises</p>`;

          return `
            <div style="margin-bottom:12px">
              <div style="font-size:12px;font-weight:700;color:#fbbf24;margin-bottom:4px;display:flex;align-items:center;gap:6px">
                📅 ${escapeHtml(dayKey)}
                <span style="font-size:11px;color:#555;font-weight:400">(${exercises.length} exercise${exercises.length !== 1 ? "s" : ""})</span>
              </div>
              ${exHtml}
            </div>
          `;
        }).join("")
      : `<p style="font-size:12px;color:#555">No days added</p>`;

    return `
      <div style="padding:16px;border-bottom:1px solid #2b2b2b">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:38px;height:38px;border-radius:50%;background:rgba(232,40,26,.16);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px">
              ${name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style="font-weight:700;font-size:14px">${name}</div>
              <div style="font-size:11px;color:var(--muted)">📞 ${phone}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="font-size:12px;font-weight:700;padding:5px 12px;border-radius:999px;background:rgba(139,92,246,.14);border:1px solid rgba(139,92,246,.28);color:#c4b5fd">
              🗓 ${weekLabel}
            </span>
            <span style="font-size:11px;color:#666">${dayKeys.length} day${dayKeys.length !== 1 ? "s" : ""}</span>
            <button onclick="deleteGymPlan('${plan.id}')"
              style="background:rgba(232,40,26,.14);border:1px solid rgba(232,40,26,.3);color:#f87171;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px">
              🗑 Delete
            </button>
          </div>
        </div>
        ${daysHtml}
      </div>
    `;
  }).join("");
}

// ── Delete ──
async function deleteGymPlan(id) {
  if (!confirm("Delete this gym plan?")) return;

  const res = await API.delete(`/gym-plans/${id}`);

  if (res?.ok) {
    showToast("Gym plan deleted ✅", "success");
    loadGymPlans();
  } else {
    showToast(res?.data?.message || "Delete failed", "error");
  }
}
function editPlan(id) {
  const plan = (window.currentPlans || []).find(p => p.id === id);
  if (!plan) return showToast("Plan not found", "error");

  const features = Array.isArray(plan.features)
    ? plan.features.join(", ")
    : typeof plan.features === "string"
      ? plan.features
      : "";

  openModal(
    "✏️ Edit Plan",
    `Editing: ${plan.name}`,
    `
    <div class="form-group">
      <label>Name</label>
      <input id="editPlanName" value="${escapeHtml(plan.name || "")}" />
    </div>
    <div class="form-group">
      <label>Price (₹)</label>
      <input id="editPlanPrice" type="number" value="${plan.price || ""}" />
    </div>
    <div class="form-group">
      <label>Duration (Days)</label>
      <input id="editPlanDuration" type="number" value="${plan.duration_days || ""}" />
    </div>
    <div class="form-group">
      <label>Features (comma separated)</label>
      <input id="editPlanFeatures" value="${escapeHtml(features)}" placeholder="Gym, Trainer, Diet" />
    </div>
    `,
    async () => {
      const name         = document.getElementById("editPlanName")?.value?.trim() || "";
      const price        = document.getElementById("editPlanPrice")?.value || "";
      const duration_days = document.getElementById("editPlanDuration")?.value || "";
      const features     = document.getElementById("editPlanFeatures")?.value
        .split(",").map(f => f.trim()).filter(Boolean);

      if (!name)  return showToast("Name is required", "error");
      if (!price) return showToast("Price is required", "error");

      const res = await API.put(`/plans/${id}`, { name, price, duration_days, features });

      if (res?.ok) {
        showToast("Plan updated successfully ✅", "success");
        closeModal();
        loadAdminPlans();
      } else {
        showToast(res?.data?.message || "Failed to update plan", "error");
      }
    },
    "Update Plan"
  );
}

async function togglePlan(id, isActive) {
  const action = isActive ? "deactivate" : "activate";
  if (!confirm(`Are you sure you want to ${action} this plan?`)) return;

  const res = await API.put(`/plans/${id}`, { is_active: !isActive });

  if (res?.ok) {
    showToast(`Plan ${isActive ? "deactivated" : "activated"} successfully`, "success");
    loadAdminPlans();
  } else {
    showToast(res?.data?.message || `Failed to ${action} plan`, "error");
  }
}

// ─────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  await ensurePlansLoaded();
  await loadDashboardStats();
  await loadMembers();
  await loadTrainerStats();
  await loadTrainers();
  await loadAdminPlans();
});