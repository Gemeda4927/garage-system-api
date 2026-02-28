const express = require('express');
const serviceController = require('../controllers/service.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

// Protect all routes
router.use(protect);

// ==========================================
// SERVICE ROUTES
// ==========================================

// Get all services
router.get('/', serviceController.getAllServices);

// Create service
router.post(
  '/',
  authorize('garage_owner', 'admin'),
  serviceController.createService
);

// Bulk create services
router.post(
  '/bulk',
  authorize('garage_owner', 'admin'),
  serviceController.bulkCreateServices
);

// Get service categories
router.get('/categories/list', serviceController.getCategories);

// Get single service
router.get('/:id', serviceController.getServiceById);

// Update service
router.patch(
  '/:id',
  authorize('garage_owner', 'admin'),
  serviceController.updateService
);

// Toggle availability
router.put(
  '/:id/toggle-availability',
  authorize('garage_owner', 'admin'),
  serviceController.toggleAvailability
);

// ==========================================
// DELETE ROUTES
// ==========================================

// Soft delete service (garage owner & admin)
router.delete(
  '/:id',
  authorize('garage_owner', 'admin'),
  serviceController.deleteService
);

// Hard delete service (garage owner & admin)
router.delete(
  '/:id/hard',
  authorize('garage_owner', 'admin'),
  serviceController.hardDeleteService
);

// Restore service (admin only)
router.put(
  '/:id/restore',
  authorize('admin'),
  serviceController.restoreService
);

// Get service bookings
router.get(
  '/:id/bookings',
  authorize('garage_owner', 'admin'),
  serviceController.getServiceBookings
);

// Get service analytics
router.get(
  '/:id/analytics',
  authorize('garage_owner', 'admin'),
  serviceController.getServiceAnalytics
);

module.exports = router;