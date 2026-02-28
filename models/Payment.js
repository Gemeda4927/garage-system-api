// ==========================================
// 5️⃣ Payment Model (models/Payment.js)
// ==========================================

const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required']
    },
    paymentType: {
      type: String,
      enum: ['garage_creation', 'booking', 'subscription', 'other'],
      required: [true, 'Payment type is required']
    },
    garageCreation: {
      garage: { type: mongoose.Schema.Types.ObjectId, ref: 'Garage' },
      status: { 
        type: String, 
        enum: ['pending', 'used', 'expired'], 
        default: 'pending' 
      }
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking'
    },
    amount: {
      type: Number,
      required: [true, 'Payment amount is required'],
      min: [0, 'Amount cannot be negative']
    },
    currency: {
      type: String,
      default: 'ETB'
    },
    method: {
      type: String,
      enum: ['card', 'bank', 'mobile', 'cash'],
      required: [true, 'Payment method is required']
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending'
    },
    transactionId: {
      type: String,
      unique: true,
      sparse: true
    },
    provider: {
      name: { type: String, default: 'Chapa' },
      reference: { type: String },
      checkoutUrl: { type: String },
      response: { type: mongoose.Schema.Types.Mixed }
    },
    paidAt: {
      type: Date,
      default: null
    },
    receipts: [
      {
        type: String,
        default: []
      }
    ],
    notes: {
      type: String,
      default: ''
    },
    isDeleted: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

// Indexes
paymentSchema.index({ user: 1, paymentType: 1 });
paymentSchema.index({ 'garageCreation.garage': 1 });
paymentSchema.index({ booking: 1 });
paymentSchema.index({ status: 1 });

// After payment is completed for garage_creation, update user's canCreateGarage
paymentSchema.post('save', async function(doc) {
  if (doc.paymentType === 'garage_creation' && doc.status === 'completed') {
    const User = mongoose.model('User');
    await User.findByIdAndUpdate(doc.user, {
      canCreateGarage: true,
      $push: {
        garageCreationPayments: {
          payment: doc._id,
          status: 'completed'
        }
      }
    });
  }
});

module.exports = mongoose.model('Payment', paymentSchema);