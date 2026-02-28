const express = require('express');
const paymentController = require('../controllers/payment.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

// ==========================================
// PUBLIC WEBHOOK
// ==========================================
router.post('/chapa-webhook', paymentController.handleChapaWebhook);

// ==========================================
// PROTECT ALL ROUTES BELOW
// ==========================================
router.use(protect);

// ==========================================
// PAYMENT METHODS (All Users)
// ==========================================
router.get('/methods', paymentController.getUserPaymentMethods);

// ==========================================
// GARAGE OWNER PAYMENTS
// ==========================================
router.post('/garage/init', authorize('garage_owner'), paymentController.initGaragePayment);


// ==========================================
// CAR OWNER PAYMENTS
// ==========================================
router.post('/booking/init', authorize('car_owner'), paymentController.initBookingPayment);
router.get('/booking/verify/:tx_ref', authorize('car_owner'), paymentController.verifyPayment);

// ==========================================
// USER PAYMENTS (Own payments)
// ==========================================
router.get('/user/me', paymentController.getAllPayments);
router.post('/:id/retry', paymentController.retryPayment);

// ==========================================
// ADMIN ONLY PAYMENTS
// ==========================================
router.get('/', authorize('admin'), paymentController.getAllPayments);
router.get('/stats', authorize('admin'), paymentController.getPaymentStats);
router.get('/:id', authorize('admin'), paymentController.getPayment);
router.post('/:id/refund', authorize('admin'), paymentController.initiateRefund);
router.get('/garage/verify/:tx_ref', authorize('admin'), paymentController.verifyPayment);

module.exports = router;