const express = require('express');
const userController = require('../controllers/user.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const router = express.Router();

// Protect all routes - require authentication
router.use(protect);

// All routes below require admin role
router.use(authorize('admin'));

// ==========================================
// User Management Routes
// ==========================================

// Get all users with filters
router.get('/', userController.getAllUsers);

// Get deleted users
router.get('/deleted/all', userController.getDeletedUsers);

// Get user statistics
router.get('/stats/summary', userController.getUserStats);

// Get single user by ID
router.get('/:id', userController.getUserById);

// Update user
router.patch('/:id', userController.updateUser);

// Soft delete user
router.delete('/:id', userController.softDeleteUser);

// Hard delete user (permanent)
router.delete('/:id/hard', userController.hardDeleteUser);

// Restore soft deleted user
router.put('/:id/restore', userController.restoreUser);

// Update user role
router.put('/:id/role', userController.updateUserRole);

// Grant garage creation permission
router.put('/:id/grant-garage-creation', userController.grantGarageCreation);

// Revoke garage creation permission
router.put('/:id/revoke-garage-creation', userController.revokeGarageCreation);

module.exports = router;