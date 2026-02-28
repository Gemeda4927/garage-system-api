// ==========================================
// middleware/auth.middleware.js
// ==========================================

const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  try {
    let token;

    // Check Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
      console.log('Token received:', token.substring(0, 20) + '...'); // Debug log
    }

    if (!token) {
      console.log('No token provided');
      return res.status(401).json({
        success: false,
        message: 'Not authorized, no token'
      });
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      console.log('Decoded token:', decoded); // Debug log

      // Get user from token
      const user = await User.findById(decoded.id).select('-password');

      if (!user) {
        console.log('User not found for id:', decoded.id);
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }

      // Set user in request - IMPORTANT: Use _id not id
      req.user = {
        _id: user._id,        // This is what your payment controller expects
        id: user._id,          // Keep both for compatibility
        name: user.name,
        email: user.email,
        role: user.role
      };

      console.log('User set in req.user:', req.user); // Debug log
      next();
    } catch (error) {
      console.log('Token verification failed:', error.message);
      return res.status(401).json({
        success: false,
        message: 'Not authorized, token failed'
      });
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};




// @desc    Authorize roles
// @param   {...string} roles - Allowed roles
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role ${req.user.role} is not authorized to access this route`
      });
    }
    next();
  };
};

// @desc    Check if user is garage owner and can create garage
const canCreateGarage = async (req, res, next) => {
  try {
    if (req.user.role !== 'garage_owner') {
      return res.status(403).json({
        success: false,
        message: 'Only garage owners can create garages'
      });
    }

    const user = await User.findById(req.user.id);
    
    if (!user.canCreateGarage) {
      return res.status(403).json({
        success: false,
        message: 'You need to complete payment to create a garage'
      });
    }

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error checking garage creation permission',
      error: error.message
    });
  }
};

// @desc    Check resource ownership or admin role
const checkOwnership = (model) => {
  return async (req, res, next) => {
    try {
      const resourceId = req.params.id;
      const userId = req.user.id;
      const userRole = req.user.role;

      // Admins can access any resource
      if (userRole === 'admin') {
        return next();
      }

      // Find the resource
      const resource = await model.findById(resourceId);

      if (!resource) {
        return res.status(404).json({
          success: false,
          message: 'Resource not found'
        });
      }

      // Check ownership based on model type
      let isOwner = false;

      switch (model.modelName) {
        case 'User':
          isOwner = resource._id.toString() === userId;
          break;
        case 'Garage':
          isOwner = resource.owner.toString() === userId;
          break;
        case 'Booking':
          isOwner = resource.carOwner.toString() === userId;
          break;
        case 'Review':
          isOwner = resource.carOwner.toString() === userId;
          break;
        case 'Service':
          // Need to check garage ownership
          const garage = await mongoose.model('Garage').findById(resource.garage);
          isOwner = garage && garage.owner.toString() === userId;
          break;
        default:
          isOwner = false;
      }

      if (!isOwner) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to access this resource'
        });
      }

      next();
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error checking resource ownership',
        error: error.message
      });
    }
  };
};

// @desc    Rate limiting for auth attempts (simple implementation)
const authRateLimiter = (req, res, next) => {
  // This is a simple in-memory rate limiter
  // In production, use a proper rate limiting library like express-rate-limit
  const attempts = new Map();
  const ip = req.ip;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 5;

  if (!attempts.has(ip)) {
    attempts.set(ip, { count: 1, firstAttempt: now });
    return next();
  }

  const data = attempts.get(ip);
  
  if (now - data.firstAttempt > windowMs) {
    // Reset after window expires
    attempts.set(ip, { count: 1, firstAttempt: now });
    return next();
  }

  if (data.count >= maxAttempts) {
    return res.status(429).json({
      success: false,
      message: 'Too many login attempts, please try again later'
    });
  }

  data.count++;
  next();
};

// @desc    Check if user is verified (if you add email verification)
const isVerified = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user.isEmailVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email first'
      });
    }

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error checking verification status',
      error: error.message
    });
  }
};

// @desc    Optional authentication - doesn't require token but adds user if present
const optionalAuth = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password');
        
        if (user && !user.isDeleted) {
          req.user = {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            canCreateGarage: user.canCreateGarage
          };
        }
      } catch (error) {
        // Silently fail - user remains undefined
      }
    }
    
    next();
  } catch (error) {
    // Continue even if auth fails
    next();
  }
};

module.exports = {
  protect,
  authorize,
  canCreateGarage,
  checkOwnership,
  authRateLimiter,
  isVerified,
  optionalAuth
};