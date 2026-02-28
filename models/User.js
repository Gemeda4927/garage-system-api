const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: [true, 'Password is required']
  },
  role: {
    type: String,
    enum: ['admin', 'car_owner', 'garage_owner'],
    default: 'car_owner'
  },
  avatar: {
    type: String,
    default: null
  },
  phone: {
    type: String,
    default: null
  },
  garageCreationPayments: [
    {
      payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
      status: { 
        type: String, 
        enum: ['pending', 'completed', 'failed'], 
        default: 'pending' 
      },
      createdAt: { type: Date, default: Date.now }
    }
  ],
  canCreateGarage: {
    type: Boolean,
    default: false
  },
  isDeleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// ===============================
// 🔒 Hash password before saving - FIXED
// ===============================
userSchema.pre('save', async function() {
  // Only hash if password is modified
  if (!this.isModified('password')) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// ===============================
// 🔑 Compare password method
// ===============================
userSchema.methods.comparePassword = function(candidatePassword) {
  return bcrypt.compareSync(candidatePassword, this.password);
};

// ===============================
// 🚫 Remove sensitive fields when converting to JSON
// ===============================
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('User', userSchema);