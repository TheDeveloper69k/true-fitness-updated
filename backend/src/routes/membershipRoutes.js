const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");

const {
  getMyMembership,
  getMyMembershipHistory,
  assignMembership,
  getAllMemberships,
  getUserMembership,
  updateMembershipStatus,
  getMembershipStats,
  renewMembership,
  deleteMember,
  modifyMembership,
} = require("../controllers/membershipController");

const { protect, adminOnly } = require("../middlewares/authMiddleware");

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many requests. Try again later." },
});

// User
router.get("/me", protect, getMyMembership);
router.get("/me/history", protect, getMyMembershipHistory);

// Admin
router.get("/stats", protect, adminOnly, getMembershipStats);
router.get("/", protect, adminOnly, getAllMemberships);
router.get("/user/:userId", protect, getUserMembership);
router.post("/assign", protect, adminOnly, writeLimiter, assignMembership);
router.patch("/:id/status", protect, adminOnly, writeLimiter, updateMembershipStatus);
router.patch("/:id/renew", protect, adminOnly, writeLimiter, renewMembership);
router.delete("/user/:userId", protect, adminOnly, deleteMember);
router.put("/:id", protect, adminOnly, writeLimiter, modifyMembership);

module.exports = router;