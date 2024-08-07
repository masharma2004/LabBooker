const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  resourceId: {
    type: String,
    required: true
  },
  start: {
    type: Date,
    required: true
  },
  end: {
    type: Date,
    required: true
  },
  status:{
    type:String,
    enum:['pending','approved','rejected'],
    default:'approved'
  },
  createdAt:{
    type:Date,
    default:Date.now
  }
},{timestamps:true });

// Backstop for the Redis lock: two live bookings can't start at the same
// instant on the same resource. This only catches identical starts; partial
// overlaps with different starts are still handled by the lock plus
// checkAvailability. Rejected bookings are left out so the slot can be reused.
BookingSchema.index(
  { resourceId: 1, start: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending', 'approved'] } }
  }
);

module.exports = mongoose.model('Booking', BookingSchema);