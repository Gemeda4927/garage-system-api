const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
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
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: [true, 'Service reference is required']
    },
    bookingDate: {
      type: Date,
      required: [true, 'Booking date is required']
    },
    timeSlot: {
      start: { type: String, required: true },
      end: { type: String, required: true }
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'in_progress', 'completed', 'cancelled', 'rejected'],
      default: 'pending'
    },
    vehicleInfo: {
      make: { type: String, required: true },
      model: { type: String, required: true },
      year: { type: Number },
      licensePlate: { type: String, required: true }
    },
    notes: {
      type: String,
      default: ''
    },
    attachments: {
      type: [String],
      default: []
    },
    isDeleted: { type: Boolean, default: false }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes
bookingSchema.index({ carOwner: 1, isDeleted: 1 });
bookingSchema.index({ garage: 1, isDeleted: 1 });
bookingSchema.index({ service: 1 });
bookingSchema.index({ bookingDate: 1 });
bookingSchema.index({ status: 1 });

// Virtual for review
bookingSchema.virtual('review', {
  ref: 'Review',
  localField: '_id',
  foreignField: 'booking',
  justOne: true
});

module.exports = mongoose.model('Booking', bookingSchema);