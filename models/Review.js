const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    carOwner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Car owner reference is required']
    },
    garage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'garage',
      required: [true, 'Garage reference is required']
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: [true, 'Booking reference is required']
    },
    rating: {
      type: Number,
      required: [true, 'Rating is required'],
      min: [1, 'Rating must be at least 1'],
      max: [5, 'Rating cannot exceed 5']
    },
    title: {
      type: String,
      required: [true, 'Review title is required'],
      trim: true,
      maxlength: [100, 'Title cannot exceed 100 characters']
    },
    comment: {
      type: String,
      required: [true, 'Review comment is required'],
      trim: true,
      maxlength: [500, 'Comment cannot exceed 500 characters']
    },
    categories: {
      serviceQuality: { type: Number, min: 1, max: 5 },
      priceFairness: { type: Number, min: 1, max: 5 },
      timeliness: { type: Number, min: 1, max: 5 },
      cleanliness: { type: Number, min: 1, max: 5 },
      customerService: { type: Number, min: 1, max: 5 }
    },
    images: [{ type: String, default: [] }],
    // ADD THIS RESPONSE FIELD
    response: {
      comment: { type: String },
      respondedAt: { type: Date },
      respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    },
    isVerified: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false }
  },
  { timestamps: true }
);

// Indexes
reviewSchema.index({ garage: 1, isDeleted: 1 });
reviewSchema.index({ carOwner: 1 });
reviewSchema.index({ booking: 1 }, { unique: true });
reviewSchema.index({ rating: -1 });

module.exports = mongoose.model('Review', reviewSchema);