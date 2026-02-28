// ==========================================
// controllers/service.controller.js
// ==========================================

const Service = require('../models/Service');
const Garage = require('../models/garage');
const Booking = require('../models/booking');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs').promises;

// ==========================================
// @desc    Create a new service
// @route   POST /api/services
// @access  Private (Garage Owner or Admin)
// ==========================================
const createService = async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      duration,
      category,
      garageId,
      images,
      documents,
      isAvailable
    } = req.body;

    // Validate required fields
    if (!name || !price || !garageId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, price, garageId'
      });
    }

    // Validate garage exists
    const garage = await Garage.findOne({ 
      _id: garageId, 
      isDeleted: false 
    });

    if (!garage) {
      return res.status(404).json({
        success: false,
        message: 'Garage not found'
      });
    }

    // Check authorization
    const isOwner = garage.owner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to add services to this garage'
      });
    }

    // Check for duplicate service name
    const existingService = await Service.findOne({
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      garage: garageId,
      isDeleted: false
    });

    if (existingService) {
      return res.status(400).json({
        success: false,
        message: 'Service with this name already exists in your garage'
      });
    }

    // Create service
    const service = await Service.create({
      name,
      description: description || '',
      price,
      duration: duration || 60,
      category: category || 'maintenance',
      garage: garageId,
      images: images || [],
      documents: documents || [],
      isAvailable: isAvailable !== undefined ? isAvailable : true
    });

    // Add service to garage's services array
    garage.services.push(service._id);
    await garage.save();

    // Populate response
    const populatedService = await Service.findById(service._id)
      .populate('garage', 'name address contactInfo');

    res.status(201).json({
      success: true,
      message: 'Service created successfully',
      data: { service: populatedService }
    });

  } catch (error) {
    console.error('Create service error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating service',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get all services (with filters)
// @route   GET /api/services
// @access  Public
// ==========================================
const getAllServices = async (req, res) => {
  try {
    const {
      garageId,
      category,
      minPrice,
      maxPrice,
      minDuration,
      maxDuration,
      isAvailable,
      search,
      page = 1,
      limit = 20,
      sortBy = 'name',
      sortOrder = 'asc'
    } = req.query;

    const filter = { isDeleted: false };
    const andConditions = [];

    if (garageId) {
      filter.garage = garageId;
      
      // Check garage visibility
      if (!req.user || req.user.role !== 'admin') {
        const garage = await Garage.findOne({ 
          _id: garageId, 
          isDeleted: false,
          status: 'active',
          isActive: true
        });
        
        if (!garage) {
          return res.status(404).json({
            success: false,
            message: 'Garage not found or not active'
          });
        }
      }
    }

    if (category) filter.category = category;

    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = parseFloat(minPrice);
      if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
    }

    if (minDuration || maxDuration) {
      filter.duration = {};
      if (minDuration) filter.duration.$gte = parseInt(minDuration);
      if (maxDuration) filter.duration.$lte = parseInt(maxDuration);
    }

    if (isAvailable !== undefined) {
      filter.isAvailable = isAvailable === 'true';
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const services = await Service.find(filter)
      .populate({
        path: 'garage',
        select: 'name address contactInfo stats isVerified status isActive',
        match: { isDeleted: false }
      })
      .populate({
        path: 'bookings',
        select: 'bookingDate status',
        match: { 
          bookingDate: { $gte: new Date() },
          status: { $in: ['pending', 'approved'] }
        },
        options: { limit: 5 }
      })
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean();

    const validServices = services.filter(s => s.garage !== null);
    const total = await Service.countDocuments(filter);

    const categoryStats = await Service.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          avgPrice: { $avg: '$price' },
          minPrice: { $min: '$price' },
          maxPrice: { $max: '$price' }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        services: validServices,
        categoryStats,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Get all services error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching services',
      error: error.message
    });
  }
};

// ==========================================
// Helper function to generate time slots
// ==========================================
const generateTimeSlots = (open, close, duration) => {
  const slots = [];
  const [openHour, openMinute] = open.split(':').map(Number);
  const [closeHour, closeMinute] = close.split(':').map(Number);
  
  let currentTime = openHour * 60 + openMinute;
  const endTime = closeHour * 60 + closeMinute;
  
  while (currentTime + duration <= endTime) {
    const hours = Math.floor(currentTime / 60);
    const minutes = currentTime % 60;
    const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    slots.push(timeStr);
    currentTime += duration;
  }
  
  return slots;
};

// ==========================================
// @desc    Get single service by ID
// @route   GET /api/services/:id
// @access  Public
// ==========================================
const getServiceById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid service ID'
      });
    }

    const service = await Service.findOne({ 
      _id: id, 
      isDeleted: false 
    })
      .populate({
        path: 'garage',
        select: 'name description address contactInfo businessHours stats isVerified status isActive owner',
        populate: {
          path: 'owner',
          select: 'name email phone'
        }
      })
      .populate({
        path: 'bookings',
        select: 'bookingDate timeSlot status',
        match: { 
          bookingDate: { $gte: new Date() },
          status: { $in: ['pending', 'approved'] }
        },
        options: { 
          sort: { bookingDate: 1 },
          limit: 10
        }
      });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Check visibility
    let isOwner = false;
    if (req.user && req.user.id && service.garage && service.garage.owner) {
      isOwner = service.garage.owner._id.toString() === req.user.id.toString();
    }

    if (!isOwner && (!req.user || req.user.role !== 'admin')) {
      if (!service.garage || service.garage.status !== 'active' || !service.garage.isActive) {
        return res.status(404).json({
          success: false,
          message: 'Service not available'
        });
      }
    }

    // Get similar services
    const similarServices = await Service.find({
      garage: service.garage._id,
      _id: { $ne: service._id },
      category: service.category,
      isDeleted: false,
      isAvailable: true
    })
      .select('name price duration category')
      .limit(4);

    // Get upcoming availability
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const upcomingBookings = await Booking.find({
      service: service._id,
      bookingDate: { $gte: today, $lte: nextWeek },
      status: { $nin: ['cancelled', 'rejected'] },
      isDeleted: false
    }).select('bookingDate timeSlot');

    // Generate availability calendar
    const availability = {};
    const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      const dayName = daysOfWeek[date.getDay()];
      
      const businessHours = service.garage.businessHours[dayName];
      
      if (businessHours && !businessHours.closed) {
        const slots = generateTimeSlots(
          businessHours.open,
          businessHours.close,
          service.duration
        );
        
        const bookedSlots = upcomingBookings
          .filter(b => b.bookingDate.toISOString().split('T')[0] === dateStr)
          .map(b => b.timeSlot.start);
        
        availability[dateStr] = {
          day: dayName,
          businessHours: `${businessHours.open} - ${businessHours.close}`,
          slots: slots.map(slot => ({
            time: slot,
            available: !bookedSlots.includes(slot)
          }))
        };
      } else {
        availability[dateStr] = {
          day: dayName,
          businessHours: 'Closed',
          slots: []
        };
      }
    }

    res.status(200).json({
      success: true,
      data: {
        service,
        similarServices,
        availability,
        stats: {
          totalBookings: service.bookings?.length || 0,
          upcomingBookings: upcomingBookings.length
        }
      }
    });
  } catch (error) {
    console.error('Get service by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching service',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Update service
// @route   PUT /api/services/:id
// @access  Private (Garage Owner or Admin)
// ==========================================
const updateService = async (req, res) => {
  let session;
  
  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const { id } = req.params;
    const updates = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid service ID'
      });
    }

    const service = await Service.findById(id)
      .populate({
        path: 'garage',
        select: 'owner'
      })
      .session(session);

    if (!service || service.isDeleted) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Check authorization
    const isOwner = service.garage.owner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this service'
      });
    }

    // Check for duplicate name
    if (updates.name && updates.name.toLowerCase() !== service.name.toLowerCase()) {
      const existingService = await Service.findOne({
        name: { $regex: new RegExp(`^${updates.name}$`, 'i') },
        garage: service.garage._id,
        _id: { $ne: id },
        isDeleted: false
      }).session(session);

      if (existingService) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: 'Service with this name already exists in your garage'
        });
      }
    }

    // Remove protected fields
    delete updates._id;
    delete updates.garage;
    delete updates.__v;
    delete updates.createdAt;

    Object.assign(service, updates);
    await service.save({ session });

    await session.commitTransaction();
    session.endSession();

    const updatedService = await Service.findById(id)
      .populate('garage', 'name address contactInfo');

    res.status(200).json({
      success: true,
      message: 'Service updated successfully',
      data: { service: updatedService }
    });

  } catch (error) {
    if (session) {
      try { await session.abortTransaction(); } catch (e) {}
      try { session.endSession(); } catch (e) {}
    }
    console.error('Update service error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating service',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Toggle service availability
// @route   PUT /api/services/:id/toggle-availability
// @access  Private (Garage Owner or Admin)
// ==========================================
const toggleAvailability = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid service ID'
      });
    }

    const service = await Service.findById(id).populate('garage');
    if (!service || service.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Check authorization
    const isOwner = service.garage.owner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this service'
      });
    }

    service.isAvailable = !service.isAvailable;
    await service.save();

    res.status(200).json({
      success: true,
      message: `Service ${service.isAvailable ? 'enabled' : 'disabled'} successfully`,
      data: { isAvailable: service.isAvailable }
    });
  } catch (error) {
    console.error('Toggle availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Error toggling service availability',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Upload service images/documents
// @route   POST /api/services/:id/uploads
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
        message: 'Invalid service ID'
      });
    }

    const service = await Service.findById(id).populate('garage');
    if (!service || service.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Check authorization
    const isOwner = service.garage.owner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to upload files'
      });
    }

    const filePaths = files.map(file => file.path.replace(/\\/g, '/'));

    if (type === 'images') {
      service.images = [...service.images, ...filePaths];
    } else if (type === 'documents') {
      service.documents = [...service.documents, ...filePaths];
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Use "images" or "documents"'
      });
    }

    await service.save();

    res.status(200).json({
      success: true,
      message: 'Files uploaded successfully',
      data: { [type]: type === 'images' ? service.images : service.documents }
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
// @route   DELETE /api/services/:id/files/:filename
// @access  Private (Garage Owner or Admin)
// ==========================================
const deleteFile = async (req, res) => {
  try {
    const { id, filename } = req.params;
    const { type } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid service ID'
      });
    }

    const service = await Service.findById(id).populate('garage');
    if (!service || service.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Check authorization
    const isOwner = service.garage.owner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete files'
      });
    }

    const fileArray = type === 'images' ? service.images : service.documents;
    const filePath = fileArray.find(f => f.includes(filename));

    if (!filePath) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    if (type === 'images') {
      service.images = service.images.filter(f => !f.includes(filename));
    } else {
      service.documents = service.documents.filter(f => !f.includes(filename));
    }
    await service.save();

    try {
      await fs.unlink(path.join(__dirname, '..', filePath));
    } catch (fileError) {
      console.error('Error deleting file:', fileError);
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
// @desc    Get service bookings
// @route   GET /api/services/:id/bookings
// @access  Private (Garage Owner or Admin)
// ==========================================
const getServiceBookings = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status,
      startDate,
      endDate,
      page = 1,
      limit = 20
    } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid service ID'
      });
    }

    const service = await Service.findById(id).populate('garage');
    if (!service || service.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Check authorization
    const isOwner = service.garage.owner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view these bookings'
      });
    }

    const filter = { service: id, isDeleted: false };

    if (status) filter.status = status;
    if (startDate || endDate) {
      filter.bookingDate = {};
      if (startDate) filter.bookingDate.$gte = new Date(startDate);
      if (endDate) filter.bookingDate.$lte = new Date(endDate);
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const bookings = await Booking.find(filter)
      .populate('carOwner', 'name email phone avatar')
      .populate('garage', 'name')
      .populate('payment', 'amount status')
      .sort({ bookingDate: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Booking.countDocuments(filter);

    const stats = await Booking.aggregate([
      { $match: { service: new mongoose.Types.ObjectId(id), isDeleted: false } },
      {
        $group: {
          _id: null,
          totalBookings: { $sum: 1 },
          completedBookings: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          cancelledBookings: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          totalRevenue: { $sum: { $cond: [{ $eq: ['$isPaid', true] }, '$price.total', 0] } }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        bookings,
        stats: stats[0] || {
          totalBookings: 0,
          completedBookings: 0,
          cancelledBookings: 0,
          totalRevenue: 0
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
    console.error('Get service bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching service bookings',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get service analytics
// @route   GET /api/services/:id/analytics
// @access  Private (Garage Owner or Admin)
// ==========================================
const getServiceAnalytics = async (req, res) => {
  try {
    const { id } = req.params;
    const { period = 'month' } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid service ID'
      });
    }

    const service = await Service.findById(id).populate('garage');
    if (!service || service.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Check authorization
    const isOwner = service.garage.owner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view analytics'
      });
    }

    const endDate = new Date();
    let startDate = new Date();
    
    switch (period) {
      case 'week': startDate.setDate(startDate.getDate() - 7); break;
      case 'month': startDate.setMonth(startDate.getMonth() - 1); break;
      case 'quarter': startDate.setMonth(startDate.getMonth() - 3); break;
      case 'year': startDate.setFullYear(startDate.getFullYear() - 1); break;
      default: startDate.setMonth(startDate.getMonth() - 1);
    }

    const analytics = await Booking.aggregate([
      {
        $match: {
          service: new mongoose.Types.ObjectId(id),
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
                  day: { $dayOfMonth: '$bookingDate' }
                },
                total: { $sum: { $cond: [{ $eq: ['$isPaid', true] }, '$price.total', 0] } },
                count: { $sum: 1 }
              }
            },
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
          ],
          byStatus: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
                revenue: { $sum: { $cond: [{ $eq: ['$isPaid', true] }, '$price.total', 0] } }
              }
            }
          ],
          popularTimes: [
            { $group: { _id: '$timeSlot.start', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 }
          ]
        }
      }
    ]);

    // Previous period comparison
    const previousStartDate = new Date(startDate);
    const previousEndDate = new Date(endDate);
    const periodLength = endDate - startDate;
    previousStartDate.setTime(previousStartDate.getTime() - periodLength);
    previousEndDate.setTime(previousEndDate.getTime() - periodLength);

    const previousPeriodStats = await Booking.aggregate([
      {
        $match: {
          service: new mongoose.Types.ObjectId(id),
          bookingDate: { $gte: previousStartDate, $lte: previousEndDate },
          isDeleted: false
        }
      },
      {
        $group: {
          _id: null,
          totalBookings: { $sum: 1 },
          totalRevenue: { $sum: { $cond: [{ $eq: ['$isPaid', true] }, '$price.total', 0] } }
        }
      }
    ]);

    const currentRevenue = analytics[0]?.revenue?.reduce((acc, d) => acc + d.total, 0) || 0;
    const currentBookings = analytics[0]?.revenue?.length || 0;

    res.status(200).json({
      success: true,
      data: {
        service: {
          id: service._id,
          name: service.name,
          category: service.category,
          price: service.price
        },
        period,
        dateRange: { startDate, endDate },
        analytics: analytics[0],
        comparison: {
          previousPeriod: previousPeriodStats[0] || { totalBookings: 0, totalRevenue: 0 },
          growth: {
            bookings: previousPeriodStats[0]?.totalBookings 
              ? ((currentBookings - previousPeriodStats[0].totalBookings) / previousPeriodStats[0].totalBookings) * 100 
              : 0,
            revenue: previousPeriodStats[0]?.totalRevenue 
              ? ((currentRevenue - previousPeriodStats[0].totalRevenue) / previousPeriodStats[0].totalRevenue) * 100 
              : 0
          }
        }
      }
    });
  } catch (error) {
    console.error('Get service analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching service analytics',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Bulk create services
// @route   POST /api/services/bulk
// @access  Private (Garage Owner or Admin)
// ==========================================
const bulkCreateServices = async (req, res) => {
  let session;
  
  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const { garageId, services } = req.body;

    if (!services || !Array.isArray(services) || services.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Services array is required'
      });
    }

    const garage = await Garage.findOne({ 
      _id: garageId, 
      isDeleted: false 
    }).session(session);

    if (!garage) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Garage not found'
      });
    }

    // Check authorization
    const isOwner = garage.owner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to add services to this garage'
      });
    }

    const servicesToCreate = services.map(s => ({
      ...s,
      garage: garageId,
      images: s.images || [],
      documents: s.documents || [],
      isAvailable: s.isAvailable !== undefined ? s.isAvailable : true
    }));

    // Check for duplicates
    const serviceNames = servicesToCreate.map(s => s.name.toLowerCase());
    const uniqueNames = new Set(serviceNames);
    if (uniqueNames.size !== serviceNames.length) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Duplicate service names in the batch'
      });
    }

    const createdServices = await Service.insertMany(servicesToCreate, { session });

    garage.services.push(...createdServices.map(s => s._id));
    await garage.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      message: `${createdServices.length} services created successfully`,
      data: { count: createdServices.length, services: createdServices }
    });
  } catch (error) {
    if (session) {
      try { await session.abortTransaction(); } catch (e) {}
      try { session.endSession(); } catch (e) {}
    }
    console.error('Bulk create services error:', error);
    res.status(500).json({
      success: false,
      message: 'Error bulk creating services',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Soft delete service
// @route   DELETE /api/services/:id
// @access  Private (Garage Owner or Admin)
// ==========================================
const deleteService = async (req, res) => {
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
        message: 'Invalid service ID'
      });
    }

    const service = await Service.findById(id)
      .populate('garage')
      .session(session);

    if (!service || service.isDeleted) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Check authorization
    const isOwner = service.garage.owner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this service'
      });
    }

    // Check for upcoming bookings
    const upcomingBookings = await Booking.findOne({
      service: id,
      bookingDate: { $gte: new Date() },
      status: { $in: ['pending', 'approved'] },
      isDeleted: false
    }).session(session);

    if (upcomingBookings) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Cannot delete service with upcoming bookings'
      });
    }

    service.isDeleted = true;
    service.isAvailable = false;
    await service.save({ session });

    const garage = await Garage.findById(service.garage._id).session(session);
    garage.services = garage.services.filter(s => s.toString() !== id);
    await garage.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'Service deleted successfully'
    });
  } catch (error) {
    if (session) {
      try { await session.abortTransaction(); } catch (e) {}
      try { session.endSession(); } catch (e) {}
    }
    console.error('Delete service error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting service',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Restore deleted service
// @route   PUT /api/services/:id/restore
// @access  Private/Admin
// ==========================================
const restoreService = async (req, res) => {
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
        message: 'Invalid service ID'
      });
    }

    const service = await Service.findOne({ 
      _id: id, 
      isDeleted: true 
    }).session(session);

    if (!service) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Deleted service not found'
      });
    }

    service.isDeleted = false;
    await service.save({ session });

    const garage = await Garage.findById(service.garage).session(session);
    if (garage && !garage.services.includes(service._id)) {
      garage.services.push(service._id);
      await garage.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'Service restored successfully',
      data: { service }
    });
  } catch (error) {
    if (session) {
      try { await session.abortTransaction(); } catch (e) {}
      try { session.endSession(); } catch (e) {}
    }
    console.error('Restore service error:', error);
    res.status(500).json({
      success: false,
      message: 'Error restoring service',
      error: error.message
    });
  }
};



// ==========================================
// @desc    Hard delete service (permanent)
// @route   DELETE /api/services/:id/hard
// @access  Private (Garage Owner or Admin)
// ==========================================
const hardDeleteService = async (req, res) => {
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
        message: 'Invalid service ID'
      });
    }

    const service = await Service.findById(id)
      .populate({
        path: 'garage',
        select: 'owner'
      })
      .session(session);

    if (!service) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Check authorization - both garage owner and admin can hard delete
    const isOwner = service.garage.owner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this service'
      });
    }

    // Check for upcoming bookings before hard delete
    const upcomingBookings = await Booking.findOne({
      service: id,
      bookingDate: { $gte: new Date() },
      status: { $in: ['pending', 'approved'] },
      isDeleted: false
    }).session(session);

    if (upcomingBookings) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Cannot delete service with upcoming bookings'
      });
    }

    // Delete associated files if any
    for (const imagePath of service.images) {
      try {
        await fs.unlink(path.join(__dirname, '..', imagePath));
      } catch (fileError) {
        console.error('Error deleting image file:', fileError);
      }
    }

    for (const docPath of service.documents) {
      try {
        await fs.unlink(path.join(__dirname, '..', docPath));
      } catch (fileError) {
        console.error('Error deleting document file:', fileError);
      }
    }

    // Remove from garage's services array
    await Garage.updateOne(
      { _id: service.garage._id },
      { $pull: { services: id } },
      { session }
    );

    // Hard delete the service
    await Service.findByIdAndDelete(id, { session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'Service permanently deleted'
    });
  } catch (error) {
    if (session) {
      try { await session.abortTransaction(); } catch (e) {}
      try { session.endSession(); } catch (e) {}
    }
    console.error('Hard delete service error:', error);
    res.status(500).json({
      success: false,
      message: 'Error hard deleting service',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get service categories
// @route   GET /api/services/categories/list
// @access  Public
// ==========================================
const getCategories = async (req, res) => {
  try {
    const categories = [
      { id: 'maintenance', name: 'Maintenance', icon: '🔧', description: 'Regular vehicle maintenance services' },
      { id: 'repair', name: 'Repair', icon: '🔨', description: 'Vehicle repair services' },
      { id: 'inspection', name: 'Inspection', icon: '🔍', description: 'Vehicle inspection and diagnostics' },
      { id: 'customization', name: 'Customization', icon: '🎨', description: 'Vehicle customization and modification' },
      { id: 'other', name: 'Other', icon: '🛠️', description: 'Other automotive services' }
    ];

    res.status(200).json({
      success: true,
      data: { categories }
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching categories',
      error: error.message
    });
  }
};

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
  createService,
  getAllServices,
  getServiceById,
  updateService,
  hardDeleteService,
  toggleAvailability,
  uploadFiles,
  deleteFile,
  getServiceBookings,
  getServiceAnalytics,
  bulkCreateServices,
  deleteService,
  restoreService,
  getCategories
};