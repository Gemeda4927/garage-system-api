const express = require('express');
const reviewController = require('../controllers/review.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

// ==========================================
// PUBLIC ROUTES (No Auth Required)
// ==========================================

// Get all reviews (with filters)
router.get('/', reviewController.getReviews);

// Get garage review summary
router.get('/garage/:garageId/summary', reviewController.getGarageReviewSummary);

// Get single review
router.get('/:id', reviewController.getReview);

// ==========================================
// PROTECTED ROUTES (Auth Required)
// ==========================================
router.use(protect);

// ==========================================
// REVIEW MANAGEMENT (Car Owner)
// ==========================================

// Create review (car owner only)
router.post('/', authorize('car_owner'), reviewController.createReview);

// Update review (car owner only)
router.put('/:id', authorize('car_owner'), reviewController.updateReview);

// Soft delete review (car owner or admin)
router.delete('/:id', authorize('car_owner', 'admin'), reviewController.softDeleteReview);

// ==========================================
// REVIEW RESPONSES (Garage Owner)
// ==========================================

// Add response to review
router.post('/:id/response', authorize('garage_owner', 'admin'), reviewController.addResponse);

// Update response
router.put('/:id/response', authorize('garage_owner', 'admin'), reviewController.updateResponse);

// Delete response
router.delete('/:id/response', authorize('garage_owner', 'admin'), reviewController.deleteResponse);

// ==========================================
// IMAGE MANAGEMENT (Car Owner)
// ==========================================

// Upload images
router.post('/:id/images', authorize('car_owner', 'admin'), reviewController.uploadImages);

// Delete image
router.delete('/:id/images/:filename', authorize('car_owner', 'admin'), reviewController.deleteImage);

// ==========================================
// HELPFUL VOTES (All Authenticated Users)
// ==========================================

// Mark review as helpful
router.post('/:id/helpful', reviewController.markHelpful);

// ==========================================
// ADMIN ONLY ROUTES
// ==========================================

// Verify review
router.put('/:id/verify', authorize('admin'), reviewController.verifyReview);

// Restore review
router.put('/:id/restore', authorize('admin'), reviewController.restoreReview);

// Hard delete review
router.delete('/:id/hard', authorize('admin'), reviewController.hardDeleteReview);


module.exports = router;