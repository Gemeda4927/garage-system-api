const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema(
  {
    name: { 
      type: String, 
      required: true, 
      trim: true 
    },
    description: { 
      type: String, 
      default: '' 
    },
    price: { 
      type: Number, 
      required: true, 
      min: 0 
    },
    duration: { 
      type: Number, 
      default: 60
    },
    category: { 
      type: String, 
      enum: ['maintenance', 'repair', 'inspection', 'customization', 'other'],
      default: 'maintenance' 
    },
    garage: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'garage',  
      required: true 
    },
    images: [{ 
      type: String, 
      default: [] 
    }],
    documents: [{ 
      type: String, 
      default: [] 
    }],
    isAvailable: { 
      type: Boolean, 
      default: true 
    },
    isDeleted: { 
      type: Boolean, 
      default: false 
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
serviceSchema.index({ garage: 1, isDeleted: 1 });
serviceSchema.index({ category: 1 });
serviceSchema.index({ price: 1 });

// Virtual for bookings
serviceSchema.virtual('bookings', {
  ref: 'Booking',
  localField: '_id',
  foreignField: 'service'
});

module.exports = mongoose.model('Service', serviceSchema);