const mongoose = require('mongoose');

// Helper: convert to boolean
function convertToBoolean(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const trimmed = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(trimmed)) return true;
    if (['false', '0', 'no', 'off'].includes(trimmed)) return false;
  }
  if (typeof v === 'number') return v !== 0;
  return Boolean(v);
}

// Day schema helper
function daySchema(defaultClosed = false) {
  return {
    open: String,
    close: String,
    closed: {
      type: Boolean,
      default: defaultClosed,
      set: v => convertToBoolean(v),
    },
  };
}

// Garage Schema
const garageSchema = new mongoose.Schema(
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
    coordinates: {
      type: { 
        type: String, 
        enum: ['Point'], 
        default: 'Point' 
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: function (value) {
            if (!Array.isArray(value) || value.length !== 2) return false;
            const [lng, lat] = value.map(v => typeof v === 'string' ? parseFloat(v) : v);
            return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
          },
          message: 'Coordinates must be [longitude, latitude]',
        },
      },
    },
    address: {
      street: { type: String, required: true },
      city: { type: String, required: true },
      state: String,
      country: { type: String, default: 'Ethiopia' },
      zipCode: String,
    },
    contactInfo: {
      phone: { type: String, required: true },
      email: { type: String, lowercase: true, trim: true },
      website: { type: String, trim: true },
    },
    businessHours: {
      monday: daySchema(),
      tuesday: daySchema(),
      wednesday: daySchema(),
      thursday: daySchema(),
      friday: daySchema(),
      saturday: daySchema(),
      sunday: daySchema(true),
    },
    owner: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User', 
      required: true 
    },
    creationPayment: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Payment', 
      unique: true, 
      sparse: true 
    },
    status: { 
      type: String, 
      enum: ['pending', 'active', 'suspended'], 
      default: 'pending' 
    },
    services: [{ 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Service' 
    }],
    images: [{ 
      type: String 
    }],
    documents: [{ 
      type: String 
    }],
    stats: {
      totalBookings: { type: Number, default: 0 },
      completedBookings: { type: Number, default: 0 },
      averageRating: { type: Number, default: 0, min: 0, max: 5 },
      totalReviews: { type: Number, default: 0 },
    },
    isActive: { 
      type: Boolean, 
      default: false, 
      set: v => convertToBoolean(v) 
    },
    isVerified: { 
      type: Boolean, 
      default: false, 
      set: v => convertToBoolean(v) 
    },
    isDeleted: { 
      type: Boolean, 
      default: false, 
      set: v => convertToBoolean(v) 
    },
    deletedAt: Date,
    deletedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    verifiedAt: Date,
    verifiedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    paidAt: Date,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
garageSchema.index({ coordinates: '2dsphere' });
garageSchema.index({ owner: 1, isDeleted: 1 });
garageSchema.index({ 'address.city': 1, isDeleted: 1 });
garageSchema.index({ status: 1 });
garageSchema.index({ isVerified: 1 });

// Virtuals
garageSchema.virtual('reviews', { 
  ref: 'Review', 
  localField: '_id', 
  foreignField: 'garage' 
});

garageSchema.virtual('servicesList', { 
  ref: 'Service', 
  localField: '_id', 
  foreignField: 'garage', 
  justOne: false, 
  options: { match: { isDeleted: false } } 
});

// Methods
garageSchema.methods.getCoordinates = function () {
  return {
    longitude: this.coordinates?.coordinates?.[0],
    latitude: this.coordinates?.coordinates?.[1],
  };
};

// ==========================================
// ✅ FIXED PRE-SAVE MIDDLEWARE - NO NEXT()
// ==========================================
garageSchema.pre('save', async function() {
  try {
    // Normalize coordinates
    if (this.coordinates?.coordinates) {
      this.coordinates.coordinates = this.coordinates.coordinates.map(c => 
        typeof c === 'string' ? parseFloat(c) : c
      );
    }
    
    // Normalize business hours
    if (this.businessHours) {
      Object.values(this.businessHours).forEach(d => {
        if (!d) return;
        if (typeof d.open === 'string') d.open = d.open.trim();
        if (typeof d.close === 'string') d.close = d.close.trim();
        if (d.closed !== undefined) d.closed = convertToBoolean(d.closed);
      });
    }
    
    // Normalize contact info
    if (this.contactInfo) {
      if (typeof this.contactInfo.email === 'string') {
        this.contactInfo.email = this.contactInfo.email.trim().toLowerCase();
      }
      if (typeof this.contactInfo.phone === 'string') {
        this.contactInfo.phone = this.contactInfo.phone.trim();
      }
      if (typeof this.contactInfo.website === 'string') {
        this.contactInfo.website = this.contactInfo.website.trim();
      }
    }
    
    // Normalize stats
    if (this.stats) {
      this.stats.totalBookings = parseInt(this.stats.totalBookings) || 0;
      this.stats.completedBookings = parseInt(this.stats.completedBookings) || 0;
      this.stats.averageRating = parseFloat(this.stats.averageRating) || 0;
      this.stats.totalReviews = parseInt(this.stats.totalReviews) || 0;
    }
    
    // Auto-set active
    this.isActive = this.status === 'active';
    
    // No next() needed - just return
    return;
  } catch (error) {
    // Throw error to be caught by mongoose
    throw error;
  }
});
// ==========================================
// ✅ EXPORT WITH LOWERCASE
// ==========================================
module.exports = mongoose.model('garage', garageSchema);