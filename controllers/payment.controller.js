// ==========================================
// controllers/payment.controller.js
// ==========================================

const Payment = require('../models/Payment');
const User = require('../models/User');
const Garage = require('../models/garage');
const Booking = require('../models/booking');
const axios = require('axios');
const mongoose = require('mongoose');
const crypto = require('crypto');

// ================================
// Initialize Garage Payment
// ================================


exports.initGaragePayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Check if user is authenticated
    if (!req.user || !req.user._id) {
      await session.abortTransaction();
      session.endSession();
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const { amount } = req.body;

    if (!amount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ 
        success: false, 
        message: 'Missing payment amount' 
      });
    }

    // Validate amount
    if (amount < 100 || amount > 1000000) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Amount must be between 100 and 1,000,000 ETB'
      });
    }

    // Use callback URL from environment
    const callbackUrl = process.env.CHAPA_CALLBACK_URL || 'https://your-api.com/api/payments/chapa-callback';
    const returnUrl = process.env.CHAPA_RETURN_URL || 'https://your-app.com/payment-complete';

    // Generate unique transaction reference
    const tx_ref = `payment-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    // Chapa request data from logged-in user
    const chapaData = {
      amount: amount.toString(),
      currency: 'ETB',
      email: req.user.email,
      first_name: req.user.name?.split(' ')[0] || req.user.name || 'User',
      last_name: req.user.name?.split(' ').slice(1).join(' ') || '',
      callback_url: callbackUrl,
      return_url: returnUrl,
      tx_ref,
      title: 'Garage Creation Payment',
      description: 'Payment for garage creation'
    };

    // Initialize Chapa payment
    const chapaResponse = await axios.post(
      'https://api.chapa.co/v1/transaction/initialize',
      chapaData,
      {
        headers: {
          Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!chapaResponse.data || !chapaResponse.data.data || !chapaResponse.data.data.checkout_url) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({
        success: false,
        message: 'Failed to initialize payment with Chapa'
      });
    }

    // Save payment in DB - make sure user ID is set correctly
    const paymentData = {
      user: req.user._id, // This must be a valid ObjectId
      paymentType: 'garage_creation',
      amount,
      currency: 'ETB',
      method: 'card',
      status: 'pending',
      transactionId: tx_ref,
      provider: {
        name: 'Chapa',
        reference: tx_ref,
        checkoutUrl: chapaResponse.data.data.checkout_url,
        response: chapaResponse.data
      }
    };

    console.log('Creating payment with data:', paymentData); // Debug log

    const payment = await Payment.create([paymentData], { session });

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      success: true,
      message: 'Payment initialized successfully',
      data: {
        paymentId: payment[0]._id,
        checkoutUrl: chapaResponse.data.data.checkout_url,
        tx_ref,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      }
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('Chapa Payment Error:', err);
    
    return res.status(500).json({ 
      success: false, 
      message: err.message,
      error: err.toString()
    });
  }
};
// ================================
// Initialize Booking Payment
// ================================
exports.initBookingPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingId, amount } = req.body;

    if (!bookingId || !amount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ 
        success: false, 
        message: 'Missing booking ID or amount' 
      });
    }

    // Find booking
    const booking = await Booking.findOne({
      _id: bookingId,
      carOwner: req.user._id,
      isDeleted: false
    }).populate('garage').session(session);

    if (!booking) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ 
        success: false, 
        message: 'Booking not found' 
      });
    }

    // Check if booking is already paid
    if (booking.isPaid) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Booking is already paid'
      });
    }

    // Validate amount matches estimated price
    if (amount !== booking.price.estimated) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Payment amount does not match booking price'
      });
    }

    // Generate unique transaction reference
    const tx_ref = `booking-${bookingId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const callbackUrl = process.env.CHAPA_CALLBACK_URL;
    const returnUrl = process.env.CHAPA_RETURN_URL;

    // Chapa request data
    const chapaData = {
      amount: amount.toString(),
      currency: 'ETB',
      email: req.user.email,
      first_name: req.user.name.split(' ')[0] || req.user.name,
      last_name: req.user.name.split(' ').slice(1).join(' ') || '',
      callback_url: callbackUrl,
      return_url: returnUrl,
      tx_ref,
      title: `Payment for Booking #${bookingId}`,
      description: `Payment for ${booking.service.name} at ${booking.garage.name}`,
      'customization[title]': 'Service Payment',
      'customization[description]': `Booking on ${new Date(booking.bookingDate).toLocaleDateString()}`
    };

    // Initialize Chapa payment
    const chapaResponse = await axios.post(
      'https://api.chapa.co/v1/transaction/initialize',
      chapaData,
      {
        headers: {
          Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Save payment in DB
    const payment = await Payment.create([{
      user: req.user._id,
      paymentType: 'booking',
      booking: bookingId,
      amount,
      currency: 'ETB',
      method: 'card',
      status: 'pending',
      transactionId: tx_ref,
      provider: {
        name: 'Chapa',
        reference: tx_ref,
        checkoutUrl: chapaResponse.data.data.checkout_url,
        response: chapaResponse.data
      }
    }], { session });

    // Link payment to booking
    booking.payment = payment[0]._id;
    await booking.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      success: true,
      message: 'Booking payment initialized successfully',
      data: {
        paymentId: payment[0]._id,
        checkoutUrl: chapaResponse.data.data.checkout_url,
        tx_ref,
        bookingId
      }
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('Booking Payment Error:', err.response?.data || err.message);
    
    return res.status(500).json({ 
      success: false, 
      message: err.response?.data?.message || err.message 
    });
  }
};

// ================================
// Chapa Webhook Handler
// ================================
exports.handleChapaWebhook = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payload = req.body;
    const signature = req.headers['x-chapa-signature'];

    // Verify webhook signature
    const hash = crypto
      .createHmac('sha256', process.env.CHAPA_WEBHOOK_SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');

    if (hash !== signature) {
      console.warn('Invalid webhook signature');
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    const { tx_ref, status } = payload;

    // Find payment
    const payment = await Payment.findOne({ transactionId: tx_ref }).session(session);
    
    if (!payment) {
      console.warn(`Payment not found for tx_ref: ${tx_ref}`);
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    // Update payment status
    payment.status = status === 'success' ? 'completed' : 'failed';
    payment.provider.response = payload;
    
    if (status === 'success') {
      payment.paidAt = new Date();
    }

    await payment.save({ session });

    // Handle based on payment type
    if (status === 'success') {
      if (payment.paymentType === 'garage_creation') {
        // Update user permission
        await User.findByIdAndUpdate(
          payment.user,
          { 
            canCreateGarage: true,
            $push: {
              garageCreationPayments: {
                payment: payment._id,
                status: 'completed'
              }
            }
          },
          { session }
        );

        // Update garage payment status
        if (payment.garageCreation?.garage) {
          await Garage.findByIdAndUpdate(
            payment.garageCreation.garage,
            { 
              creationPayment: payment._id,
              paidAt: new Date(),
              status: 'pending' // Still pending verification
            },
            { session }
          );
        }
      } else if (payment.paymentType === 'booking' && payment.booking) {
        // Update booking payment status
        await Booking.findByIdAndUpdate(
          payment.booking,
          { 
            isPaid: true,
            payment: payment._id,
            status: 'approved' // Auto-approve after payment
          },
          { session }
        );
      }
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ success: true, message: 'Webhook processed' });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('Webhook Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ================================
// Verify Payment (Manual)
// ================================
exports.verifyPayment = async (req, res) => {
  try {
    const { tx_ref } = req.params;

    // Verify payment with Chapa
    const verifyRes = await axios.get(
      `https://api.chapa.co/v1/transaction/verify/${tx_ref}`,
      { 
        headers: { 
          Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}` 
        } 
      }
    );

    const chapaData = verifyRes.data;

    // Find payment record
    const payment = await Payment.findOne({ transactionId: tx_ref })
      .populate('user', 'name email')
      .populate('garageCreation.garage', 'name')
      .populate('booking');

    if (!payment) {
      return res.status(404).json({ 
        success: false, 
        message: 'Payment not found' 
      });
    }

    // Update payment status if changed
    if (chapaData.data.status === 'success' && payment.status !== 'completed') {
      payment.status = 'completed';
      payment.paidAt = new Date();
      await payment.save();

      // Trigger post-payment actions
      if (payment.paymentType === 'garage_creation') {
        await User.findByIdAndUpdate(payment.user, { canCreateGarage: true });
      } else if (payment.paymentType === 'booking' && payment.booking) {
        await Booking.findByIdAndUpdate(payment.booking, { isPaid: true });
      }
    } else if (chapaData.data.status === 'failed' && payment.status === 'pending') {
      payment.status = 'failed';
      await payment.save();
    }

    return res.status(200).json({ 
      success: true, 
      data: {
        payment,
        verification: chapaData.data
      }
    });
  } catch (err) {
    console.error('Verification Error:', err.response?.data || err.message);
    
    return res.status(500).json({ 
      success: false, 
      message: err.response?.data?.message || err.message 
    });
  }
};

// ================================
// Get All Payments
// ================================
exports.getAllPayments = async (req, res) => {
  try {
    const {
      paymentType,
      status,
      userId,
      garageId,
      bookingId,
      startDate,
      endDate,
      minAmount,
      maxAmount,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const filter = {};

    // Role-based filtering
    if (req.user.role === 'car_owner') {
      filter.user = req.user.id;
    } else if (req.user.role === 'garage_owner') {
      // Find garages owned by user
      const userGarages = await Garage.find({ owner: req.user.id }).distinct('_id');
      filter['garageCreation.garage'] = { $in: userGarages };
    }
    // Admin sees all

    // Apply filters
    if (paymentType) filter.paymentType = paymentType;
    if (status) filter.status = status;
    if (userId && req.user.role === 'admin') filter.user = userId;
    if (garageId) filter['garageCreation.garage'] = garageId;
    if (bookingId) filter.booking = bookingId;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    if (minAmount || maxAmount) {
      filter.amount = {};
      if (minAmount) filter.amount.$gte = parseFloat(minAmount);
      if (maxAmount) filter.amount.$lte = parseFloat(maxAmount);
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Sorting
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query
    const payments = await Payment.find(filter)
      .populate('user', 'name email phone')
      .populate('garageCreation.garage', 'name address')
      .populate('booking', 'bookingDate timeSlot service price')
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    const total = await Payment.countDocuments(filter);

    // Get statistics
    const stats = await Payment.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
          averageAmount: { $avg: '$amount' },
          minAmount: { $min: '$amount' },
          maxAmount: { $max: '$amount' },
          completedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          pendingCount: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          },
          refundedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, 1, 0] }
          }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        payments,
        stats: stats[0] || {
          totalAmount: 0,
          averageAmount: 0,
          minAmount: 0,
          maxAmount: 0,
          completedCount: 0,
          pendingCount: 0,
          failedCount: 0,
          refundedCount: 0
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
    res.status(500).json({
      success: false,
      message: 'Error fetching payments',
      error: error.message
    });
  }
};

// ================================
// Get Single Payment
// ================================
exports.getPayment = async (req, res) => {
  try {
    const { id } = req.params;

    const payment = await Payment.findOne({ 
      _id: id,
      ...(req.user.role !== 'admin' ? { user: req.user.id } : {})
    })
      .populate('user', 'name email phone')
      .populate('garageCreation.garage', 'name address status')
      .populate('booking', 'bookingDate timeSlot service vehicleInfo status');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    res.status(200).json({
      success: true,
      data: { payment }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching payment',
      error: error.message
    });
  }
};

// ================================
// Initiate Refund
// ================================
exports.initiateRefund = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { reason } = req.body;

    const payment = await Payment.findById(id).session(session);

    if (!payment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Check if payment can be refunded
    if (payment.status !== 'completed') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Only completed payments can be refunded'
      });
    }

    if (payment.status === 'refunded') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Payment already refunded'
      });
    }

    // Check refund window (e.g., 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    if (payment.paidAt < thirtyDaysAgo && req.user.role !== 'admin') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Refund window has expired (30 days)'
      });
    }

    // TODO: Integrate with Chapa refund API
    // const refundResponse = await axios.post(...);

    // Update payment status
    payment.status = 'refunded';
    payment.refundInfo = {
      reason,
      requestedAt: new Date(),
      requestedBy: req.user.id,
      // refundId: refundResponse.data.refund_id
    };
    await payment.save({ session });

    // Handle refund based on payment type
    if (payment.paymentType === 'booking' && payment.booking) {
      await Booking.findByIdAndUpdate(
        payment.booking,
        { 
          isPaid: false,
          status: 'cancelled'
        },
        { session }
      );
    } else if (payment.paymentType === 'garage_creation') {
      await User.findByIdAndUpdate(
        payment.user,
        { canCreateGarage: false },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'Refund initiated successfully',
      data: { payment }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({
      success: false,
      message: 'Error initiating refund',
      error: error.message
    });
  }
};

// ================================
// Get Payment Statistics
// ================================
exports.getPaymentStats = async (req, res) => {
  try {
    const { period = 'month' } = req.query;

    // Date range based on period
    const endDate = new Date();
    let startDate = new Date();
    
    switch (period) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setMonth(startDate.getMonth() - 1);
    }

    const stats = await Payment.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          ...(req.user.role !== 'admin' ? { user: mongoose.Types.ObjectId(req.user.id) } : {})
        }
      },
      {
        $facet: {
          overview: [
            {
              $group: {
                _id: null,
                totalRevenue: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$amount', 0] } },
                totalTransactions: { $sum: 1 },
                successfulTransactions: {
                  $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                },
                failedTransactions: {
                  $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
                },
                pendingTransactions: {
                  $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
                }
              }
            }
          ],
          byType: [
            {
              $group: {
                _id: '$paymentType',
                count: { $sum: 1 },
                totalAmount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$amount', 0] } }
              }
            }
          ],
          byDay: [
            {
              $group: {
                _id: {
                  year: { $year: '$createdAt' },
                  month: { $month: '$createdAt' },
                  day: { $dayOfMonth: '$createdAt' }
                },
                count: { $sum: 1 },
                amount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$amount', 0] } }
              }
            },
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
          ],
          byMethod: [
            {
              $group: {
                _id: '$method',
                count: { $sum: 1 },
                totalAmount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$amount', 0] } }
              }
            }
          ]
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        period,
        dateRange: { startDate, endDate },
        stats: stats[0]
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching payment statistics',
      error: error.message
    });
  }
};

// ================================
// Retry Failed Payment
// ================================
exports.retryPayment = async (req, res) => {
  try {
    const { id } = req.params;

    const payment = await Payment.findOne({
      _id: id,
      user: req.user.id,
      status: 'failed'
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Failed payment not found'
      });
    }

    // Generate new transaction reference
    const newTxRef = `${payment.transactionId}-retry-${Date.now()}`;

    // Re-initialize payment based on type
    if (payment.paymentType === 'garage_creation') {
      const garage = await Garage.findById(payment.garageCreation.garage);
      
      const chapaData = {
        amount: payment.amount.toString(),
        currency: 'ETB',
        email: req.user.email,
        first_name: req.user.name.split(' ')[0] || req.user.name,
        last_name: req.user.name.split(' ').slice(1).join(' ') || '',
        callback_url: process.env.CHAPA_CALLBACK_URL,
        return_url: process.env.CHAPA_RETURN_URL,
        tx_ref: newTxRef,
        title: `Payment for Garage: ${garage.name} (Retry)`,
        description: `Retry payment for garage creation`
      };

      const chapaResponse = await axios.post(
        'https://api.chapa.co/v1/transaction/initialize',
        chapaData,
        {
          headers: {
            Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Update payment record
      payment.transactionId = newTxRef;
      payment.status = 'pending';
      payment.provider = {
        name: 'Chapa',
        reference: newTxRef,
        checkoutUrl: chapaResponse.data.data.checkout_url,
        response: chapaResponse.data
      };
      await payment.save();

      return res.status(200).json({
        success: true,
        message: 'Payment retry initialized',
        data: {
          paymentId: payment._id,
          checkoutUrl: chapaResponse.data.data.checkout_url,
          tx_ref: newTxRef
        }
      });
    }

    res.status(400).json({
      success: false,
      message: 'Retry not supported for this payment type'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error retrying payment',
      error: error.message
    });
  }
};

// ================================
// Get User Payment Methods
// ================================
exports.getUserPaymentMethods = async (req, res) => {
  try {
    // This would typically come from a PaymentMethod model
    // For now, return supported methods
    const methods = [
      {
        id: 'card',
        name: 'Credit/Debit Card',
        icon: '💳',
        supported: true
      },
      {
        id: 'bank',
        name: 'Bank Transfer',
        icon: '🏦',
        supported: true
      },
      {
        id: 'mobile',
        name: 'Mobile Money',
        icon: '📱',
        supported: true
      },
      {
        id: 'cash',
        name: 'Cash',
        icon: '💵',
        supported: false
      }
    ];

    res.status(200).json({
      success: true,
      data: { methods }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching payment methods',
      error: error.message
    });
  }
};