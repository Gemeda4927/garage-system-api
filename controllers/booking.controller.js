const Garage = require('../models/garage');
const Booking = require('../models/booking');
const Service = require('../models/Service');
const User = require('../models/User');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs').promises;

// ==========================================
// @desc    Create a new booking
// @route   POST /api/bookings
// @access  Private (Car Owner only)
// ==========================================
const createBooking = async (req, res) => {
  let session;
  
  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const {
      garageId,
      serviceId,
      bookingDate,
      timeSlot,
      vehicleInfo,
      notes
    } = req.body;

    // Validate required fields
    if (!garageId || !serviceId || !bookingDate || !timeSlot || !vehicleInfo) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // Validate garage exists and is active
    const garage = await Garage.findOne({ 
      _id: garageId, 
      isDeleted: false,
      status: 'active'
    }).session(session);

    if (!garage) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Garage not found or not active'
      });
    }

    // Validate service exists and belongs to garage
    const service = await Service.findOne({ 
      _id: serviceId, 
      garage: garageId,
      isDeleted: false,
      isAvailable: true
    }).session(session);

    if (!service) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Service not found or not available'
      });
    }

    // Check if time slot is available
    const existingBooking = await Booking.findOne({
      garage: garageId,
      bookingDate: new Date(bookingDate),
      'timeSlot.start': timeSlot.start,
      'timeSlot.end': timeSlot.end,
      status: { $nin: ['cancelled', 'rejected'] },
      isDeleted: false
    }).session(session);

    if (existingBooking) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Time slot already booked'
      });
    }

    // Create booking
    const booking = await Booking.create([{
      carOwner: req.user.id,
      garage: garageId,
      service: serviceId,
      bookingDate: new Date(bookingDate),
      timeSlot,
      vehicleInfo,
      notes: notes || '',
      status: 'pending'
    }], { session });

    // Update garage stats
    garage.stats.totalBookings += 1;
    await garage.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Populate the created booking
    const populatedBooking = await Booking.findById(booking[0]._id)
      .populate('carOwner', 'name email phone avatar')
      .populate('garage', 'name address contactInfo')
      .populate('service', 'name description duration');

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: {
        booking: populatedBooking
      }
    });

  } catch (error) {
    if (session) {
      try { await session.abortTransaction(); } catch (e) {}
      try { session.endSession(); } catch (e) {}
    }
    
    console.error('Create booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating booking',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get all bookings (with filters)
// @route   GET /api/bookings
// @access  Private
// ==========================================
const getAllBookings = async (req, res) => {
  try {
    const {
      status,
      garageId,
      serviceId,
      startDate,
      endDate,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filter = { isDeleted: false };

    // Role-based filtering
    if (req.user.role === 'car_owner') {
      filter.carOwner = req.user.id;
    } else if (req.user.role === 'garage_owner') {
      const userGarages = await Garage.find({ owner: req.user.id }).select('_id');
      const garageIds = userGarages.map(g => g._id);
      filter.garage = { $in: garageIds };
    }

    // Additional filters
    if (status) filter.status = status;
    if (garageId) filter.garage = garageId;
    if (serviceId) filter.service = serviceId;

    if (startDate || endDate) {
      filter.bookingDate = {};
      if (startDate) filter.bookingDate.$gte = new Date(startDate);
      if (endDate) filter.bookingDate.$lte = new Date(endDate);
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const bookings = await Booking.find(filter)
      .populate({
        path: 'carOwner',
        select: 'name email phone avatar',
        match: { isDeleted: false }
      })
      .populate({
        path: 'garage',
        select: 'name address contactInfo stats',
        match: { isDeleted: false }
      })
      .populate({
        path: 'service',
        select: 'name description price duration category',
        match: { isDeleted: false }
      })
      .populate({
        path: 'review',
        select: 'rating comment createdAt',
        justOne: true
      })
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean();

    const total = await Booking.countDocuments(filter);

    const stats = await Booking.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalBookings: { $sum: 1 },
          pendingCount: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          approvedCount: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
          inProgressCount: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
          completedCount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          cancelledCount: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          rejectedCount: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        bookings,
        stats: stats[0] || {
          totalBookings: 0,
          pendingCount: 0,
          approvedCount: 0,
          inProgressCount: 0,
          completedCount: 0,
          cancelledCount: 0,
          rejectedCount: 0
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Get all bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching bookings',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get single booking by ID
// @route   GET /api/bookings/:id
// @access  Private
// ==========================================
const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID'
      });
    }

    const booking = await Booking.findOne({ 
      _id: id, 
      isDeleted: false 
    })
      .populate({
        path: 'carOwner',
        select: 'name email phone avatar'
      })
      .populate({
        path: 'garage',
        select: 'name description address contactInfo businessHours stats images owner',
        populate: {
          path: 'owner',
          select: 'name email phone'
        }
      })
      .populate({
        path: 'service',
        select: 'name description price duration category images'
      })
      .populate({
        path: 'review',
        select: 'rating comment title categories images response createdAt',
        populate: {
          path: 'carOwner',
          select: 'name avatar'
        }
      });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check authorization
    let isAuthorized = false;
    
    if (req.user.role === 'admin') {
      isAuthorized = true;
    } else if (booking.carOwner && booking.carOwner._id.toString() === req.user.id.toString()) {
      isAuthorized = true;
    } else if (req.user.role === 'garage_owner' && booking.garage && booking.garage.owner) {
      const garageOwnerId = booking.garage.owner._id.toString();
      if (garageOwnerId === req.user.id.toString()) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this booking'
      });
    }

    res.status(200).json({
      success: true,
      data: { booking }
    });
  } catch (error) {
    console.error('Get booking by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching booking',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Update booking status
// @route   PUT /api/bookings/:id/status
// @access  Private (Garage Owner or Admin)
// ==========================================
const updateBookingStatus = async (req, res) => {
  let session;
  
  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const { id } = req.params;
    const { status, reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID'
      });
    }

    if (!status) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    const booking = await Booking.findById(id)
      .populate('garage')
      .session(session);

    if (!booking || booking.isDeleted) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check authorization
    const isGarageOwner = booking.garage.owner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isGarageOwner && !isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this booking'
      });
    }

    // If status is the same, just return success without changes
    if (booking.status === status) {
      await session.commitTransaction();
      session.endSession();
      
      const updatedBooking = await Booking.findById(id)
        .populate('carOwner', 'name email phone')
        .populate('garage', 'name address')
        .populate('service', 'name price');

      return res.status(200).json({
        success: true,
        message: `Booking already ${status}`,
        data: { booking: updatedBooking }
      });
    }

    // Validate status transition
    const validTransitions = {
      'pending': ['approved', 'rejected', 'cancelled'],
      'approved': ['in_progress', 'cancelled'],
      'in_progress': ['completed', 'cancelled'],
      'completed': [],
      'cancelled': [],
      'rejected': []
    };

    if (!validTransitions[booking.status] || !validTransitions[booking.status].includes(status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Cannot transition from ${booking.status} to ${status}`
      });
    }

    // Update booking status
    booking.status = status;
    booking.statusHistory = booking.statusHistory || [];
    booking.statusHistory.push({
      status,
      changedBy: req.user.id,
      reason: reason || `Status changed to ${status}`,
      changedAt: new Date()
    });

    // If booking is completed, update garage stats
    if (status === 'completed') {
      const garage = await Garage.findById(booking.garage._id).session(session);
      garage.stats.completedBookings += 1;
      await garage.save({ session });
    }

    await booking.save({ session });
    await session.commitTransaction();
    session.endSession();

    const updatedBooking = await Booking.findById(id)
      .populate('carOwner', 'name email phone')
      .populate('garage', 'name address')
      .populate('service', 'name price');

    res.status(200).json({
      success: true,
      message: `Booking ${status} successfully`,
      data: { booking: updatedBooking }
    });

  } catch (error) {
    if (session) {
      try { await session.abortTransaction(); } catch (e) {}
      try { session.endSession(); } catch (e) {}
    }
    console.error('Update booking status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating booking status',
      error: error.message
    });
  }
};


// ==========================================
// @desc    Cancel booking (by car owner)
// @route   PUT /api/bookings/:id/cancel
// @access  Private (Car Owner)
// ==========================================
const cancelBooking = async (req, res) => {
  let session;
  
  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const { id } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID'
      });
    }

    const booking = await Booking.findOne({
      _id: id,
      carOwner: req.user.id,
      isDeleted: false
    }).session(session);

    if (!booking) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const cancellableStatuses = ['pending', 'approved'];
    if (!cancellableStatuses.includes(booking.status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Cannot cancel booking with status: ${booking.status}`
      });
    }

    booking.status = 'cancelled';
    booking.statusHistory = booking.statusHistory || [];
    booking.statusHistory.push({
      status: 'cancelled',
      changedBy: req.user.id,
      reason: reason || 'Cancelled by customer',
      changedAt: new Date()
    });

    await booking.save({ session });
    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      data: { booking }
    });

  } catch (error) {
    if (session) {
      try { await session.abortTransaction(); } catch (e) {}
      try { session.endSession(); } catch (e) {}
    }
    console.error('Cancel booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error cancelling booking',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Upload booking attachments
// @route   POST /api/bookings/:id/attachments
// @access  Private
// ==========================================
const uploadAttachments = async (req, res) => {
  try {
    const { id } = req.params;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID'
      });
    }

    const booking = await Booking.findById(id);
    if (!booking || booking.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check authorization
    const isAuthorized = 
      booking.carOwner.toString() === req.user.id.toString() ||
      req.user.role === 'admin' ||
      (req.user.role === 'garage_owner' && 
        await Garage.exists({ _id: booking.garage, owner: req.user.id }));

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to upload attachments'
      });
    }

    const filePaths = files.map(file => file.path.replace(/\\/g, '/'));
    booking.attachments = [...booking.attachments, ...filePaths];
    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Attachments uploaded successfully',
      data: { attachments: booking.attachments }
    });

  } catch (error) {
    console.error('Upload attachments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading attachments',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Delete attachment
// @route   DELETE /api/bookings/:id/attachments/:filename
// @access  Private
// ==========================================
const deleteAttachment = async (req, res) => {
  try {
    const { id, filename } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID'
      });
    }

    const booking = await Booking.findById(id);
    if (!booking || booking.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check authorization
    const isAuthorized = 
      booking.carOwner.toString() === req.user.id.toString() ||
      req.user.role === 'admin' ||
      (req.user.role === 'garage_owner' && 
        await Garage.exists({ _id: booking.garage, owner: req.user.id }));

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete attachments'
      });
    }

    const attachmentPath = booking.attachments.find(a => a.includes(filename));
    if (!attachmentPath) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found'
      });
    }

    booking.attachments = booking.attachments.filter(a => !a.includes(filename));
    await booking.save();

    try {
      await fs.unlink(path.join(__dirname, '..', attachmentPath));
    } catch (fileError) {
      console.error('Error deleting file:', fileError);
    }

    res.status(200).json({
      success: true,
      message: 'Attachment deleted successfully',
      data: { attachments: booking.attachments }
    });

  } catch (error) {
    console.error('Delete attachment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting attachment',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get booking timeline/history
// @route   GET /api/bookings/:id/timeline
// @access  Private
// ==========================================
const getBookingTimeline = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID'
      });
    }

    // Populate carOwner and garage to get their IDs
    const booking = await Booking.findById(id)
      .populate('carOwner', '_id')
      .populate('garage', '_id')
      .select('status statusHistory createdAt updatedAt bookingDate timeSlot carOwner garage');

    if (!booking || booking.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Debug logs
    console.log('=== TIMELINE AUTH DEBUG ===');
    console.log('User role:', req.user.role);
    console.log('User ID:', req.user.id.toString());
    console.log('Booking carOwner ID:', booking.carOwner ? booking.carOwner._id.toString() : 'N/A');
    console.log('Booking garage ID:', booking.garage ? booking.garage._id.toString() : 'N/A');
    console.log('===========================');

    // Check authorization
    let isAuthorized = false;

    // Admin can view anything
    if (req.user.role === 'admin') {
      isAuthorized = true;
    }
    // Car owner can view their own bookings
    else if (booking.carOwner && booking.carOwner._id.toString() === req.user.id.toString()) {
      isAuthorized = true;
    }
    // Garage owner can view bookings for their garage
    else if (req.user.role === 'garage_owner' && booking.garage) {
      const garageExists = await Garage.exists({ 
        _id: booking.garage._id, 
        owner: req.user.id 
      });
      if (garageExists) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this booking'
      });
    }

    const timeline = [
      {
        event: 'Booking Created',
        status: 'created',
        timestamp: booking.createdAt,
        description: 'Booking request submitted'
      }
    ];

    if (booking.statusHistory && booking.statusHistory.length > 0) {
      booking.statusHistory.forEach(change => {
        timeline.push({
          event: `Status changed to ${change.status}`,
          status: change.status,
          timestamp: change.changedAt,
          description: change.reason || `Booking ${change.status}`,
          changedBy: change.changedBy
        });
      });
    }

    timeline.push({
      event: 'Current Status',
      status: booking.status,
      timestamp: booking.updatedAt,
      description: `Booking is currently ${booking.status}`
    });

    timeline.sort((a, b) => a.timestamp - b.timestamp);

    res.status(200).json({
      success: true,
      data: {
        bookingId: id,
        currentStatus: booking.status,
        timeline
      }
    });

  } catch (error) {
    console.error('Get booking timeline error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching booking timeline',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get bookings by date range
// @route   GET /api/bookings/calendar
// @access  Private
// ==========================================
const getBookingsByDateRange = async (req, res) => {
  try {
    const { startDate, endDate, garageId } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }

    const filter = {
      bookingDate: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      },
      isDeleted: false
    };

    if (req.user.role === 'car_owner') {
      filter.carOwner = req.user.id;
    } else if (req.user.role === 'garage_owner') {
      const userGarages = await Garage.find({ owner: req.user.id }).select('_id');
      const garageIds = userGarages.map(g => g._id);
      filter.garage = { $in: garageIds };
    }

    if (garageId) filter.garage = garageId;

    const bookings = await Booking.find(filter)
      .populate('carOwner', 'name')
      .populate('service', 'name duration')
      .populate('garage', 'name')
      .select('bookingDate timeSlot status vehicleInfo carOwner service')
      .sort('bookingDate timeSlot.start');

    const groupedBookings = bookings.reduce((acc, booking) => {
      const dateStr = booking.bookingDate.toISOString().split('T')[0];
      if (!acc[dateStr]) acc[dateStr] = [];
      acc[dateStr].push(booking);
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      data: {
        startDate,
        endDate,
        totalBookings: bookings.length,
        bookings: groupedBookings
      }
    });

  } catch (error) {
    console.error('Get bookings by date range error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching bookings by date range',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get booking statistics
// @route   GET /api/bookings/stats/analytics
// @access  Private (Admin and Garage Owners)
// ==========================================
const getBookingStats = async (req, res) => {
  try {
    const { garageId, period = 'month' } = req.query;
    
    let matchStage = { isDeleted: false };

    if (req.user.role === 'garage_owner') {
      const userGarages = await Garage.find({ owner: req.user.id }).select('_id');
      const garageIds = userGarages.map(g => g._id);
      matchStage.garage = { $in: garageIds };
    }

    if (garageId && req.user.role === 'admin') {
      matchStage.garage = new mongoose.Types.ObjectId(garageId);
    }

    let dateGroup;
    if (period === 'day') {
      dateGroup = { $dateToString: { format: '%Y-%m-%d', date: '$bookingDate' } };
    } else if (period === 'week') {
      dateGroup = { $week: '$bookingDate' };
    } else if (period === 'month') {
      dateGroup = { $dateToString: { format: '%Y-%m', date: '$bookingDate' } };
    } else {
      dateGroup = { $dateToString: { format: '%Y', date: '$bookingDate' } };
    }

    const stats = await Booking.aggregate([
      { $match: matchStage },
      {
        $facet: {
          overview: [
            {
              $group: {
                _id: null,
                totalBookings: { $sum: 1 },
                completedBookings: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
                cancelledBookings: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
                pendingBookings: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
                approvedBookings: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
                inProgressBookings: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
                rejectedBookings: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } }
              }
            }
          ],
          byStatus: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 }
              }
            }
          ],
          byDate: [
            {
              $group: {
                _id: dateGroup,
                count: { $sum: 1 },
                completedCount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }
              }
            },
            { $sort: { '_id': 1 } }
          ],
          popularServices: [
            {
              $group: {
                _id: '$service',
                count: { $sum: 1 }
              }
            },
            { $sort: { count: -1 } },
            { $limit: 5 },
            {
              $lookup: {
                from: 'services',
                localField: '_id',
                foreignField: '_id',
                as: 'serviceInfo'
              }
            },
            { $unwind: '$serviceInfo' },
            {
              $project: {
                serviceName: '$serviceInfo.name',
                category: '$serviceInfo.category',
                count: 1
              }
            }
          ],
          peakHours: [
            {
              $group: {
                _id: '$timeSlot.start',
                count: { $sum: 1 }
              }
            },
            { $sort: { count: -1 } },
            { $limit: 5 }
          ]
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        overview: stats[0].overview[0] || {
          totalBookings: 0,
          completedBookings: 0,
          cancelledBookings: 0,
          pendingBookings: 0,
          approvedBookings: 0,
          inProgressBookings: 0,
          rejectedBookings: 0
        },
        byStatus: stats[0].byStatus,
        byDate: stats[0].byDate,
        popularServices: stats[0].popularServices,
        peakHours: stats[0].peakHours,
        period
      }
    });

  } catch (error) {
    console.error('Get booking stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching booking statistics',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Check availability for a time slot
// @route   POST /api/bookings/check-availability
// @access  Public
// ==========================================
const checkAvailability = async (req, res) => {
  try {
    const { garageId, serviceId, date, timeSlot } = req.body;

    if (!garageId || !date || !timeSlot) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    const garage = await Garage.findOne({ _id: garageId, isDeleted: false });
    if (!garage) {
      return res.status(404).json({
        success: false,
        message: 'Garage not found'
      });
    }

    const dayOfWeek = new Date(date).toLocaleString('en-us', { weekday: 'long' }).toLowerCase();
    const businessDay = garage.businessHours[dayOfWeek];
    
    if (!businessDay || businessDay.closed) {
      return res.status(200).json({
        success: true,
        data: {
          available: false,
          reason: 'Garage is closed on this day'
        }
      });
    }

    const isWithinBusinessHours = 
      timeSlot.start >= businessDay.open && 
      timeSlot.end <= businessDay.close;

    if (!isWithinBusinessHours) {
      return res.status(200).json({
        success: true,
        data: {
          available: false,
          reason: 'Time slot is outside business hours',
          businessHours: businessDay
        }
      });
    }

    const existingBooking = await Booking.findOne({
      garage: garageId,
      bookingDate: new Date(date),
      'timeSlot.start': timeSlot.start,
      'timeSlot.end': timeSlot.end,
      status: { $nin: ['cancelled', 'rejected'] },
      isDeleted: false
    });

    if (existingBooking) {
      return res.status(200).json({
        success: true,
        data: {
          available: false,
          reason: 'Time slot already booked'
        }
      });
    }

    if (serviceId) {
      const service = await Service.findById(serviceId);
      if (service) {
        const startTime = timeSlot.start.split(':');
        const endTime = timeSlot.end.split(':');
        const slotDuration = (parseInt(endTime[0]) * 60 + parseInt(endTime[1])) - 
                           (parseInt(startTime[0]) * 60 + parseInt(startTime[1]));
        
        if (slotDuration < service.duration) {
          return res.status(200).json({
            success: true,
            data: {
              available: false,
              reason: `Time slot duration (${slotDuration}min) is less than service duration (${service.duration}min)`
            }
          });
        }
      }
    }

    res.status(200).json({
      success: true,
      data: {
        available: true,
        message: 'Time slot is available'
      }
    });

  } catch (error) {
    console.error('Check availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking availability',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Soft delete booking
// @route   DELETE /api/bookings/:id
// @access  Private (Admin or Owner)
// ==========================================
const deleteBooking = async (req, res) => {
  let session;
  
  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID'
      });
    }

    const booking = await Booking.findById(id).session(session);
    if (!booking || booking.isDeleted) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const isAuthorized = 
      req.user.role === 'admin' ||
      booking.carOwner.toString() === req.user.id.toString() ||
      (req.user.role === 'garage_owner' && 
        await Garage.exists({ _id: booking.garage, owner: req.user.id }));

    if (!isAuthorized) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this booking'
      });
    }

    booking.isDeleted = true;
    booking.deletedAt = new Date();
    booking.deletedBy = req.user.id;
    await booking.save({ session });

    if (booking.status === 'completed') {
      const garage = await Garage.findById(booking.garage).session(session);
      garage.stats.completedBookings = Math.max(0, garage.stats.completedBookings - 1);
      await garage.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'Booking deleted successfully'
    });

  } catch (error) {
    if (session) {
      try { await session.abortTransaction(); } catch (e) {}
      try { session.endSession(); } catch (e) {}
    }
    console.error('Delete booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting booking',
      error: error.message
    });
  }
};

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
  createBooking,
  getAllBookings,
  getBookingById,
  updateBookingStatus,
  cancelBooking,
  uploadAttachments,
  deleteAttachment,
  getBookingTimeline,
  getBookingsByDateRange,
  getBookingStats,
  checkAvailability,
  deleteBooking
};