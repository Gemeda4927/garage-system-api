const express = require('express');
const bookingController = require('../controllers/booking.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

// ==========================================
// PUBLIC ROUTES (NO AUTHENTICATION REQUIRED)
// ==========================================

// Check time slot availability - PUBLIC
router.post('/check-availability', bookingController.checkAvailability);

// ==========================================
// PROTECT ALL ROUTES BELOW THIS LINE
// ==========================================
router.use(protect);

// Get bookings by date range (protected)
router.get('/calendar/range', bookingController.getBookingsByDateRange);

// Get booking statistics (admin and garage owners)
router.get('/stats/analytics', authorize('admin', 'garage_owner'), bookingController.getBookingStats);

// Get all bookings (filtered by role)
router.get('/', bookingController.getAllBookings);

// Create booking (car owner only)
router.post('/', authorize('car_owner'), bookingController.createBooking);

// ==========================================
// PARAMETERIZED ROUTES
// ==========================================

// Get single booking
router.get('/:id', bookingController.getBookingById);

// Update booking status
router.put('/:id/status', authorize('garage_owner', 'admin'), bookingController.updateBookingStatus);

// Cancel booking
router.put('/:id/cancel', authorize('car_owner'), bookingController.cancelBooking);

// Get booking timeline
router.get('/:id/timeline', bookingController.getBookingTimeline);

// Upload attachments
router.post('/:id/attachments', bookingController.uploadAttachments);

// Delete attachment
router.delete('/:id/attachments/:filename', bookingController.deleteAttachment);

// Soft delete booking
router.delete('/:id', bookingController.deleteBooking);

module.exports = router;