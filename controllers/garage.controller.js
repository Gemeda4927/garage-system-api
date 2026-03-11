const Garage = require('../models/garage');
const Service = require('../models/Service');
const Booking = require('../models/booking');
const Review = require('../models/Review');
const User = require('../models/User');
const Payment = require('../models/Payment');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs').promises;

// ==========================================
// Helper function to calculate distance
// ==========================================
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

const deg2rad = (deg) => deg * (Math.PI/180);

// ==========================================
// @desc    Create a new garage (after payment)
// @route   POST /api/garages
// @access  Private (Garage Owner with payment)
// ==========================================
const createGarage = async (req, res) => {
  let session;
  
  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const {
      name,
      description,
      coordinates,
      address,
      contactInfo,
      businessHours,
      images,
      documents
    } = req.body;

    // Check if user exists
    if (!req.user || !req.user.id) {
      await session.abortTransaction();
      session.endSession();
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Check if user can create garage
    const user = await User.findById(req.user.id).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.canCreateGarage) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Payment required to create a garage'
      });
    }

    // Check if user already has a garage
    const existingGarage = await Garage.findOne({ 
      owner: req.user.id, 
      isDeleted: false 
    }).session(session);

    if (existingGarage) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'You already have a garage. Contact admin to create another one.'
      });
    }

    // Find the completed payment for garage creation
    const payment = await Payment.findOne({
      user: req.user.id,
      paymentType: 'garage_creation',
      status: 'completed'
    }).session(session);

    if (!payment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'No valid payment found for garage creation'
      });
    }

    // Initialize garageCreation if needed
    if (!payment.garageCreation) {
      payment.garageCreation = {
        status: 'pending',
        garage: null
      };
    }

    // Create garage
    const garage = await Garage.create([{
      name,
      description,
      coordinates: {
        type: 'Point',
        coordinates: coordinates || [38.7578, 9.0054]
      },
      address: {
        street: address?.street || '',
        city: address?.city || '',
        state: address?.state || '',
        country: address?.country || 'Ethiopia',
        zipCode: address?.zipCode || ''
      },
      contactInfo: {
        phone: contactInfo?.phone || '',
        email: contactInfo?.email || '',
        website: contactInfo?.website || ''
      },
      businessHours: {
        monday: businessHours?.monday || { open: '09:00', close: '18:00', closed: false },
        tuesday: businessHours?.tuesday || { open: '09:00', close: '18:00', closed: false },
        wednesday: businessHours?.wednesday || { open: '09:00', close: '18:00', closed: false },
        thursday: businessHours?.thursday || { open: '09:00', close: '18:00', closed: false },
        friday: businessHours?.friday || { open: '09:00', close: '18:00', closed: false },
        saturday: businessHours?.saturday || { open: '09:00', close: '15:00', closed: false },
        sunday: businessHours?.sunday || { closed: true }
      },
      owner: req.user.id,
      creationPayment: payment._id,
      images: images || [],
      documents: documents || [],
      status: 'pending',
      isActive: false,
      isVerified: false,
      paidAt: new Date()
    }], { session });

    // Update payment status
    payment.garageCreation = {
      garage: garage[0]._id,
      status: 'used'
    };
    await payment.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Populate the created garage
    const populatedGarage = await Garage.findById(garage[0]._id)
      .populate('owner', 'name email phone avatar')
      .populate('creationPayment', 'amount transactionId createdAt');

    res.status(201).json({
      success: true,
      message: 'Garage created successfully. Pending verification.',
      data: {
        garage: populatedGarage
      }
    });

  } catch (error) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch (abortError) {
        console.error('Error aborting transaction:', abortError);
      }
      try {
        session.endSession();
      } catch (endError) {
        console.error('Error ending session:', endError);
      }
    }
    
    console.error('Create garage error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating garage',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get all garages (with filters)
// @route   GET /api/garages
// @access  Public
// ==========================================
const getAllGarages = async (req, res) => {
  try {
    const {
      city,
      service,
      minRating,
      maxPrice,
      isVerified,
      isActive,
      status,
      search,
      lat,
      lng,
      radius,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      includeUnverified = false // For admin to see unverified garages
    } = req.query;

    // Build filter - exclude deleted garages by default
    const filter = { isDeleted: false };

    // Handle verification status
    if (isVerified !== undefined) {
      filter.isVerified = isVerified === 'true';
    } else if (!includeUnverified && (!req.user || req.user.role !== 'admin')) {
      // For public users, only show verified garages
      filter.isVerified = true;
    }

    // Handle active status
    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }

    // Handle user-specific visibility
    if (req.user && req.user.id) {
      const userGarages = await Garage.find({ owner: req.user.id }).distinct('_id');
      
      // If user is garage owner, they can see their own garages regardless of status
      if (userGarages.length > 0) {
        filter.$or = [
          { status: 'active', isActive: true, isVerified: true },
          { _id: { $in: userGarages } }
        ];
      } else {
        // Regular users or public
        filter.status = 'active';
        filter.isActive = true;
      }
    } else {
      // Public users
      filter.status = 'active';
      filter.isActive = true;
      filter.isVerified = true;
    }

    // City filter
    if (city) {
      filter['address.city'] = { $regex: city, $options: 'i' };
    }

    // Service filter
    if (service) {
      const services = await Service.find({ 
        name: { $regex: service, $options: 'i' },
        isDeleted: false 
      }).distinct('garage');
      
      if (services.length > 0) {
        filter._id = { $in: services };
      } else {
        filter._id = { $in: [] };
      }
    }

    // Rating filter
    if (minRating) {
      filter['stats.averageRating'] = { $gte: parseFloat(minRating) };
    }

    // Status filter (admin only)
    if (status && req.user && req.user.role === 'admin') {
      filter.status = status;
    }

    // Search filter
    if (search) {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { 'address.street': { $regex: search, $options: 'i' } },
          { 'address.city': { $regex: search, $options: 'i' } }
        ]
      });
    }

    // Geospatial query
    if (lat && lng && radius) {
      filter.coordinates = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          $maxDistance: parseFloat(radius) * 1000
        }
      };
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Sorting
    let sort = {};
    if (sortBy === 'distance' && lat && lng) {
      sort = {
        coordinates: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [parseFloat(lng), parseFloat(lat)]
            }
          }
        }
      };
    } else {
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    }

    // Execute query with proper population
    const garages = await Garage.find(filter)
      .populate({
        path: 'owner',
        select: 'name email phone avatar'
      })
      .populate({
        path: 'services',
        select: 'name description price duration category images isAvailable',
        match: { isDeleted: false, isAvailable: true },
        options: { limit: 5 },
        populate: {
          path: 'bookings',
          select: 'bookingDate timeSlot status carOwner',
          match: { 
            bookingDate: { $gte: new Date() },
            status: { $in: ['pending', 'approved'] }
          },
          options: { limit: 3, sort: { bookingDate: 1 } },
          populate: {
            path: 'carOwner',
            select: 'name phone'
          }
        }
      })
      .populate({
        path: 'reviews',
        select: 'rating comment carOwner createdAt',
        match: { isDeleted: false, isVerified: true },
        options: { 
          limit: 3,
          sort: { createdAt: -1 }
        },
        populate: {
          path: 'carOwner',
          select: 'name avatar'
        }
      })
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Add distance to each garage
    if (lat && lng) {
      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);
      
      garages.forEach(garage => {
        if (garage.coordinates?.coordinates) {
          const [garageLng, garageLat] = garage.coordinates.coordinates;
          const distance = calculateDistance(userLat, userLng, garageLat, garageLng);
          garage.distance = {
            value: Math.round(distance * 10) / 10,
            unit: 'km'
          };
        }
      });
    }

    // Get total count
    const total = await Garage.countDocuments(filter);

    // Get price range for filtered garages
    const garageIds = garages.map(g => g._id);
    let priceRange = { minPrice: 0, maxPrice: 0, avgPrice: 0 };
    
    if (garageIds.length > 0) {
      const priceRangeResult = await Service.aggregate([
        { 
          $match: { 
            garage: { $in: garageIds }, 
            isDeleted: false,
            isAvailable: true 
          } 
        },
        {
          $group: {
            _id: null,
            minPrice: { $min: '$price' },
            maxPrice: { $max: '$price' },
            avgPrice: { $avg: '$price' }
          }
        }
      ]);
      
      if (priceRangeResult.length > 0) {
        priceRange = priceRangeResult[0];
      }
    }

    res.status(200).json({
      success: true,
      data: {
        garages,
        priceRange,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Get all garages error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching garages',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get deleted garages (Admin only)
// @route   GET /api/garages/deleted
// @access  Private/Admin
// ==========================================
const getDeletedGarages = async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.'
      });
    }

    const {
      search,
      page = 1,
      limit = 10,
      sortBy = 'deletedAt',
      sortOrder = 'desc'
    } = req.query;

    // Filter for deleted garages only
    const filter = { isDeleted: true };

    // Search filter
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'address.street': { $regex: search, $options: 'i' } },
        { 'address.city': { $regex: search, $options: 'i' } }
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
    const garages = await Garage.find(filter)
      .populate('owner', 'name email phone avatar')
      .populate('deletedBy', 'name email')
      .populate({
        path: 'services',
        select: 'name price',
        match: { isDeleted: true }
      })
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Get total count
    const total = await Garage.countDocuments(filter);

    // Get stats for deleted garages
    const stats = await Garage.aggregate([
      { $match: { isDeleted: true } },
      {
        $group: {
          _id: null,
          totalGarages: { $sum: 1 },
          totalServices: { $sum: { $size: '$services' } },
          avgDeletionTime: { $avg: { $subtract: ['$deletedAt', '$createdAt'] } }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        garages,
        stats: stats[0] || {
          totalGarages: total,
          totalServices: 0,
          avgDeletionTime: 0
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
    console.error('Get deleted garages error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching deleted garages',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get unverified garages (Admin only)
// @route   GET /api/garages/unverified
// @access  Private/Admin
// ==========================================
const getUnverifiedGarages = async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.'
      });
    }

    const {
      search,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Filter for unverified and not deleted garages
    const filter = { 
      isVerified: false,
      isDeleted: false 
    };

    // Search filter
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'address.street': { $regex: search, $options: 'i' } },
        { 'address.city': { $regex: search, $options: 'i' } }
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
    const garages = await Garage.find(filter)
      .populate('owner', 'name email phone avatar')
      .populate('creationPayment', 'amount transactionId createdAt')
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Get total count
    const total = await Garage.countDocuments(filter);

    // Get stats for unverified garages
    const stats = await Garage.aggregate([
      { $match: { isVerified: false, isDeleted: false } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          avgWaitTime: { 
            $avg: { 
              $subtract: [new Date(), '$createdAt'] 
            } 
          }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        garages,
        stats,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Get unverified garages error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching unverified garages',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get single garage by ID
// @route   GET /api/garages/:id
// @access  Public
// ==========================================
const getGarageById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid garage ID'
      });
    }

    const garage = await Garage.findOne({ 
      _id: id, 
      isDeleted: false 
    })
      .populate({
        path: 'owner',
        select: 'name email phone avatar'
      })
      .populate({
        path: 'services',
        select: 'name description price duration category images isAvailable createdAt',
        match: { isDeleted: false },
        options: { sort: { createdAt: -1 } },
        populate: {
          path: 'bookings',
          select: 'bookingDate timeSlot status carOwner',
          match: { 
            bookingDate: { $gte: new Date() },
            status: { $in: ['pending', 'approved'] }
          },
          options: { limit: 5, sort: { bookingDate: 1 } },
          populate: {
            path: 'carOwner',
            select: 'name phone avatar'
          }
        }
      })
      .populate({
        path: 'reviews',
        match: { isDeleted: false, isVerified: true },
        options: { 
          sort: { createdAt: -1 },
          limit: 10
        },
        populate: [
          {
            path: 'carOwner',
            select: 'name avatar'
          },
          {
            path: 'booking',
            select: 'service timeSlot',
            populate: {
              path: 'service',
              select: 'name'
            }
          }
        ]
      })
      .populate({
        path: 'creationPayment',
        select: 'amount transactionId createdAt status'
      })
      .lean();

    if (!garage) {
      return res.status(404).json({
        success: false,
        message: 'Garage not found'
      });
    }

    // Check visibility
    if (!req.user || req.user.role !== 'admin') {
      const isOwner = req.user && garage.owner._id.toString() === req.user.id;
      if (!isOwner && (garage.status !== 'active' || !garage.isActive || !garage.isVerified)) {
        return res.status(404).json({
          success: false,
          message: 'Garage not found'
        });
      }
    }

    // Get additional stats
    const [
      totalBookings,
      completedBookings,
      upcomingBookings,
      recentBookings,
      todayBookings
    ] = await Promise.all([
      Booking.countDocuments({ garage: id, isDeleted: false }),
      Booking.countDocuments({ garage: id, status: 'completed', isDeleted: false }),
      Booking.countDocuments({ 
        garage: id, 
        bookingDate: { $gte: new Date() },
        status: { $in: ['pending', 'approved'] },
        isDeleted: false 
      }),
      Booking.find({ garage: id, isDeleted: false })
        .populate('carOwner', 'name email')
        .populate('service', 'name price')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Booking.find({
        garage: id,
        bookingDate: { 
          $gte: new Date().setHours(0, 0, 0, 0),
          $lte: new Date().setHours(23, 59, 59, 999)
        },
        status: { $nin: ['cancelled', 'rejected'] },
        isDeleted: false
      }).select('bookingDate timeSlot service')
        .populate('service', 'name')
    ]);

    garage.stats = {
      ...garage.stats,
      totalBookings,
      completedBookings,
      upcomingBookings,
      todayBookings: todayBookings.length
    };

    garage.recentBookings = recentBookings;

    res.status(200).json({
      success: true,
      data: { garage }
    });
  } catch (error) {
    console.error('Get garage by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching garage',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Update garage
// @route   PUT /api/garages/:id
// @access  Private (Garage Owner or Admin)
// ==========================================
const updateGarage = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const updates = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid garage ID'
      });
    }

    const garage = await Garage.findById(id).session(session);
    if (!garage || garage.isDeleted) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Garage not found'
      });
    }

    const isOwner = garage.owner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this garage'
      });
    }

    // Filter allowed updates for non-admin
    if (!isAdmin) {
      const allowedUpdates = [
        'name', 'description', 'coordinates', 'address',
        'contactInfo', 'businessHours', 'images', 'documents'
      ];
      Object.keys(updates).forEach(key => {
        if (!allowedUpdates.includes(key)) {
          delete updates[key];
        }
      });
    }

    // Handle business hours update properly
    if (updates.businessHours) {
      Object.keys(updates.businessHours).forEach(day => {
        if (garage.businessHours[day]) {
          garage.businessHours[day] = {
            ...garage.businessHours[day].toObject(),
            ...updates.businessHours[day]
          };
        }
      });
      delete updates.businessHours;
    }

    // Apply other updates
    Object.assign(garage, updates);
    await garage.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Populate updated garage
    const updatedGarage = await Garage.findById(id)
      .populate('owner', 'name email phone avatar')
      .populate({
        path: 'services',
        select: 'name price duration category',
        match: { isDeleted: false },
        options: { limit: 5 }
      });

    res.status(200).json({
      success: true,
      message: 'Garage updated successfully',
      data: { garage: updatedGarage }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Update garage error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating garage',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Verify garage (Admin only)
// @route   PUT /api/garages/:id/verify
// @access  Private/Admin
// ==========================================
const verifyGarage = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid garage ID'
      });
    }

    const garage = await Garage.findById(id).session(session);
    if (!garage || garage.isDeleted) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Garage not found'
      });
    }

    // Check if garage is already verified
    if (garage.isVerified && status === 'active') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Garage is already verified'
      });
    }

    garage.isVerified = status === 'active';
    garage.status = status;
    garage.isActive = status === 'active';
    garage.verifiedAt = new Date();
    garage.verifiedBy = req.user.id;
    garage.verificationNotes = notes;

    await garage.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: `Garage ${status === 'active' ? 'verified' : 'rejected'} successfully`,
      data: {
        garage: {
          id: garage._id,
          name: garage.name,
          status: garage.status,
          isVerified: garage.isVerified,
          isActive: garage.isActive,
          verifiedAt: garage.verifiedAt
        }
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Verify garage error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying garage',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Toggle garage active status
// @route   PUT /api/garages/:id/toggle-active
// @access  Private (Garage Owner or Admin)
// ==========================================
const toggleActive = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid garage ID'
      });
    }

    const garage = await Garage.findById(id);
    if (!garage || garage.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Garage not found'
      });
    }

    const isOwner = garage.owner.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this garage'
      });
    }

    // Check if garage is verified before allowing activation
    if (!garage.isVerified && !garage.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Garage must be verified before activation'
      });
    }

    garage.isActive = !garage.isActive;
    await garage.save();

    res.status(200).json({
      success: true,
      message: `Garage ${garage.isActive ? 'activated' : 'deactivated'} successfully`,
      data: { isActive: garage.isActive }
    });
  } catch (error) {
    console.error('Toggle active error:', error);
    res.status(500).json({
      success: false,
      message: 'Error toggling garage status',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Upload garage images/documents
// @route   POST /api/garages/:id/uploads
// @access  Private (Garage Owner or Admin)
// ==========================================
const uploadFiles = async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.body;
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
        message: 'Invalid garage ID'
      });
    }

    const garage = await Garage.findById(id);
    if (!garage || garage.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Garage not found'
      });
    }

    const isOwner = garage.owner.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to upload files'
      });
    }

    const filePaths = files.map(file => file.path.replace(/\\/g, '/'));

    if (type === 'images') {
      garage.images = [...garage.images, ...filePaths];
    } else if (type === 'documents') {
      garage.documents = [...garage.documents, ...filePaths];
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Use "images" or "documents"'
      });
    }

    await garage.save();

    res.status(200).json({
      success: true,
      message: 'Files uploaded successfully',
      data: {
        [type]: type === 'images' ? garage.images : garage.documents
      }
    });
  } catch (error) {
    console.error('Upload files error:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading files',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Delete file
// @route   DELETE /api/garages/:id/files/:filename
// @access  Private (Garage Owner or Admin)
// ==========================================
const deleteFile = async (req, res) => {
  try {
    const { id, filename } = req.params;
    const { type } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid garage ID'
      });
    }

    const garage = await Garage.findById(id);
    if (!garage || garage.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Garage not found'
      });
    }

    const isOwner = garage.owner.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete files'
      });
    }

    const fileArray = type === 'images' ? garage.images : garage.documents;
    const filePath = fileArray.find(f => f.includes(filename));

    if (!filePath) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    if (type === 'images') {
      garage.images = garage.images.filter(f => !f.includes(filename));
    } else {
      garage.documents = garage.documents.filter(f => !f.includes(filename));
    }
    await garage.save();

    // Delete file from filesystem
    try {
      const fullPath = path.join(__dirname, '..', filePath);
      await fs.access(fullPath);
      await fs.unlink(fullPath);
    } catch (fileError) {
      console.error('Error deleting file from filesystem:', fileError);
      // Continue even if file doesn't exist
    }

    res.status(200).json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting file',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get garage services
// @route   GET /api/garages/:id/services
// @access  Public
// ==========================================
const getGarageServices = async (req, res) => {
  try {
    const { id } = req.params;
    const { category, isAvailable, page = 1, limit = 20 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid garage ID'
      });
    }

    // Check if garage exists and is accessible
    const garage = await Garage.findOne({ 
      _id: id, 
      isDeleted: false 
    });

    if (!garage) {
      return res.status(404).json({
        success: false,
        message: 'Garage not found'
      });
    }

    // Check visibility
    if (!req.user || req.user.role !== 'admin') {
      const isOwner = req.user && garage.owner.toString() === req.user.id;
      if (!isOwner && (garage.status !== 'active' || !garage.isActive || !garage.isVerified)) {
        return res.status(404).json({
          success: false,
          message: 'Garage not found'
        });
      }
    }

    const filter = { 
      garage: id, 
      isDeleted: false 
    };

    if (category) {
      filter.category = category;
    }

    if (isAvailable !== undefined) {
      filter.isAvailable = isAvailable === 'true';
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const services = await Service.find(filter)
      .select('name description price duration category images isAvailable')
      .populate({
        path: 'bookings',
        select: 'bookingDate timeSlot status carOwner',
        match: { 
          bookingDate: { $gte: new Date() },
          status: { $in: ['pending', 'approved'] }
        },
        options: { limit: 5, sort: { bookingDate: 1 } },
        populate: {
          path: 'carOwner',
          select: 'name phone'
        }
      })
      .populate({
        path: 'garage',
        select: 'name address contactInfo'
      })
      .skip(skip)
      .limit(limitNum)
      .sort('category name');

    const total = await Service.countDocuments(filter);

    // Get category summary
    const categorySummary = await Service.aggregate([
      { $match: { garage: new mongoose.Types.ObjectId(id), isDeleted: false } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          minPrice: { $min: '$price' },
          maxPrice: { $max: '$price' },
          avgPrice: { $avg: '$price' }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        services,
        categorySummary,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Get garage services error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching garage services',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get service bookings for a garage
// @route   GET /api/garages/:id/service-bookings
// @access  Private (Garage Owner or Admin)
// ==========================================
const getGarageServiceBookings = async (req, res) => {
  try {
    const { id } = req.params;
    const { serviceId, date, status, page = 1, limit = 20 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid garage ID'
      });
    }

    const garage = await Garage.findById(id);
    if (!garage || garage.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Garage not found'
      });
    }

    const isOwner = garage.owner.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view these bookings'
      });
    }

    // Build filter
    const filter = { 
      garage: id,
      isDeleted: false 
    };

    if (serviceId) {
      filter.service = serviceId;
    }

    if (status) {
      filter.status = status;
    }

    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      filter.bookingDate = { $gte: startDate, $lte: endDate };
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const bookings = await Booking.find(filter)
      .populate({
        path: 'service',
        select: 'name price duration category'
      })
      .populate({
        path: 'carOwner',
        select: 'name phone email avatar'
      })
      .populate({
        path: 'payment',
        select: 'amount status method transactionId'
      })
      .sort({ bookingDate: -1, 'timeSlot.start': 1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Booking.countDocuments(filter);

    // Group by service for statistics
    const groupedByService = await Booking.aggregate([
      {
        $match: {
          garage: new mongoose.Types.ObjectId(id),
          isDeleted: false
        }
      },
      {
        $group: {
          _id: '$service',
          totalBookings: { $sum: 1 },
          upcomingBookings: {
            $sum: {
              $cond: [
                { 
                  $and: [
                    { $gte: ['$bookingDate', new Date()] },
                    { $in: ['$status', ['pending', 'approved']] }
                  ]
                },
                1,
                0
              ]
            }
          },
          completedBookings: {
            $sum: {
              $cond: [{ $eq: ['$status', 'completed'] }, 1, 0]
            }
          },
          cancelledBookings: {
            $sum: {
              $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0]
            }
          },
          totalRevenue: {
            $sum: {
              $cond: [{ $eq: ['$isPaid', true] }, '$price.total', 0]
            }
          }
        }
      },
      {
        $lookup: {
          from: 'services',
          localField: '_id',
          foreignField: '_id',
          as: 'serviceInfo'
        }
      },
      {
        $unwind: '$serviceInfo'
      },
      {
        $project: {
          serviceId: '$_id',
          serviceName: '$serviceInfo.name',
          category: '$serviceInfo.category',
          price: '$serviceInfo.price',
          totalBookings: 1,
          upcomingBookings: 1,
          completedBookings: 1,
          cancelledBookings: 1,
          totalRevenue: 1
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        bookings,
        groupedByService,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });

  } catch (error) {
    console.error('Get garage service bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching service bookings',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get garage reviews
// @route   GET /api/garages/:id/reviews
// @access  Public
// ==========================================
const getGarageReviews = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      rating, 
      hasResponse,
      page = 1, 
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid garage ID'
      });
    }

    // Check if garage exists and is accessible
    const garage = await Garage.findOne({ 
      _id: id, 
      isDeleted: false 
    });

    if (!garage) {
      return res.status(404).json({
        success: false,
        message: 'Garage not found'
      });
    }

    const filter = { 
      garage: id, 
      isDeleted: false,
      isVerified: true 
    };

    if (rating) {
      filter.rating = parseInt(rating);
    }

    if (hasResponse !== undefined) {
      if (hasResponse === 'true') {
        filter['response.comment'] = { $exists: true, $ne: null };
      } else {
        filter['response.comment'] = { $exists: false };
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const reviews = await Review.find(filter)
      .populate({
        path: 'carOwner',
        select: 'name avatar'
      })
      .populate({
        path: 'booking',
        select: 'service timeSlot bookingDate',
        populate: {
          path: 'service',
          select: 'name price'
        }
      })
      .populate({
        path: 'response.respondedBy',
        select: 'name email role'
      })
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean();

    const total = await Review.countDocuments(filter);

    // Get rating distribution
    const ratingDistribution = await Review.aggregate([
      { $match: { garage: new mongoose.Types.ObjectId(id), isDeleted: false } },
      {
        $group: {
          _id: '$rating',
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    // Calculate average rating
    const averageRating = await Review.aggregate([
      { $match: { garage: new mongoose.Types.ObjectId(id), isDeleted: false } },
      {
        $group: {
          _id: null,
          avgRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 }
        }
      }
    ]);

    // Get response rate
    const responseRate = await Review.aggregate([
      { 
        $match: { 
          garage: new mongoose.Types.ObjectId(id), 
          isDeleted: false 
        } 
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          responded: { 
            $sum: { 
              $cond: [{ $ne: ['$response.comment', null] }, 1, 0] 
            } 
          }
        }
      },
      {
        $project: {
          responseRate: { 
            $multiply: [
              { $divide: ['$responded', '$total'] }, 
              100
            ]
          }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        reviews,
        summary: {
          averageRating: averageRating[0]?.avgRating || 0,
          totalReviews: averageRating[0]?.totalReviews || 0,
          ratingDistribution,
          responseRate: responseRate[0]?.responseRate || 0
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
    console.error('Get garage reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching garage reviews',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get garage bookings
// @route   GET /api/garages/:id/bookings
// @access  Private (Garage Owner or Admin)
// ==========================================
const getGarageBookings = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status,
      startDate,
      endDate,
      page = 1,
      limit = 20,
      sortBy = 'bookingDate',
      sortOrder = 'desc'
    } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid garage ID'
      });
    }

    const garage = await Garage.findById(id);
    if (!garage || garage.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Garage not found'
      });
    }

    const isOwner = garage.owner.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view these bookings'
      });
    }

    const filter = { 
      garage: id, 
      isDeleted: false 
    };

    if (status) {
      filter.status = status;
    }

    if (startDate || endDate) {
      filter.bookingDate = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        filter.bookingDate.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.bookingDate.$lte = end;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const bookings = await Booking.find(filter)
      .populate({
        path: 'carOwner',
        select: 'name email phone avatar'
      })
      .populate({
        path: 'service',
        select: 'name price duration category',
        populate: {
          path: 'garage',
          select: 'name'
        }
      })
      .populate({
        path: 'payment',
        select: 'amount status method transactionId createdAt'
      })
      .populate({
        path: 'review',
        select: 'rating comment createdAt',
        populate: {
          path: 'carOwner',
          select: 'name'
        }
      })
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean();

    const total = await Booking.countDocuments(filter);

    // Get comprehensive stats
    const stats = await Booking.aggregate([
      { $match: { garage: new mongoose.Types.ObjectId(id), isDeleted: false } },
      {
        $facet: {
          byStatus: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
                revenue: { 
                  $sum: { 
                    $cond: [{ $eq: ['$isPaid', true] }, '$price.total', 0] 
                  } 
                }
              }
            }
          ],
          byService: [
            {
              $group: {
                _id: '$service',
                count: { $sum: 1 },
                revenue: { $sum: '$price.total' }
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
                count: 1,
                revenue: 1
              }
            }
          ],
          dailyStats: [
            {
              $match: {
                bookingDate: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
              }
            },
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$bookingDate' } },
                count: { $sum: 1 },
                revenue: { $sum: '$price.total' }
              }
            },
            { $sort: { '_id': 1 } }
          ],
          upcomingStats: [
            {
              $match: {
                bookingDate: { $gte: new Date() },
                status: { $in: ['pending', 'approved'] }
              }
            },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                estimatedRevenue: { $sum: '$price.total' }
              }
            }
          ]
        }
      }
    ]);

    // Calculate total revenue and upcoming
    const totalRevenue = bookings
      .filter(b => b.isPaid)
      .reduce((sum, b) => sum + (b.price?.total || 0), 0);

    const upcomingBookings = await Booking.countDocuments({
      garage: id,
      bookingDate: { $gte: new Date() },
      status: { $in: ['pending', 'approved'] },
      isDeleted: false
    });

    res.status(200).json({
      success: true,
      data: {
        bookings,
        stats: {
          byStatus: stats[0]?.byStatus || [],
          byService: stats[0]?.byService || [],
          dailyStats: stats[0]?.dailyStats || [],
          upcomingStats: stats[0]?.upcomingStats[0] || { total: 0, estimatedRevenue: 0 },
          totalRevenue,
          upcomingBookings,
          totalBookings: total
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
    console.error('Get garage bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching garage bookings',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get garage analytics
// @route   GET /api/garages/:id/analytics
// @access  Private (Garage Owner or Admin)
// ==========================================
const getGarageAnalytics = async (req, res) => {
  try {
    const { id } = req.params;
    const { period = 'month' } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid garage ID'
      });
    }

    const garage = await Garage.findById(id);
    if (!garage || garage.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Garage not found'
      });
    }

    const isOwner = garage.owner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view analytics'
      });
    }

    const endDate = new Date();
    let startDate = new Date();
    let previousStartDate = new Date();
    
    switch (period) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        previousStartDate.setDate(previousStartDate.getDate() - 14);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        previousStartDate.setMonth(previousStartDate.getMonth() - 2);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        previousStartDate.setMonth(previousStartDate.getMonth() - 6);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        previousStartDate.setFullYear(previousStartDate.getFullYear() - 2);
        break;
      default:
        startDate.setMonth(startDate.getMonth() - 1);
        previousStartDate.setMonth(previousStartDate.getMonth() - 2);
    }

    const analytics = await Booking.aggregate([
      {
        $match: {
          garage: new mongoose.Types.ObjectId(id),
          bookingDate: { $gte: startDate, $lte: endDate },
          isDeleted: false
        }
      },
      {
        $facet: {
          revenue: [
            {
              $group: {
                _id: {
                  year: { $year: '$bookingDate' },
                  month: { $month: '$bookingDate' },
                  day: { $dayOfMonth: '$bookingDate' },
                  week: { $week: '$bookingDate' }
                },
                date: { $first: '$bookingDate' },
                total: { 
                  $sum: { 
                    $cond: [{ $eq: ['$isPaid', true] }, '$price.total', 0] 
                  } 
                },
                count: { $sum: 1 },
                avgValue: { $avg: '$price.total' }
              }
            },
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
          ],
          byService: [
            {
              $group: {
                _id: '$service',
                count: { $sum: 1 },
                revenue: { 
                  $sum: { 
                    $cond: [{ $eq: ['$isPaid', true] }, '$price.total', 0] 
                  } 
                }
              }
            },
            { $sort: { count: -1 } },
            { $limit: 10 },
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
                price: '$serviceInfo.price',
                count: 1,
                revenue: 1
              }
            }
          ],
          byStatus: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
                revenue: { 
                  $sum: { 
                    $cond: [{ $eq: ['$isPaid', true] }, '$price.total', 0] 
                  } 
                }
              }
            }
          ],
          popularHours: [
            {
              $group: {
                _id: '$timeSlot.start',
                count: { $sum: 1 }
              }
            },
            { $sort: { count: -1 } },
            { $limit: 5 }
          ],
          customerRetention: [
            {
              $group: {
                _id: '$carOwner',
                count: { $sum: 1 },
                totalSpent: { $sum: '$price.total' }
              }
            },
            {
              $group: {
                _id: null,
                oneTime: { 
                  $sum: { $cond: [{ $eq: ['$count', 1] }, 1, 0] } 
                },
                returning: { 
                  $sum: { $cond: [{ $gt: ['$count', 1] }, 1, 0] } 
                },
                frequent: { 
                  $sum: { $cond: [{ $gt: ['$count', 3] }, 1, 0] } 
                },
                averageSpent: { $avg: '$totalSpent' }
              }
            }
          ],
          peakDays: [
            {
              $group: {
                _id: { $dayOfWeek: '$bookingDate' },
                count: { $sum: 1 }
              }
            },
            { $sort: { count: -1 } }
          ]
        }
      }
    ]);

    // Get previous period for comparison
    const previousPeriodStats = await Booking.aggregate([
      {
        $match: {
          garage: new mongoose.Types.ObjectId(id),
          bookingDate: { $gte: previousStartDate, $lte: startDate },
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          totalBookings: { $sum: 1 },
          totalRevenue: { 
            $sum: { 
              $cond: [{ $eq: ['$isPaid', true] }, '$price.total', 0] 
            } 
          },
          averageValue: { $avg: '$price.total' }
        }
      }
    ]);

    const currentStats = analytics[0]?.revenue?.reduce(
      (acc, day) => ({
        totalRevenue: acc.totalRevenue + day.total,
        totalBookings: acc.totalBookings + day.count,
        avgValue: (acc.totalRevenue + day.total) / (acc.totalBookings + day.count) || 0
      }),
      { totalRevenue: 0, totalBookings: 0, avgValue: 0 }
    ) || { totalRevenue: 0, totalBookings: 0, avgValue: 0 };

    const previous = previousPeriodStats[0] || { totalBookings: 0, totalRevenue: 0, averageValue: 0 };

    res.status(200).json({
      success: true,
      data: {
        period,
        dateRange: { startDate, endDate },
        analytics: analytics[0] || {},
        summary: {
          current: currentStats,
          previous,
          growth: {
            bookings: previous.totalBookings 
              ? ((currentStats.totalBookings - previous.totalBookings) / previous.totalBookings) * 100 
              : 100,
            revenue: previous.totalRevenue 
              ? ((currentStats.totalRevenue - previous.totalRevenue) / previous.totalRevenue) * 100 
              : 100,
            averageValue: previous.averageValue 
              ? ((currentStats.avgValue - previous.averageValue) / previous.averageValue) * 100 
              : 0
          }
        }
      }
    });
  } catch (error) {
    console.error('Get garage analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching garage analytics',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get nearby garages
// @route   GET /api/garages/nearby
// @access  Public
// ==========================================
const getNearbyGarages = async (req, res) => {
  try {
    const { lat, lng, radius = 10, limit = 20 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const garages = await Garage.find({
      coordinates: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          $maxDistance: parseFloat(radius) * 1000
        }
      },
      status: 'active',
      isActive: true,
      isVerified: true,
      isDeleted: false
    })
      .select('name address contactInfo coordinates stats images businessHours')
      .populate({
        path: 'services',
        select: 'name price duration category',
        match: { isDeleted: false, isAvailable: true },
        options: { limit: 3 }
      })
      .populate({
        path: 'reviews',
        select: 'rating',
        match: { isDeleted: false, isVerified: true },
        options: { limit: 5 }
      })
      .limit(parseInt(limit))
      .lean();

    // Calculate distance and check if open now
    garages.forEach(garage => {
      if (garage.coordinates?.coordinates) {
        const [garageLng, garageLat] = garage.coordinates.coordinates;
        const distance = calculateDistance(
          parseFloat(lat), parseFloat(lng),
          garageLat, garageLng
        );
        garage.distance = {
          value: Math.round(distance * 10) / 10,
          unit: 'km'
        };
      }

      // Check if open now
      const now = new Date();
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const today = days[now.getDay()];
      const todayHours = garage.businessHours?.[today];
      
      if (todayHours && !todayHours.closed) {
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTime = currentHour + currentMinute / 60;
        
        const [openHour, openMinute] = todayHours.open.split(':').map(Number);
        const [closeHour, closeMinute] = todayHours.close.split(':').map(Number);
        
        const openTime = openHour + openMinute / 60;
        const closeTime = closeHour + closeMinute / 60;
        
        garage.isOpenNow = currentTime >= openTime && currentTime < closeTime;
      } else {
        garage.isOpenNow = false;
      }
    });

    garages.sort((a, b) => (a.distance?.value || Infinity) - (b.distance?.value || Infinity));

    res.status(200).json({
      success: true,
      data: {
        count: garages.length,
        radius: parseFloat(radius),
        garages
      }
    });
  } catch (error) {
    console.error('Get nearby garages error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching nearby garages',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Soft delete garage
// @route   DELETE /api/garages/:id
// @access  Private (Admin or Owner)
// ==========================================
const deleteGarage = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid garage ID'
      });
    }

    const garage = await Garage.findById(id).session(session);
    if (!garage || garage.isDeleted) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Garage not found'
      });
    }

    const isOwner = garage.owner.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this garage'
      });
    }

    // Soft delete garage
    garage.isDeleted = true;
    garage.deletedAt = new Date();
    garage.deletedBy = req.user.id;
    garage.status = 'suspended';
    garage.isActive = false;
    await garage.save({ session });

    // Soft delete all services
    await Service.updateMany(
      { garage: id, isDeleted: false },
      {
        isDeleted: true,
        isAvailable: false,
        deletedAt: new Date(),
        deletedBy: req.user.id
      },
      { session }
    );

    // Cancel future bookings
    await Booking.updateMany(
      { 
        garage: id, 
        bookingDate: { $gte: new Date() },
        status: { $in: ['pending', 'approved'] },
        isDeleted: false
      },
      {
        status: 'cancelled',
        cancellationReason: 'Garage deleted',
        cancelledBy: req.user.id,
        cancelledAt: new Date()
      },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'Garage deleted successfully'
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Delete garage error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting garage',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get ALL garages with COMPLETE data (NO CONDITIONS, NO AUTH)
// @route   GET /api/garages/all/complete
// @access  Public (No restrictions)
// ==========================================

const getAllGaragesComplete = async (req, res) => {
  try {
    // NO FILTERS - Get absolutely everything
    const garages = await Garage.find({}) // Empty filter = all documents
      .populate({
        path: 'owner',
        select: 'name email phone avatar role createdAt updatedAt isActive'
      })
      .populate({
        path: 'services',
        options: { 
          sort: { createdAt: -1 } 
        },
        populate: {
          path: 'bookings',
          select: 'bookingDate timeSlot status carOwner price total isPaid',
          match: { isDeleted: false },
          options: { limit: 10 }
        }
      })
      .populate({
        path: 'reviews',
        options: { sort: { createdAt: -1 } },
        populate: [
          {
            path: 'carOwner',
            select: 'name email avatar'
          },
          {
            path: 'booking',
            select: 'service timeSlot bookingDate',
            populate: {
              path: 'service',
              select: 'name price'
            }
          },
          {
            path: 'response.respondedBy',
            select: 'name email role'
          }
        ]
      })
      .populate({
        path: 'creationPayment',
        select: 'amount transactionId status method createdAt updatedAt'
      })
      .populate({
        path: 'verifiedBy',
        select: 'name email role'
      })
      .populate({
        path: 'deletedBy',
        select: 'name email role'
      })
      .lean();

    // Get ALL related data that might not be populated through references
    const garageIds = garages.map(g => g._id);

    // Get ALL services for these garages - REMOVED the payment populate
    const allServices = await Service.find({ 
      garage: { $in: garageIds } 
    })
    .populate({
      path: 'bookings',
      select: 'bookingDate timeSlot status carOwner price total isPaid',
      match: { isDeleted: false },
      populate: {
        path: 'carOwner',
        select: 'name email phone'
      }
    })
    .lean();

    // Get ALL bookings for these garages - REMOVED the payment populate
    const allBookings = await Booking.find({ 
      garage: { $in: garageIds } 
    })
    .populate('carOwner', 'name email phone avatar')
    .populate('service', 'name price duration category')
    .populate({
      path: 'review',
      select: 'rating comment createdAt',
      populate: {
        path: 'carOwner',
        select: 'name'
      }
    })
    .lean();

    // Get ALL reviews for these garages
    const allReviews = await Review.find({ 
      garage: { $in: garageIds } 
    })
    .populate('carOwner', 'name email avatar')
    .populate({
      path: 'booking',
      select: 'service timeSlot bookingDate',
      populate: {
        path: 'service',
        select: 'name price'
      }
    })
    .populate('response.respondedBy', 'name email role')
    .lean();

    // Get ALL payments related to these garages
    const allPayments = await Payment.find({
      $or: [
        { garage: { $in: garageIds } },
        { 'garageCreation.garage': { $in: garageIds } }
      ]
    })
    .populate('user', 'name email')
    .lean();

    // Get ALL users who own these garages
    const ownerIds = [...new Set(garages.map(g => g.owner?._id?.toString()).filter(Boolean))];
    const allOwners = await User.find({
      _id: { $in: ownerIds }
    })
    .select('-password')
    .lean();

    // Calculate total revenue from bookings
    const totalRevenue = allBookings
      .filter(b => b.isPaid === true)
      .reduce((sum, b) => sum + (b.price?.total || b.total || 0), 0);

    // Compile comprehensive statistics
    const stats = {
      totalGarages: garages.length,
      totalVerified: garages.filter(g => g.isVerified).length,
      totalUnverified: garages.filter(g => !g.isVerified).length,
      totalActive: garages.filter(g => g.isActive).length,
      totalInactive: garages.filter(g => !g.isActive).length,
      totalDeleted: garages.filter(g => g.isDeleted).length,
      totalPending: garages.filter(g => g.status === 'pending').length,
      totalApproved: garages.filter(g => g.status === 'approved').length,
      totalSuspended: garages.filter(g => g.status === 'suspended').length,
      
      services: {
        total: allServices.length,
        byCategory: allServices.reduce((acc, s) => {
          acc[s.category] = (acc[s.category] || 0) + 1;
          return acc;
        }, {}),
        priceRange: {
          min: allServices.length ? Math.min(...allServices.map(s => s.price).filter(Boolean)) : 0,
          max: allServices.length ? Math.max(...allServices.map(s => s.price).filter(Boolean)) : 0,
          avg: allServices.length ? allServices.reduce((sum, s) => sum + (s.price || 0), 0) / allServices.length : 0
        }
      },
      
      bookings: {
        total: allBookings.length,
        byStatus: allBookings.reduce((acc, b) => {
          acc[b.status] = (acc[b.status] || 0) + 1;
          return acc;
        }, {}),
        totalRevenue: totalRevenue,
        upcoming: allBookings.filter(b => 
          b.bookingDate && new Date(b.bookingDate) > new Date() && 
          ['pending', 'approved'].includes(b.status)
        ).length
      },
      
      reviews: {
        total: allReviews.length,
        averageRating: allReviews.length ? allReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / allReviews.length : 0,
        byRating: allReviews.reduce((acc, r) => {
          acc[r.rating] = (acc[r.rating] || 0) + 1;
          return acc;
        }, {}),
        withResponse: allReviews.filter(r => r.response?.comment).length
      },
      
      payments: {
        total: allPayments.length,
        totalAmount: allPayments.reduce((sum, p) => sum + (p.amount || 0), 0),
        byStatus: allPayments.reduce((acc, p) => {
          acc[p.status] = (acc[p.status] || 0) + 1;
          return acc;
        }, {}),
        byMethod: allPayments.reduce((acc, p) => {
          acc[p.method] = (acc[p.method] || 0) + 1;
          return acc;
        }, {})
      },
      
      owners: {
        total: allOwners.length,
        withGarages: allOwners.filter(o => 
          garages.some(g => g.owner?._id?.toString() === o._id.toString())
        ).length
      },
      
      files: {
        totalImages: garages.reduce((sum, g) => sum + (g.images?.length || 0), 0),
        totalDocuments: garages.reduce((sum, g) => sum + (g.documents?.length || 0), 0)
      }
    };

    // Calculate price range across all garages
    const allServicePrices = allServices.map(s => s.price).filter(Boolean);
    
    // Group garages by city
    const byCity = garages.reduce((acc, g) => {
      const city = g.address?.city || 'Unknown';
      if (!acc[city]) {
        acc[city] = {
          count: 0,
          garages: []
        };
      }
      acc[city].count++;
      acc[city].garages.push({
        id: g._id,
        name: g.name,
        status: g.status
      });
      return acc;
    }, {});

    // Group by verification status with details
    const byVerificationStatus = {
      verified: garages.filter(g => g.isVerified).map(g => ({
        id: g._id,
        name: g.name,
        verifiedAt: g.verifiedAt,
        verifiedBy: g.verifiedBy
      })),
      unverified: garages.filter(g => !g.isVerified && !g.isDeleted).map(g => ({
        id: g._id,
        name: g.name,
        createdAt: g.createdAt,
        payment: g.creationPayment
      }))
    };

    // Group by deletion status
    const byDeletionStatus = {
      active: garages.filter(g => !g.isDeleted).map(g => g._id),
      deleted: garages.filter(g => g.isDeleted).map(g => ({
        id: g._id,
        name: g.name,
        deletedAt: g.deletedAt,
        deletedBy: g.deletedBy
      }))
    };

    // Group by status
    const byStatus = garages.reduce((acc, g) => {
      if (!acc[g.status]) acc[g.status] = [];
      acc[g.status].push({
        id: g._id,
        name: g.name,
        isVerified: g.isVerified,
        isActive: g.isActive
      });
      return acc;
    }, {});

    // Timeline data
    const timeline = {
      createdByMonth: garages.reduce((acc, g) => {
        if (g.createdAt) {
          const month = new Date(g.createdAt).toISOString().slice(0, 7);
          acc[month] = (acc[month] || 0) + 1;
        }
        return acc;
      }, {}),
      verifiedByMonth: garages.filter(g => g.verifiedAt).reduce((acc, g) => {
        if (g.verifiedAt) {
          const month = new Date(g.verifiedAt).toISOString().slice(0, 7);
          acc[month] = (acc[month] || 0) + 1;
        }
        return acc;
      }, {})
    };

    res.status(200).json({
      success: true,
      message: 'Complete garage data retrieved successfully',
      timestamp: new Date().toISOString(),
      data: {
        // All garages with full details
        garages: garages.map(garage => ({
          ...garage,
          // Attach all related data (counts only to avoid circular references)
          servicesCount: allServices.filter(s => s.garage?.toString() === garage._id.toString()).length,
          bookingsCount: allBookings.filter(b => b.garage?.toString() === garage._id.toString()).length,
          reviewsCount: allReviews.filter(r => r.garage?.toString() === garage._id.toString()).length,
          paymentsCount: allPayments.filter(p => 
            p.garage?.toString() === garage._id.toString() ||
            p.garageCreation?.garage?.toString() === garage._id.toString()
          ).length
        })),
        
        // Separate collections for easy access
        collections: {
          services: allServices,
          bookings: allBookings,
          reviews: allReviews,
          payments: allPayments,
          owners: allOwners
        },
        
        // Comprehensive statistics
        stats,
        
        // Groupings
        groups: {
          byCity,
          byVerificationStatus,
          byDeletionStatus,
          byStatus
        },
        
        // Price information
        pricing: {
          global: {
            min: allServicePrices.length ? Math.min(...allServicePrices) : 0,
            max: allServicePrices.length ? Math.max(...allServicePrices) : 0,
            avg: allServicePrices.length ? 
              allServicePrices.reduce((a, b) => a + b, 0) / allServicePrices.length : 0,
            median: allServicePrices.length ? 
              allServicePrices.sort((a, b) => a - b)[Math.floor(allServicePrices.length / 2)] : 0
          },
          byGarage: garages.map(g => ({
            garageId: g._id,
            garageName: g.name,
            services: allServices.filter(s => s.garage?.toString() === g._id.toString()).map(s => ({
              id: s._id,
              name: s.name,
              price: s.price,
              category: s.category,
              duration: s.duration,
              isAvailable: s.isAvailable
            }))
          }))
        },
        
        // Timeline data
        timeline,
        
        // Raw counts
        counts: {
          garages: garages.length,
          services: allServices.length,
          bookings: allBookings.length,
          reviews: allReviews.length,
          payments: allPayments.length,
          owners: allOwners.length
        },
        
        // Metadata
        metadata: {
          generatedAt: new Date().toISOString(),
          totalRecords: {
            garages: garages.length,
            services: allServices.length,
            bookings: allBookings.length,
            reviews: allReviews.length,
            payments: allPayments.length,
            owners: allOwners.length
          },
          databaseStats: {
            garagesWithCoordinates: garages.filter(g => g.coordinates?.coordinates?.length).length,
            garagesWithImages: garages.filter(g => g.images?.length > 0).length,
            garagesWithDocuments: garages.filter(g => g.documents?.length > 0).length,
            garagesWithBusinessHours: garages.filter(g => g.businessHours).length,
            garagesWithServices: garages.filter(g => 
              allServices.some(s => s.garage?.toString() === g._id.toString())
            ).length,
            garagesWithReviews: garages.filter(g => 
              allReviews.some(r => r.garage?.toString() === g._id.toString())
            ).length,
            garagesWithBookings: garages.filter(g => 
              allBookings.some(b => b.garage?.toString() === g._id.toString())
            ).length
          }
        }
      }
    });

  } catch (error) {
    console.error('Get complete garages error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching complete garage data',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};


// ==========================================
// @desc    Restore deleted garage
// @route   PUT /api/garages/:id/restore
// @access  Private/Admin
// ==========================================
const restoreGarage = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid garage ID'
      });
    }

    const garage = await Garage.findOne({ 
      _id: id, 
      isDeleted: true 
    }).session(session);

    if (!garage) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Deleted garage not found'
      });
    }

    // Restore garage
    garage.isDeleted = false;
    garage.deletedAt = undefined;
    garage.deletedBy = undefined;
    garage.status = 'pending';
    garage.isActive = false;
    garage.isVerified = false; // Reset verification status
    await garage.save({ session });

    await session.commitTransaction();
    session.endSession();

    const restoredGarage = await Garage.findById(id)
      .populate('owner', 'name email phone avatar');

    res.status(200).json({
      success: true,
      message: 'Garage restored successfully',
      data: { garage: restoredGarage }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Restore garage error:', error);
    res.status(500).json({
      success: false,
      message: 'Error restoring garage',
      error: error.message
    });
  }
};

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
  createGarage,
  getAllGarages,
  getDeletedGarages,
  getUnverifiedGarages,
  getGarageById,
  updateGarage,
  verifyGarage,
  toggleActive,
  uploadFiles,
  deleteFile,
  getGarageServices,
  getGarageServiceBookings,
  getGarageReviews,
  getGarageBookings,
  getGarageAnalytics,
  getNearbyGarages,
  deleteGarage,
  getAllGaragesComplete,
  restoreGarage
};