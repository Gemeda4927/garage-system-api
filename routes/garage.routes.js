const express = require('express');
const garageController = require('../controllers/garage.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

// =========================
// PUBLIC ROUTES (No Auth)
// =========================

// Get all garages (with filters)
router.get('/', garageController.getAllGarages);

// Get nearby garages
router.get('/nearby', garageController.getNearbyGarages);

// Get single garage
router.get('/:id', garageController.getGarageById);

// Get garage services
router.get('/:id/services', garageController.getGarageServices);

// Get garage reviews
router.get('/:id/reviews', garageController.getGarageReviews);

// =========================
// PROTECTED ROUTES (Auth Required)
// =========================
router.use(protect);

// =========================
// GARAGE OWNER & ADMIN ROUTES
// =========================

// Create garage
router.post('/', authorize('garage_owner', 'admin'), garageController.createGarage);

// Update garage
router.patch('/:id', authorize('garage_owner', 'admin'), garageController.updateGarage);

// Soft delete garage
router.delete('/:id', authorize('garage_owner', 'admin'), garageController.deleteGarage);

// Get garage bookings (owner only)
router.get('/:id/bookings', authorize('garage_owner', 'admin'), garageController.getGarageBookings);

// Get garage analytics (owner only)
router.get('/:id/analytics', authorize('garage_owner', 'admin'), garageController.getGarageAnalytics);

// Upload files (images/documents)
router.post('/:id/uploads', authorize('garage_owner', 'admin'), garageController.uploadFiles);

// Delete file
router.delete('/:id/files/:filename', authorize('garage_owner', 'admin'), garageController.deleteFile);

// =========================
// ADMIN ONLY ROUTES
// =========================

// Restore deleted garage
router.put('/:id/restore', authorize('admin'), garageController.restoreGarage);

// Verify garage
router.put('/:id/verify', authorize('admin'), garageController.verifyGarage);

// Toggle garage active status
router.put('/:id/toggle-active', authorize('admin'), garageController.toggleActive);

module.exports = router;