const User = require('../models/User');
const Booking = require('../models/booking');
const Review = require('../models/Review');
const Payment = require('../models/Payment');
const Garage = require('../models/garage');
const Service = require('../models/Service');
const mongoose = require('mongoose');

// ==========================================
// Utility Functions
// ==========================================
const isValidObjectId = id => mongoose.Types.ObjectId.isValid(id);

// ==========================================
// @desc    Get all users (with filters)
// @route   GET /api/users
// @access  Private/Admin
// ==========================================
const getAllUsers = async (req, res) => {
  try {
    const {
      role,
      isDeleted,
      canCreateGarage,
      search,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const filter = {};

    if (role) filter.role = role;

    if (req.user.role === 'admin' && isDeleted !== undefined) {
      filter.isDeleted = isDeleted === 'true';
    } else {
      filter.isDeleted = false;
    }

    if (canCreateGarage !== undefined) {
      filter.canCreateGarage = canCreateGarage === 'true';
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const users = await User.find(filter)
      .select('-password -__v')
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    const total = await User.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get single user by ID
// @route   GET /api/users/:id
// @access  Private/Admin or Owner
// ==========================================
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    if (req.user.role !== 'admin' && req.user.id !== id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this user'
      });
    }

    const user = await User.findById(id)
      .select('-password -__v');

    if (!user || (user.isDeleted && req.user.role !== 'admin')) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const [bookingsCount, reviewsCount, paymentsCount, garage] = await Promise.all([
      Booking.countDocuments({ carOwner: id, isDeleted: false }),
      Review.countDocuments({ carOwner: id, isDeleted: false }),
      Payment.countDocuments({ user: id, isDeleted: false }),
      Garage.findOne({ owner: id, isDeleted: false }).select('name status stats')
    ]);

    const userData = user.toObject();
    userData.stats = {
      totalBookings: bookingsCount,
      totalReviews: reviewsCount,
      totalPayments: paymentsCount,
      ownedGarage: garage || null
    };

    res.status(200).json({
      success: true,
      data: userData
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Update user profile
// @route   PATCH /api/users/:id
// @access  Private/Admin or Owner
// ==========================================
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    if (req.user.role !== 'admin' && req.user.id !== id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this user'
      });
    }

    const user = await User.findById(id);
    if (!user || (user.isDeleted && req.user.role !== 'admin')) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Remove restricted fields
    delete updates.password;
    delete updates._id;
    delete updates.__v;
    delete updates.createdAt;
    delete updates.updatedAt;

    // Restrict updates for non-admins
    if (req.user.role !== 'admin') {
      const allowed = ['name', 'phone', 'avatar'];
      Object.keys(updates).forEach(k => {
        if (!allowed.includes(k)) delete updates[k];
      });
    }

    // Check email uniqueness
    if (updates.email && updates.email !== user.email) {
      const existing = await User.findOne({ email: updates.email.toLowerCase() });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'Email already in use'
        });
      }
      updates.email = updates.email.toLowerCase();
    }

    Object.assign(user, updates);
    await user.save();

    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: userResponse
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Update user role
// @route   PUT /api/users/:id/role
// @access  Private/Admin
// ==========================================
const updateUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['admin', 'car_owner', 'garage_owner'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role'
      });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { role },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'User role updated',
      data: user
    });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user role',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Soft delete user
// @route   DELETE /api/users/:id
// @access  Private/Admin or Owner
// ==========================================
const softDeleteUser = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    if (req.user.role !== 'admin' && req.user.id !== id) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this user'
      });
    }

    const user = await User.findById(id).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.isDeleted) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'User already deleted'
      });
    }

    // Soft delete user
    user.isDeleted = true;
    user.deletedAt = new Date();
    user.deletedBy = req.user.id;
    await user.save({ session });

    // Soft delete garages if garage owner
    if (user.role === 'garage_owner') {
      await Garage.updateMany(
        { owner: id, isDeleted: false },
        {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: req.user.id
        },
        { session }
      );
    }

    // Soft delete bookings and reviews
    await Booking.updateMany(
      { carOwner: id, isDeleted: false },
      {
        isDeleted: true,
        status: 'cancelled'
      },
      { session }
    );

    await Review.updateMany(
      { carOwner: id, isDeleted: false },
      { isDeleted: true },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'User soft deleted successfully',
      data: { deletedAt: user.deletedAt }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Error soft deleting user:', error);
    res.status(500).json({
      success: false,
      message: 'Error soft deleting user',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Hard delete user (permanent)
// @route   DELETE /api/users/:id/hard
// @access  Private/Admin only
// ==========================================
const hardDeleteUser = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Only admins can hard delete
    if (req.user.role !== 'admin') {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Only admins can permanently delete users'
      });
    }

    // Find user
    const user = await User.findById(id).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent deleting own account
    if (req.user.id === id) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Cannot hard delete your own account'
      });
    }

    const userInfo = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role
    };

    // Delete related data
    if (user.role === 'garage_owner') {
      const garages = await Garage.find({ owner: id }).session(session);
      const garageIds = garages.map(g => g._id);

      if (mongoose.models.Service) {
        await Service.deleteMany({ garage: { $in: garageIds } }, { session });
      }
      await Booking.deleteMany({ garage: { $in: garageIds } }, { session });
      await Review.deleteMany({ garage: { $in: garageIds } }, { session });
      await Garage.deleteMany({ owner: id }, { session });
    }

    await Booking.deleteMany({ carOwner: id }, { session });
    await Review.deleteMany({ carOwner: id }, { session });
    await Payment.deleteMany({ user: id }, { session });
    await User.findByIdAndDelete(id, { session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'User permanently deleted',
      data: { deletedUser: userInfo }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Error hard deleting user:', error);
    res.status(500).json({
      success: false,
      message: 'Error hard deleting user',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Restore soft deleted user
// @route   PUT /api/users/:id/restore
// @access  Private/Admin only
// ==========================================
const restoreUser = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Only admins can restore
    if (req.user.role !== 'admin') {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Only admins can restore users'
      });
    }

    const user = await User.findById(id).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.isDeleted) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'User is not deleted'
      });
    }

    // Restore user
    user.isDeleted = false;
    user.deletedAt = null;
    user.deletedBy = null;
    await user.save({ session });

    // Restore garages if garage owner
    if (user.role === 'garage_owner') {
      await Garage.updateMany(
        { owner: id, isDeleted: true },
        {
          isDeleted: false,
          deletedAt: null,
          deletedBy: null
        },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'User restored successfully',
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Error restoring user:', error);
    res.status(500).json({
      success: false,
      message: 'Error restoring user',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get deleted users
// @route   GET /api/users/deleted/all
// @access  Private/Admin
// ==========================================
const getDeletedUsers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = 'deletedAt',
      sortOrder = 'desc'
    } = req.query;

    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view deleted users'
      });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const users = await User.find({ isDeleted: true })
      .select('-password -__v')
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    const total = await User.countDocuments({ isDeleted: true });

    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching deleted users:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching deleted users',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Grant garage creation permission
// @route   PUT /api/users/:id/grant-garage-creation
// @access  Private/Admin
// ==========================================
const grantGarageCreation = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.role !== 'garage_owner') {
      return res.status(400).json({
        success: false,
        message: 'User is not a garage owner'
      });
    }

    user.canCreateGarage = true;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Garage creation permission granted',
      data: {
        id: user._id,
        canCreateGarage: user.canCreateGarage
      }
    });
  } catch (error) {
    console.error('Error granting permission:', error);
    res.status(500).json({
      success: false,
      message: 'Error granting garage creation permission',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Revoke garage creation permission
// @route   PUT /api/users/:id/revoke-garage-creation
// @access  Private/Admin
// ==========================================
const revokeGarageCreation = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.canCreateGarage = false;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Garage creation permission revoked',
      data: {
        id: user._id,
        canCreateGarage: user.canCreateGarage
      }
    });
  } catch (error) {
    console.error('Error revoking permission:', error);
    res.status(500).json({
      success: false,
      message: 'Error revoking garage creation permission',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get user statistics
// @route   GET /api/users/stats/summary
// @access  Private/Admin
// ==========================================
const getUserStats = async (req, res) => {
  try {
    const stats = await User.aggregate([
      {
        $facet: {
          totalUsers: [{ $match: {} }, { $count: 'count' }],
          byRole: [
            { $group: { _id: '$role', count: { $sum: 1 } } }
          ],
          byStatus: [
            { $group: { _id: '$isDeleted', count: { $sum: 1 } } }
          ],
          garageCreationEligible: [
            {
              $match: {
                role: 'garage_owner',
                canCreateGarage: true,
                isDeleted: false
              }
            },
            { $count: 'count' }
          ],
          recentRegistrations: [
            {
              $match: {
                createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
                isDeleted: false
              }
            },
            { $count: 'count' }
          ]
        }
      }
    ]);

    const result = stats[0];

    res.status(200).json({
      success: true,
      data: {
        totalUsers: result.totalUsers[0]?.count || 0,
        byRole: result.byRole,
        activeUsers: result.byStatus.find(s => s._id === false)?.count || 0,
        deletedUsers: result.byStatus.find(s => s._id === true)?.count || 0,
        garageCreationEligible: result.garageCreationEligible[0]?.count || 0,
        recentRegistrations: result.recentRegistrations[0]?.count || 0
      }
    });
  } catch (error) {
    console.error('Error fetching user statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user statistics',
      error: error.message
    });
  }
};

// ==========================================
// Module Exports
// ==========================================
module.exports = {
  getAllUsers,
  getUserById,
  updateUser,
  updateUserRole,
  softDeleteUser,
  hardDeleteUser,
  restoreUser,
  getDeletedUsers,
  grantGarageCreation,
  revokeGarageCreation,
  getUserStats
};