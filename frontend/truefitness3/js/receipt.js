// ── TRUE FITNESS — RECEIPTS SECTION JS ──
// Paste this into your admin-dashboard.js, or load as a separate file
// after api.js and auth.js

// ─── State ────────────────────────────────────────────────────
let receiptsPage = 1;
let receiptsTotal = 0;
let receiptsSearch = '';
let receiptsFrom = '';
let receiptsTo = '';

// ─── Load Receipts ────────────────────────────────────────────
async function loadReceipts(page = 1) {
    receiptsPage = page;

    const params = new URLSearchParams({
        page,
        limit: 15,
        ...(receiptsSearch && { search: receiptsSearch }),
        ...(receiptsFrom && { from: receiptsFrom }),
        ...(receiptsTo && { to: receiptsTo }),
    });

    const [statsRes, listRes] = await Promise.all([
        API.get('/receipts/stats'),
        API.get(`/receipts?${params}`),
    ]);

    // Render stats
    if (statsRes?.ok) renderReceiptStats(statsRes.data.data);

    // Render list
    if (listRes?.ok) {
        receiptsTotal = listRes.data.pagination?.total || 0;
        renderReceiptsList(listRes.data.data || []);
        renderReceiptsPagination(listRes.data.pagination);
    } else {
        document.getElementById('receiptsTableBody').innerHTML =
            `<tr><td colspan="6" class="r-empty">Failed to load receipts</td></tr>`;
    }
}

// ─── Render Stats Cards ───────────────────────────────────────
function renderReceiptStats(s) {
    _rSet('rTotalCount', s.total_receipts || 0);
    _rSet('rTotalRev', '₹' + _fmt(s.total_revenue || 0));
    _rSet('rMonthCount', s.month_receipts || 0);
    _rSet('rMonthRev', '₹' + _fmt(s.month_revenue || 0));
}

// ─── Render Table ─────────────────────────────────────────────
function renderReceiptsList(receipts) {
    const tbody = document.getElementById('receiptsTableBody');
    if (!tbody) return;

    if (!receipts.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="r-empty">No receipts found</td></tr>`;
        return;
    }

    tbody.innerHTML = receipts.map(r => {
        const date = r.payment_date ? new Date(r.payment_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
        const amount = '₹' + _fmt(r.amount || 0);
        const method = (r.payment_method || 'cash').toUpperCase();
        const plan = r.plan?.name || '—';
        const member = r.user?.name || '—';
        const phone = r.user?.phone || '—';

        return `
    <tr class="r-row" onclick="openReceiptPreview(${r.id})">
      <td>
        <div class="r-member-name">${member}</div>
        <div class="r-member-phone">${phone}</div>
      </td>
      <td><span class="r-plan-badge">${plan}</span></td>
      <td class="r-amount">${amount}</td>
      <td><span class="r-method">${method}</span></td>
      <td class="r-date">${date}</td>
      <td onclick="event.stopPropagation()">
        <button class="r-pdf-btn" onclick="downloadReceiptPDF(${r.id})" title="Download PDF">⬇ PDF</button>
      </td>
    </tr>`;
    }).join('');
}

// ─── Render Pagination ────────────────────────────────────────
function renderReceiptsPagination(p) {
    const el = document.getElementById('receiptsPagination');
    if (!el || !p) return;
    if (p.pages <= 1) { el.innerHTML = ''; return; }

    let html = `<div class="r-pagination">`;
    html += `<button class="r-page-btn" ${p.page <= 1 ? 'disabled' : ''} onclick="loadReceipts(${p.page - 1})">← Prev</button>`;
    html += `<span class="r-page-info">Page ${p.page} of ${p.pages}</span>`;
    html += `<button class="r-page-btn" ${p.page >= p.pages ? 'disabled' : ''} onclick="loadReceipts(${p.page + 1})">Next →</button>`;
    html += `</div>`;
    el.innerHTML = html;
}

// ─── Search & Filter handlers ─────────────────────────────────
function receiptsOnSearch(val) {
    receiptsSearch = val.trim();
    loadReceipts(1);
}

function receiptsOnFilter() {
    receiptsFrom = document.getElementById('rFromDate')?.value || '';
    receiptsTo = document.getElementById('rToDate')?.value || '';
    loadReceipts(1);
}

function receiptsClearFilter() {
    receiptsSearch = '';
    receiptsFrom = '';
    receiptsTo = '';
    const s = document.getElementById('rSearchInput');
    const f = document.getElementById('rFromDate');
    const t = document.getElementById('rToDate');
    if (s) s.value = '';
    if (f) f.value = '';
    if (t) t.value = '';
    loadReceipts(1);
}

// ─── Receipt Preview Modal ────────────────────────────────────
let _receiptPreviewRequestId = 0;

async function openReceiptPreview(id) {
    const modal = document.getElementById('receiptPreviewModal');
    if (!modal) return;

    const requestToken = ++_receiptPreviewRequestId;

    document.getElementById('receiptPreviewBody').innerHTML =
        `<div class="r-loading">Loading receipt…</div>`;
    modal.classList.add('open');

    const res = await API.get(`/receipts/${id}`);

    // A newer preview request was started while this one was in flight — discard this result.
    if (requestToken !== _receiptPreviewRequestId) return;

    if (!res?.ok) {
        document.getElementById('receiptPreviewBody').innerHTML =
            `<div class="r-loading">Failed to load receipt.</div>`;
        return;
    }

    const r = res.data.data;
    document.getElementById('receiptPreviewBody').innerHTML = buildReceiptHTML(r);
    // Store current receipt id for PDF download
    modal.dataset.receiptId = id;
}

function closeReceiptPreview() {
    document.getElementById('receiptPreviewModal')?.classList.remove('open');
}

// Close on backdrop click or Escape key
document.getElementById('receiptPreviewModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'receiptPreviewModal') closeReceiptPreview();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' &&
        document.getElementById('receiptPreviewModal')?.classList.contains('open')) {
        closeReceiptPreview();
    }
});

// ─── Build Receipt HTML (used in preview + PDF) ───────────────
function buildReceiptHTML(r) {
    const date = r.payment_date ? new Date(r.payment_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
    const amount = '₹' + _fmt(r.amount || 0);
    const method = (r.payment_method || 'Cash').toUpperCase();
    const plan = r.plan?.name || '—';
    const duration = r.plan?.duration_days ? `${r.plan.duration_days} Days` : '—';
    const features = r.plan?.features || '';
    const member = r.user?.name || '—';
    const phone = r.user?.phone || '—';
    const email = r.user?.email || '';
    const txnId = r.transaction_id || r.razorpay_order_id || `TF-${String(r.id).padStart(6, '0')}`;

    // Compute expiry
    let expiry = '—';
if (r.membership_end_date) {
    expiry = new Date(r.membership_end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
} else if (r.payment_date && r.plan?.duration_days) {
    // fallback for old receipts that don't have membership_end_date
    const exp = new Date(r.payment_date);
    exp.setDate(exp.getDate() + r.plan.duration_days);
    expiry = exp.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

    return `
  <div class="receipt-doc" id="receiptDoc">
    <!-- Header -->
    <div class="receipt-header">
      <div class="receipt-gym-logo">💪</div>
      <div class="receipt-gym-info">
        <div class="receipt-gym-name">TRUE FITNESS</div>
        <div class="receipt-gym-addr">SCO 1,2,3 Sector-115, Santemajra, Kharar Mohali</div>
        <div class="receipt-gym-contact">📞 9877507810 &nbsp;|&nbsp; ✉ info@truefitness.com</div>
      </div>
      <div class="receipt-badge">RECEIPT</div>
    </div>

    <div class="receipt-divider"></div>

    <!-- Meta row -->
    <div class="receipt-meta-row">
      <div class="receipt-meta-item">
        <div class="receipt-meta-label">Receipt No.</div>
        <div class="receipt-meta-val">#${String(r.id).padStart(6, '0')}</div>
      </div>
      <div class="receipt-meta-item">
        <div class="receipt-meta-label">Date</div>
        <div class="receipt-meta-val">${date}</div>
      </div>
      <div class="receipt-meta-item">
        <div class="receipt-meta-label">Payment Method</div>
        <div class="receipt-meta-val">${method}</div>
      </div>
      <div class="receipt-meta-item">
        <div class="receipt-meta-label">Transaction ID</div>
        <div class="receipt-meta-val receipt-txn">${txnId}</div>
      </div>
    </div>

    <div class="receipt-divider"></div>

    <!-- Member + Plan -->
    <div class="receipt-two-col">
      <div class="receipt-section">
        <div class="receipt-section-label">BILLED TO</div>
        <div class="receipt-member-name">${member}</div>
        <div class="receipt-member-detail">${phone}</div>
        ${email ? `<div class="receipt-member-detail">${email}</div>` : ''}
      </div>
      <div class="receipt-section">
        <div class="receipt-section-label">MEMBERSHIP PLAN</div>
        <div class="receipt-plan-name">${plan}</div>
        <div class="receipt-plan-dur">Duration: ${duration}</div>
        <div class="receipt-plan-exp">Valid Until: <strong>${expiry}</strong></div>
        ${features ? `<div class="receipt-plan-features">${features}</div>` : ''}
      </div>
    </div>

    <div class="receipt-divider"></div>

    <!-- Amount -->
    <div class="receipt-amount-row">
      <div class="receipt-amount-label">Total Amount Paid</div>
      <div class="receipt-amount-val">${amount}</div>
    </div>
    <div class="receipt-currency-note">Amount in Indian Rupees (INR) · GST inclusive if applicable</div>

    <div class="receipt-divider"></div>

    <!-- Footer -->
    <div class="receipt-footer">
      <div class="receipt-thank">Thank you for choosing True Fitness! 💪</div>
      <div class="receipt-footer-note">This is a computer-generated receipt and does not require a signature.</div>
    </div>
  </div>`;
}

// ─── Download PDF ─────────────────────────────────────────────
async function downloadReceiptPDF(id) {
    // If preview is open use its data, otherwise fetch
    let bodyEl = document.getElementById('receiptDoc');

    if (!bodyEl || document.getElementById('receiptPreviewModal')?.dataset.receiptId != id) {
        await openReceiptPreview(id);
        bodyEl = document.getElementById('receiptDoc');
    }

    if (!bodyEl) return;

    // Use browser print dialog scoped to receipt only
    const printWin = window.open('', '_blank', 'width=800,height=700');
    printWin.document.write(`
    <!DOCTYPE html><html><head>
    <title>Receipt #${String(id).padStart(6, '0')} — True Fitness</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family: 'Segoe UI', sans-serif; background:#fff; color:#111; padding:32px; }
      .receipt-doc { max-width:680px; margin:0 auto; }
      .receipt-header { display:flex; align-items:center; gap:16px; margin-bottom:4px; }
      .receipt-gym-logo { font-size:40px; }
      .receipt-gym-name { font-size:22px; font-weight:800; color:#e8281a; letter-spacing:1px; }
      .receipt-gym-addr, .receipt-gym-contact { font-size:12px; color:#555; margin-top:2px; }
      .receipt-badge { margin-left:auto; background:#e8281a; color:#fff; font-size:13px; font-weight:800; padding:6px 16px; border-radius:6px; letter-spacing:2px; }
      .receipt-divider { border:none; border-top:1px solid #e5e7eb; margin:16px 0; }
      .receipt-meta-row { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
      .receipt-meta-label { font-size:10px; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:.5px; margin-bottom:3px; }
      .receipt-meta-val { font-size:13px; font-weight:700; color:#111; }
      .receipt-txn { font-size:11px; word-break:break-all; }
      .receipt-two-col { display:grid; grid-template-columns:1fr 1fr; gap:24px; }
      .receipt-section-label { font-size:10px; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:.5px; margin-bottom:8px; }
      .receipt-member-name { font-size:16px; font-weight:700; color:#111; }
      .receipt-member-detail { font-size:13px; color:#555; margin-top:3px; }
      .receipt-plan-name { font-size:16px; font-weight:700; color:#e8281a; }
      .receipt-plan-dur, .receipt-plan-exp { font-size:13px; color:#555; margin-top:3px; }
      .receipt-plan-features { font-size:12px; color:#888; margin-top:6px; }
      .receipt-amount-row { display:flex; justify-content:space-between; align-items:center; background:#fff8f8; border:1px solid #fecaca; border-radius:10px; padding:16px 20px; }
      .receipt-amount-label { font-size:14px; font-weight:700; color:#111; }
      .receipt-amount-val { font-size:28px; font-weight:800; color:#e8281a; }
      .receipt-currency-note { font-size:11px; color:#aaa; margin-top:8px; text-align:right; }
      .receipt-thank { font-size:15px; font-weight:700; color:#111; text-align:center; margin-bottom:6px; }
      .receipt-footer-note { font-size:11px; color:#aaa; text-align:center; }
      @media print { body { padding:16px; } }
    </style>
    </head><body>${bodyEl.outerHTML}</body></html>`);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => { printWin.print(); printWin.close(); }, 500);
}

// ─── Utilities ────────────────────────────────────────────────
function _rSet(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function _fmt(n) {
    return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}