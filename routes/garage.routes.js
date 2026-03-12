const express = require('express');
const garageController = require('../controllers/garage.controller');

const router = express.Router();

// =========================
// PUBLIC ROUTES (No Auth)
// =========================

// Get all garages (with filters)
router.get('/', garageController.getAllGarages);
router.get('/all/complete', garageController.getAllGaragesComplete);

// Get nearby garages
router.get('/nearby', garageController.getNearbyGarages);

// Get single garage
router.get('/:id', garageController.getGarageById);

// Get garage services
router.get('/:id/services', garageController.getGarageServices);

// Get garage reviews
router.get('/:id/reviews', garageController.getGarageReviews);

// =========================
// ROUTES PREVIOUSLY PROTECTED
// =========================

// Create garage
router.post('/', garageController.createGarage);

// Update garage
router.patch('/:id', garageController.updateGarage);

// Soft delete garage
router.delete('/:id', garageController.deleteGarage);

// Get garage bookings
router.get('/:id/bookings', garageController.getGarageBookings);

// Get garage analytics
router.get('/:id/analytics', garageController.getGarageAnalytics);

// Upload files (images/documents)
router.post('/:id/uploads', garageController.uploadFiles);

// Delete file
router.delete('/:id/files/:filename', garageController.deleteFile);

// =========================
// ROUTES PREVIOUSLY ADMIN ONLY
// =========================

// Get deleted garages
router.get('/deleted/all', garageController.getDeletedGarages);

// Get unverified garages
router.get('/unverified/all', garageController.getUnverifiedGarages);

// Restore deleted garage
router.put('/:id/restore', garageController.restoreGarage);

// Verify garage
router.put('/:id/verify', garageController.verifyGarage);

// Toggle garage active status
router.put('/:id/toggle-active', garageController.toggleActive);

module.exports = router;