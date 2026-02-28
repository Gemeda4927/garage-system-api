// ==========================================
// controllers/review.controller.js
// ==========================================

const Review = require('../models/Review');
const Booking = require('../models/Booking');
const Garage = require('../models/garage');
const User = require('../models/User');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs').promises;

// ==========================================
// @desc    Get all reviews (with filters)
// @route   GET /api/reviews
// @access  Public
// ==========================================
const getReviews = async (req, res) => {
  try {
    const {
      garageId,
      carOwnerId,
      bookingId,
      minRating,
      maxRating,
      hasResponse,
      isVerified,
      startDate,
      endDate,
      includeDeleted,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filter = {};

    // Only show non-deleted reviews to public
    if (!req.user || req.user.role !== 'admin') {
      filter.isDeleted = false;
    } else if (includeDeleted === 'true') {
      // Admin can see deleted reviews
    } else {
      filter.isDeleted = false;
    }

    // Apply filters
    if (garageId) {
      filter.garage = garageId;
      
      if (!req.user || req.user.role !== 'admin') {
        const garage = await Garage.findOne({ 
          _id: garageId, 
          isDeleted: false,
          status: 'active'
        });
        
        if (!garage) {
          return res.status(404).json({
            success: false,
            message: 'Garage not found or not active'
          });
        }
      }
    }

    if (carOwnerId) {
      filter.carOwner = carOwnerId;
      
      if (req.user && req.user.role !== 'admin' && req.user.id !== carOwnerId) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to view reviews from this user'
        });
      }
    }

    if (bookingId) filter.booking = bookingId;

    if (minRating || maxRating) {
      filter.rating = {};
      if (minRating) filter.rating.$gte = parseInt(minRating);
      if (maxRating) filter.rating.$lte = parseInt(maxRating);
    }

    if (hasResponse !== undefined) {
      filter['response.comment'] = hasResponse === 'true' ? { $exists: true } : { $exists: false };
    }

    if (isVerified !== undefined) filter.isVerified = isVerified === 'true';

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const reviews = await Review.find(filter)
      .populate({
        path: 'carOwner',
        select: 'name email avatar',
        match: { isDeleted: false }
      })
      .populate({
        path: 'garage',
        select: 'name address contactInfo stats',
        match: { isDeleted: false }
      })
      .populate({
        path: 'booking',
        select: 'bookingDate timeSlot service vehicleInfo',
        populate: {
          path: 'service',
          select: 'name category price'
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

    const validReviews = reviews.filter(r => r.carOwner && r.garage);
    const total = await Review.countDocuments(filter);

    const ratingStats = await Review.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
          ratingCounts: { $push: { rating: '$rating', count: 1 } }
        }
      },
      {
        $project: {
          averageRating: { $round: ['$averageRating', 1] },
          totalReviews: 1,
          ratingDistribution: {
            $arrayToObject: {
              $map: {
                input: [1, 2, 3, 4, 5],
                as: 'r',
                in: {
                  k: { $toString: '$$r' },
                  v: {
                    $size: {
                      $filter: {
                        input: '$ratingCounts',
                        cond: { $eq: ['$$this.rating', '$$r'] }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        reviews: validReviews,
        stats: ratingStats[0] || {
          averageRating: 0,
          totalReviews: 0,
          ratingDistribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }
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
    console.error('Get reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching reviews',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get single review by ID
// @route   GET /api/reviews/:id
// @access  Public
// ==========================================
const getReview = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid review ID'
      });
    }

    const review = await Review.findOne({ 
      _id: id, 
      isDeleted: false 
    })
      .populate('carOwner', 'name email avatar')
      .populate({
        path: 'garage',
        select: 'name address contactInfo stats status isActive isVerified',
        populate: {
          path: 'owner',
          select: 'name email'
        }
      })
      .populate({
        path: 'booking',
        select: 'bookingDate timeSlot service vehicleInfo',
        populate: {
          path: 'service',
          select: 'name price'
        }
      })
      .populate('response.respondedBy', 'name email');

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    // Visibility check
    let isVisible = false;

    if (req.user && req.user.role === 'admin') {
      isVisible = true;
    } else if (req.user && review.carOwner && review.carOwner._id.toString() === req.user.id) {
      isVisible = true;
    } else if (req.user && req.user.role === 'garage_owner' && review.garage) {
      const garage = await Garage.findById(review.garage._id);
      if (garage && garage.owner.toString() === req.user.id) {
        isVisible = true;
      }
    } else if (!req.user || req.user.role === 'car_owner') {
      if (review.isVerified === true) {
        isVisible = true;
      }
    }

    if (!isVisible) {
      return res.status(404).json({
        success: false,
        message: 'Review not available'
      });
    }

    res.status(200).json({
      success: true,
      data: { review }
    });
  } catch (error) {
    console.error('Get review error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching review',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Create a new review
// @route   POST /api/reviews
// @access  Private (Car Owner only)
// ==========================================
const createReview = async (req, res) => {
  let session;
  
  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const {
      garageId,
      bookingId,
      rating,
      title,
      comment,
      images
    } = req.body;

    if (!garageId || !bookingId || !rating || !title || !comment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    const booking = await Booking.findOne({
      _id: bookingId,
      carOwner: req.user.id,
      isDeleted: false
    }).session(session);

    if (!booking) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Booking not found or not authorized'
      });
    }

    if (!['completed', 'approved'].includes(booking.status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Can only review completed or approved bookings'
      });
    }

    const existingReview = await Review.findOne({
      booking: bookingId,
      isDeleted: false
    }).session(session);

    if (existingReview) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Review already exists for this booking'
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

    const review = await Review.create([{
      carOwner: req.user.id,
      garage: garageId,
      booking: bookingId,
      rating,
      title,
      comment,
      images: images || [],
      isVerified: true
    }], { session });

    await session.commitTransaction();
    session.endSession();

    const populatedReview = await Review.findById(review[0]._id)
      .populate('carOwner', 'name email avatar')
      .populate('garage', 'name address')
      .populate('booking', 'bookingDate timeSlot service');

    res.status(201).json({
      success: true,
      message: 'Review created successfully',
      data: { review: populatedReview }
    });

  } catch (error) {
    if (session) {
      try { await session.abortTransaction(); } catch (e) {}
      try { session.endSession(); } catch (e) {}
    }
    console.error('Create review error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating review',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Update review
// @route   PUT /api/reviews/:id
// @access  Private (Car Owner or Admin)
// ==========================================
const updateReview = async (req, res) => {
  let session;
  
  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const { id } = req.params;
    const updates = req.body;

    delete updates.carOwner;
    delete updates.garage;
    delete updates.booking;
    delete updates.isVerified;
    delete updates.response;

    const review = await Review.findById(id).session(session);

    if (!review || review.isDeleted) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    const isOwner = review.carOwner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this review'
      });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    if (review.createdAt < thirtyDaysAgo && !isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Reviews can only be edited within 30 days of creation'
      });
    }

    Object.assign(review, updates);
    await review.save({ session });

    await session.commitTransaction();
    session.endSession();

    const updatedReview = await Review.findById(id)
      .populate('carOwner', 'name email avatar')
      .populate('garage', 'name address')
      .populate('booking', 'bookingDate timeSlot service')
      .populate('response.respondedBy', 'name email');

    res.status(200).json({
      success: true,
      message: 'Review updated successfully',
      data: { review: updatedReview }
    });

  } catch (error) {
    if (session) {
      try { await session.abortTransaction(); } catch (e) {}
      try { session.endSession(); } catch (e) {}
    }
    console.error('Update review error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating review',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Add response to review (Garage Owner)
// @route   POST /api/reviews/:id/response
// @access  Private (Garage Owner or Admin)
// ==========================================
const addResponse = async (req, res) => {
  let session;
  
  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const { id } = req.params;
    const { comment } = req.body;

    if (!comment || comment.trim().length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Response comment is required'
      });
    }

    const review = await Review.findById(id)
      .populate('garage')
      .session(session);

    if (!review || review.isDeleted) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    const isGarageOwner = review.garage.owner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isGarageOwner && !isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to respond to this review'
      });
    }

    if (review.response && review.response.comment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'A response already exists for this review'
      });
    }

    review.response = {
      comment,
      respondedAt: new Date(),
      respondedBy: req.user.id
    };

    await review.save({ session });
    await session.commitTransaction();
    session.endSession();

    const updatedReview = await Review.findById(id)
      .populate('carOwner', 'name email avatar')
      .populate('garage', 'name address')
      .populate('booking', 'bookingDate timeSlot service')
      .populate('response.respondedBy', 'name email role');

    res.status(200).json({
      success: true,
      message: 'Response added successfully',
      data: { review: updatedReview }
    });

  } catch (error) {
    if (session) {
      try { await session.abortTransaction(); } catch (e) {}
      try { session.endSession(); } catch (e) {}
    }
    console.error('Add response error:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding response',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Update response
// @route   PUT /api/reviews/:id/response
// @access  Private (Garage Owner or Admin)
// ==========================================
const updateResponse = async (req, res) => {
  let session;
  
  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const { id } = req.params;
    const { comment } = req.body;

    if (!comment || comment.trim().length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Response comment is required'
      });
    }

    const review = await Review.findById(id)
      .populate('garage')
      .session(session);

    if (!review || review.isDeleted) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    const isGarageOwner = review.garage.owner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isGarageOwner && !isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this response'
      });
    }

    if (!review.response || !review.response.comment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'No response exists for this review'
      });
    }

    review.response.comment = comment;
    review.response.respondedAt = new Date();
    review.response.respondedBy = req.user.id;

    await review.save({ session });
    await session.commitTransaction();
    session.endSession();

    const updatedReview = await Review.findById(id)
      .populate('carOwner', 'name email avatar')
      .populate('garage', 'name address')
      .populate('booking', 'bookingDate timeSlot service')
      .populate('response.respondedBy', 'name email role');

    res.status(200).json({
      success: true,
      message: 'Response updated successfully',
      data: { review: updatedReview }
    });

  } catch (error) {
    if (session) {
      try { await session.abortTransaction(); } catch (e) {}
      try { session.endSession(); } catch (e) {}
    }
    console.error('Update response error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating response',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Delete response
// @route   DELETE /api/reviews/:id/response
// @access  Private (Garage Owner or Admin)
// ==========================================
const deleteResponse = async (req, res) => {
  let session;
  
  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const { id } = req.params;

    const review = await Review.findById(id)
      .populate('garage')
      .session(session);

    if (!review || review.isDeleted) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    const isGarageOwner = review.garage.owner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isGarageOwner && !isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this response'
      });
    }

    review.response = undefined;
    await review.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'Response deleted successfully'
    });

  } catch (error) {
    if (session) {
      try { await session.abortTransaction(); } catch (e) {}
      try { session.endSession(); } catch (e) {}
    }
    console.error('Delete response error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting response',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Upload review images
// @route   POST /api/reviews/:id/images
// @access  Private (Car Owner or Admin)
// ==========================================
const uploadImages = async (req, res) => {
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
        message: 'Invalid review ID'
      });
    }

    const review = await Review.findById(id);

    if (!review || review.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    const isOwner = review.carOwner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to upload images to this review'
      });
    }

    const filePaths = files.map(file => file.path.replace(/\\/g, '/'));
    review.images = [...review.images, ...filePaths];
    await review.save();

    res.status(200).json({
      success: true,
      message: 'Images uploaded successfully',
      data: { images: review.images }
    });
  } catch (error) {
    console.error('Upload images error:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading images',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Delete review image
// @route   DELETE /api/reviews/:id/images/:filename
// @access  Private (Car Owner or Admin)
// ==========================================
const deleteImage = async (req, res) => {
  try {
    const { id, filename } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid review ID'
      });
    }

    const review = await Review.findById(id);

    if (!review || review.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    const isOwner = review.carOwner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete images from this review'
      });
    }

    const imagePath = review.images.find(img => img.includes(filename));

    if (!imagePath) {
      return res.status(404).json({
        success: false,
        message: 'Image not found'
      });
    }

    review.images = review.images.filter(img => !img.includes(filename));
    await review.save();

    try {
      await fs.unlink(path.join(__dirname, '..', imagePath));
    } catch (fileError) {
      console.error('Error deleting file:', fileError);
    }

    res.status(200).json({
      success: true,
      message: 'Image deleted successfully',
      data: { images: review.images }
    });
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting image',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Mark review as helpful
// @route   POST /api/reviews/:id/helpful
// @access  Private
// ==========================================
const markHelpful = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid review ID'
      });
    }

    const review = await Review.findById(id);

    if (!review || review.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    if (!review.helpfulVotes) {
      review.helpfulVotes = { count: 0, users: [] };
    }

    const hasVoted = review.helpfulVotes.users.includes(req.user.id);

    if (hasVoted) {
      review.helpfulVotes.users = review.helpfulVotes.users.filter(
        userId => userId.toString() !== req.user.id
      );
      review.helpfulVotes.count = review.helpfulVotes.users.length;
      await review.save();
      
      return res.status(200).json({
        success: true,
        message: 'Vote removed',
        data: { helpfulCount: review.helpfulVotes.count, userVoted: false }
      });
    } else {
      review.helpfulVotes.users.push(req.user.id);
      review.helpfulVotes.count = review.helpfulVotes.users.length;
      await review.save();
      
      res.status(200).json({
        success: true,
        message: 'Marked as helpful',
        data: { helpfulCount: review.helpfulVotes.count, userVoted: true }
      });
    }
  } catch (error) {
    console.error('Mark helpful error:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking review as helpful',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Get garage review summary
// @route   GET /api/reviews/garage/:garageId/summary
// @access  Public
// ==========================================
const getGarageReviewSummary = async (req, res) => {
  try {
    const { garageId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(garageId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid garage ID'
      });
    }

    const garage = await Garage.findById(garageId);
    if (!garage || garage.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Garage not found'
      });
    }

    const summary = await Review.aggregate([
      { 
        $match: { 
          garage: new mongoose.Types.ObjectId(garageId), 
          isDeleted: false,
          isVerified: true
        } 
      },
      {
        $facet: {
          overview: [
            {
              $group: {
                _id: null,
                totalReviews: { $sum: 1 },
                averageRating: { $avg: '$rating' },
                averageServiceQuality: { $avg: '$categories.serviceQuality' },
                averagePriceFairness: { $avg: '$categories.priceFairness' },
                averageTimeliness: { $avg: '$categories.timeliness' },
                averageCleanliness: { $avg: '$categories.cleanliness' },
                averageCustomerService: { $avg: '$categories.customerService' }
              }
            }
          ],
          ratingDistribution: [
            { $group: { _id: '$rating', count: { $sum: 1 } } },
            { $sort: { '_id': 1 } }
          ],
          recentTrends: [
            {
              $group: {
                _id: { month: { $month: '$createdAt' }, year: { $year: '$createdAt' } },
                averageRating: { $avg: '$rating' },
                count: { $sum: 1 }
              }
            },
            { $sort: { '_id.year': -1, '_id.month': -1 } },
            { $limit: 6 }
          ],
          respondedRate: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                responded: { $sum: { $cond: [{ $ifNull: ['$response.comment', false] }, 1, 0] } }
              }
            }
          ]
        }
      }
    ]);

    const result = summary[0];
    const overview = result.overview[0] || {};

    res.status(200).json({
      success: true,
      data: {
        garageId,
        summary: {
          totalReviews: overview.totalReviews || 0,
          averageRating: Math.round((overview.averageRating || 0) * 10) / 10,
          categoryAverages: {
            serviceQuality: Math.round((overview.averageServiceQuality || 0) * 10) / 10,
            priceFairness: Math.round((overview.averagePriceFairness || 0) * 10) / 10,
            timeliness: Math.round((overview.averageTimeliness || 0) * 10) / 10,
            cleanliness: Math.round((overview.averageCleanliness || 0) * 10) / 10,
            customerService: Math.round((overview.averageCustomerService || 0) * 10) / 10
          },
          ratingDistribution: result.ratingDistribution,
          recentTrends: result.recentTrends,
          responseRate: result.respondedRate[0] 
            ? Math.round((result.respondedRate[0].responded / result.respondedRate[0].total) * 100) 
            : 0
        }
      }
    });
  } catch (error) {
    console.error('Get garage review summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching garage review summary',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Verify review (Admin only)
// @route   PUT /api/reviews/:id/verify
// @access  Private/Admin
// ==========================================
const verifyReview = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid review ID'
      });
    }

    const review = await Review.findById(id);

    if (!review || review.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    review.isVerified = !review.isVerified;
    await review.save();

    res.status(200).json({
      success: true,
      message: `Review ${review.isVerified ? 'verified' : 'unverified'} successfully`,
      data: { isVerified: review.isVerified }
    });
  } catch (error) {
    console.error('Verify review error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying review',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Soft delete review
// @route   DELETE /api/reviews/:id
// @access  Private (Car Owner or Admin)
// ==========================================
const softDeleteReview = async (req, res) => {
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
        message: 'Invalid review ID'
      });
    }

    const review = await Review.findById(id).session(session);

    if (!review) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    const isOwner = review.carOwner.toString() === req.user.id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this review'
      });
    }

    if (review.isDeleted) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Review already deleted'
      });
    }

    review.isDeleted = true;
    review.deletedAt = new Date();
    review.deletedBy = req.user.id;
    await review.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'Review deleted successfully'
    });
  } catch (error) {
    if (session) {
      try { await session.abortTransaction(); } catch (e) {}
      try { session.endSession(); } catch (e) {}
    }
    console.error('Soft delete review error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting review',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Restore soft deleted review
// @route   PUT /api/reviews/:id/restore
// @access  Private/Admin
// ==========================================
const restoreReview = async (req, res) => {
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
        message: 'Invalid review ID'
      });
    }

    const review = await Review.findOne({ 
      _id: id, 
      isDeleted: true 
    }).session(session);

    if (!review) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Deleted review not found'
      });
    }

    review.isDeleted = false;
    review.deletedAt = undefined;
    review.deletedBy = undefined;
    await review.save({ session });

    await session.commitTransaction();
    session.endSession();

    const restoredReview = await Review.findById(id)
      .populate('carOwner', 'name email avatar')
      .populate('garage', 'name address')
      .populate('booking', 'bookingDate timeSlot service');

    res.status(200).json({
      success: true,
      message: 'Review restored successfully',
      data: { review: restoredReview }
    });
  } catch (error) {
    if (session) {
      try { await session.abortTransaction(); } catch (e) {}
      try { session.endSession(); } catch (e) {}
    }
    console.error('Restore review error:', error);
    res.status(500).json({
      success: false,
      message: 'Error restoring review',
      error: error.message
    });
  }
};

// ==========================================
// @desc    Hard delete review (permanent)
// @route   DELETE /api/reviews/:id/hard
// @access  Private/Admin only
// ==========================================
const hardDeleteReview = async (req, res) => {
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
        message: 'Invalid review ID'
      });
    }

    if (req.user.role !== 'admin') {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Only admins can permanently delete reviews'
      });
    }

    const review = await Review.findById(id).session(session);

    if (!review) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    for (const imagePath of review.images) {
      try {
        await fs.unlink(path.join(__dirname, '..', imagePath));
      } catch (fileError) {
        console.error('Error deleting file:', fileError);
      }
    }

    await Review.findByIdAndDelete(id, { session });
    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'Review permanently deleted'
    });
  } catch (error) {
    if (session) {
      try { await session.abortTransaction(); } catch (e) {}
      try { session.endSession(); } catch (e) {}
    }
    console.error('Hard delete review error:', error);
    res.status(500).json({
      success: false,
      message: 'Error hard deleting review',
      error: error.message
    });
  }
};

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
  getReviews,
  getReview,
  createReview,
  updateReview,
  addResponse,
  updateResponse,
  deleteResponse,
  uploadImages,
  deleteImage,
  markHelpful,
  getGarageReviewSummary,
  verifyReview,
  softDeleteReview,
  restoreReview,
  hardDeleteReview
};