const express = require('express');
const userController = require('../controllers/user.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

// Protect all routes - require authentication and admin role
router.use(protect, authorize('admin'));

// User routes
router
  .route('/')
  .get(userController.getAllUsers);

router
  .route('/deleted/all')
  .get(userController.getDeletedUsers);

router
  .route('/stats/summary')
  .get(userController.getUserStats);

router
  .route('/:id')
  .get(userController.getUserById)
  .patch(userController.updateUser)
  .delete(userController.softDeleteUser);

router
  .route('/:id/hard')
  .delete(userController.hardDeleteUser);

router
  .route('/:id/restore')
  .put(userController.restoreUser);

router
  .route('/:id/role')
  .put(userController.updateUserRole);

router
  .route('/:id/grant-garage-creation')
  .put(userController.grantGarageCreation);

router
  .route('/:id/revoke-garage-creation')
  .put(userController.revokeGarageCreation);

module.exports = router;