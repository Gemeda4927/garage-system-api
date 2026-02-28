const express = require('express');
const bookingController = require('../controllers/booking.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

// ==========================================
// PROTECT ALL ROUTES
// ==========================================
router.use(protect);

// ==========================================
// BOOKING MANAGEMENT ROUTES
// ==========================================

// Get all bookings (filtered by role)
router.get('/', bookingController.getAllBookings);

// Create booking (car owner only)
router.post('/', authorize('car_owner'), bookingController.createBooking);

// Get single booking (owner, garage owner, or admin)
router.get('/:id', bookingController.getBookingById);

// Update booking status (garage owner or admin)
router.put('/:id/status', authorize('garage_owner', 'admin'), bookingController.updateBookingStatus);

// Cancel booking (car owner only)
router.put('/:id/cancel', authorize('car_owner'), bookingController.cancelBooking);

// Get booking timeline (owner, garage owner, or admin)
router.get('/:id/timeline', bookingController.getBookingTimeline);

// ==========================================
// AVAILABILITY ROUTES
// ==========================================

// Check time slot availability
router.post('/check-availability', bookingController.checkAvailability);

// Get bookings by date range
router.get('/calendar/range', bookingController.getBookingsByDateRange);

// ==========================================
// ATTACHMENT ROUTES
// ==========================================

// Upload attachments
router.post('/:id/attachments', bookingController.uploadAttachments);

// Delete attachment
router.delete('/:id/attachments/:filename', bookingController.deleteAttachment);

// ==========================================
// STATISTICS ROUTES
// ==========================================

// Get booking statistics (admin and garage owners)
router.get('/stats/analytics', authorize('admin', 'garage_owner'), bookingController.getBookingStats);

// ==========================================
// DELETE ROUTES
// ==========================================

// Soft delete booking (admin, owner, or garage owner)
router.delete('/:id', bookingController.deleteBooking);

// ==========================================
// EXPORT ROUTER
// ==========================================
module.exports = router;