

const User = require('../models/User');
const Booking = require('../models/booking');
const Review = require('../models/Review');
const Payment = require('../models/Payment');
const Garage = require('../models/garage');
const mongoose = require('mongoose');

// @desc    Get all users (with filters)
// @route   GET /api/users
// @access  Private/Admin
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

    // Build filter object
    const filter = {};

    // Filter by role
    if (role) {
      filter.role = role;
    }

    // Filter by deletion status (admin only)
    if (req.user.role === 'admin' && isDeleted !== undefined) {
      filter.isDeleted = isDeleted === 'true';
    } else {
      // Non-admins can only see non-deleted users
      filter.isDeleted = false;
    }

    // Filter by garage creation permission
    if (canCreateGarage !== undefined) {
      filter.canCreateGarage = canCreateGarage === 'true';
    }

    // Search by name or email
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Sorting
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query
    const users = await User.find(filter)
      .select('-password -__v')
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .populate({
        path: 'garageCreationPayments.payment',
        select: 'amount status createdAt'
      });

    // Get total count
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
    res.status(500).json({
      success: false,
      message: 'Error fetching users',
      error: error.message
    });
  }
};

// @desc    Get single user by ID
// @route   GET /api/users/:id
// @access  Private/Admin or Owner
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user has permission (admin or viewing self)
    if (req.user.role !== 'admin' && req.user.id !== id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this user'
      });
    }

    const user = await User.findById(id)
      .select('-password -__v')
      .populate({
        path: 'garageCreationPayments.payment',
        select: 'amount status createdAt'
      });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // If user is deleted and viewer is not admin
    if (user.isDeleted && req.user.role !== 'admin') {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get additional stats for the user
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
      data: {
        user: userData
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching user',
      error: error.message
    });
  }
};

const updateUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can update roles'
      });
    }

    if (!['admin', 'car_owner', 'garage_owner'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role'
      });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { role },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: 'User role updated',
      data: user
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


// @desc    Update user profile
// @route   PUT /api/users/:id
// @access  Private/Admin or Owner
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Check if user has permission (admin or updating self)
    if (req.user.role !== 'admin' && req.user.id !== id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this user'
      });
    }

    // Find user
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // If user is deleted, only admin can update
    if (user.isDeleted && req.user.role !== 'admin') {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Restrict what non-admins can update
    if (req.user.role !== 'admin') {
      const allowedUpdates = ['name', 'phone', 'avatar'];
      Object.keys(updates).forEach(key => {
        if (!allowedUpdates.includes(key)) {
          delete updates[key];
        }
      });
    }

    // If admin is updating role, validate it
    if (req.user.role === 'admin' && updates.role) {
      if (!['admin', 'car_owner', 'garage_owner'].includes(updates.role)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid role'
        });
      }
    }

    // If email is being updated, check it's not taken
    if (updates.email && updates.email !== user.email) {
      const existingUser = await User.findOne({ email: updates.email.toLowerCase() });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Email already in use'
        });
      }
      updates.email = updates.email.toLowerCase();
    }

    // Update user
    Object.assign(user, updates);
    await user.save();

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          avatar: user.avatar,
          canCreateGarage: user.canCreateGarage
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating user',
      error: error.message
    });
  }
};

// @desc    Soft delete user
// @route   DELETE /api/users/:id/soft
// @access  Private/Admin or Owner
const softDeleteUser = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    // Check if user has permission (admin or deleting self)
    if (req.user.role !== 'admin' && req.user.id !== id) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this user'
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

    // Check if already deleted
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

    // If user is a garage owner, soft delete their garage(s)
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

    // Soft delete user's bookings
    await Booking.updateMany(
      { carOwner: id, isDeleted: false },
      {
        isDeleted: true,
        status: 'cancelled'
      },
      { session }
    );

    // Soft delete user's reviews
    await Review.updateMany(
      { carOwner: id, isDeleted: false },
      {
        isDeleted: true
      },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'User soft deleted successfully',
      data: {
        deletedAt: user.deletedAt
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({
      success: false,
      message: 'Error soft deleting user',
      error: error.message
    });
  }
};

// @desc    Hard delete user (permanent)
// @route   DELETE /api/users/:id/hard
// @access  Private/Admin only
const hardDeleteUser = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

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

    // Prevent deleting own account (optional safety)
    if (req.user.id === id) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Cannot hard delete your own account'
      });
    }

    // Store user info for response
    const userInfo = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role
    };

    // Hard delete all related data
    if (user.role === 'garage_owner') {
      // Find all garages owned by user
      const garages = await Garage.find({ owner: id }).session(session);
      const garageIds = garages.map(g => g._id);

      // Delete all services of those garages
      await Service.deleteMany({ garage: { $in: garageIds } }, { session });

      // Delete all bookings for those garages
      await Booking.deleteMany({ garage: { $in: garageIds } }, { session });

      // Delete all reviews for those garages
      await Review.deleteMany({ garage: { $in: garageIds } }, { session });

      // Delete the garages
      await Garage.deleteMany({ owner: id }, { session });
    }

    // Delete user's bookings (as car owner)
    await Booking.deleteMany({ carOwner: id }, { session });

    // Delete user's reviews
    await Review.deleteMany({ carOwner: id }, { session });

    // Delete user's payments
    await Payment.deleteMany({ user: id }, { session });

    // Finally, delete the user
    await User.findByIdAndDelete(id, { session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'User permanently deleted',
      data: {
        deletedUser: userInfo
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({
      success: false,
      message: 'Error hard deleting user',
      error: error.message
    });
  }
};

// @desc    Restore soft deleted user
// @route   PUT /api/users/:id/restore
// @access  Private/Admin only
const restoreUser = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    // Only admins can restore users
    if (req.user.role !== 'admin') {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Only admins can restore users'
      });
    }

    // Find user (including deleted)
    const user = await User.findById(id).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user is not deleted
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
    user.deletedAt = undefined;
    user.deletedBy = undefined;
    await user.save({ session });

    // If user is a garage owner, restore their garages
    if (user.role === 'garage_owner') {
      await Garage.updateMany(
        { owner: id, isDeleted: true },
        {
          isDeleted: false,
          deletedAt: undefined,
          deletedBy: undefined
        },
        { session }
      );
    }

    // Restore user's bookings (optional - based on business logic)
    // You might want to keep them deleted or restore them
    // await Booking.updateMany(
    //   { carOwner: id, isDeleted: true },
    //   { isDeleted: false },
    //   { session }
    // );

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'User restored successfully',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({
      success: false,
      message: 'Error restoring user',
      error: error.message
    });
  }
};

// @desc    Get deleted users (admin only)
// @route   GET /api/users/deleted/all
// @access  Private/Admin
const getDeletedUsers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = 'deletedAt',
      sortOrder = 'desc'
    } = req.query;

    // Only admins can view deleted users
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view deleted users'
      });
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Sorting
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Find deleted users
    const users = await User.find({ isDeleted: true })
      .select('-password -__v')
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .populate('deletedBy', 'name email');

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
    res.status(500).json({
      success: false,
      message: 'Error fetching deleted users',
      error: error.message
    });
  }
};

// @desc    Grant garage creation permission (admin only)
// @route   PUT /api/users/:id/grant-garage-creation
// @access  Private/Admin
const grantGarageCreation = async (req, res) => {
  try {
    const { id } = req.params;

    // Find user
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user is garage owner
    if (user.role !== 'garage_owner') {
      return res.status(400).json({
        success: false,
        message: 'User is not a garage owner'
      });
    }

    // Grant permission
    user.canCreateGarage = true;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Garage creation permission granted',
      data: {
        userId: user._id,
        canCreateGarage: user.canCreateGarage
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error granting garage creation permission',
      error: error.message
    });
  }
};

// @desc    Revoke garage creation permission (admin only)
// @route   PUT /api/users/:id/revoke-garage-creation
// @access  Private/Admin
const revokeGarageCreation = async (req, res) => {
  try {
    const { id } = req.params;

    // Find user
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Revoke permission
    user.canCreateGarage = false;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Garage creation permission revoked',
      data: {
        userId: user._id,
        canCreateGarage: user.canCreateGarage
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error revoking garage creation permission',
      error: error.message
    });
  }
};

// @desc    Get user statistics (admin only)
// @route   GET /api/users/stats/summary
// @access  Private/Admin
const getUserStats = async (req, res) => {
  try {
    const stats = await User.aggregate([
      {
        $facet: {
          totalUsers: [{ $count: 'count' }],
          byRole: [
            {
              $group: {
                _id: '$role',
                count: { $sum: 1 }
              }
            }
          ],
          byStatus: [
            {
              $group: {
                _id: '$isDeleted',
                count: { $sum: 1 }
              }
            }
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
                createdAt: {
                  $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
                },
                isDeleted: false
              }
            },
            { $count: 'count' }
          ]
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalUsers: stats[0].totalUsers[0]?.count || 0,
        byRole: stats[0].byRole,
        activeUsers: stats[0].byStatus.find(s => s._id === false)?.count || 0,
        deletedUsers: stats[0].byStatus.find(s => s._id === true)?.count || 0,
        garageCreationEligible: stats[0].garageCreationEligible[0]?.count || 0,
        recentRegistrations: stats[0].recentRegistrations[0]?.count || 0
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching user statistics',
      error: error.message
    });
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  updateUser,
  softDeleteUser,
  hardDeleteUser,
  restoreUser,
  updateUserRole,
  getDeletedUsers,
  grantGarageCreation,
  revokeGarageCreation,
  getUserStats
};