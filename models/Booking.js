const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const BookingSchema = new Schema(
    {
        carId: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: "Car", 
            required: true 
        },
        meterReading: { 
            type: Number, 
            required: true 
        },
        customerId: { 
            type: mongoose.Schema.Types.ObjectId,
            ref: "Customer",
            required: true
        },
        driverId: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: "Driver",
            required: function() {
                return this.driverPreference === 'driver';
            }
        },
        tripType: { 
            type: String, 
            enum: ['withincity', 'outofcity'],
            required: true 
        },
        tripStartTime: {
            type: String,
            required: true,
            validate: {
                validator: function(value) {
                    return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(value);
                },
                message: 'Trip start time must be in HH:mm format'
            }
        },
        tripDescription: {
            type: String,
            trim: true,
            maxLength: [500, 'Trip description cannot exceed 500 characters']
        },
        driverPreference: {
            type: String,
            enum: ['driver', 'self'],
            required: true
        },
        customerLicenseNumber: {
            type: String,
            trim: true,
        },
        cityName: { 
            type: String,
            trim: true,
            // Only required if tripType is outofcity
            required: function() {
                return this.tripType === 'outofcity';
            }
        },
        startDate: {
            type: Date,
            required: true,
        },
        endDate: {
            type: Date,
            required: true,
            validate: {
                validator: function(value) {
                    return value >= this.startDate;
                },
                message: 'End date must be after or equal to start date'
            }
        },
        startTime: {
            type: String,
            default: "12:00", // Default to 12:00 PM
            validate: {
                validator: function(value) {
                    return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(value);
                },
                message: 'Start time must be in HH:mm format'
            }
        },
        endTime: {
            type: String,
            validate: {
                validator: function(value) {
                    // Only validate if a value is provided
                    return value ? /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(value) : true;
                },
                message: 'End time must be in HH:mm format'
            }
        },
        totalBill: { 
            type: Number,
            required: true,
            min: [0, 'Total bill cannot be negative']
        },
        advancePaid: { 
            type: Number,
            required: true,
            min: [0, 'Advance paid cannot be negative'],
            validate: {
                validator: function(value) {
                    return value <= this.totalBill;
                },
                message: 'Advance paid cannot be greater than total bill'
            }
        },
        discountPercentage: { 
            type: Number,
            default: 0,
            min: [0, 'Discount percentage cannot be negative'],
            max: [100, 'Discount percentage cannot exceed 100']
        },
        discountReference: { 
            type: String,
            trim: true,
            // Required only if there's a discount
            required: function() {
                return this.discountPercentage > 0;
            }
        },
        bookedBy: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: "User",
            required: true 
        },
        status: {
            type: String,
            enum: ['active', 'completed', 'cancelled'],
            default: 'active'
        }
    },
    { 
        timestamps: true // This will automatically add createdAt and updatedAt fields
    }
);

// Virtual for calculating trip duration in days
BookingSchema.virtual('tripDuration').get(function() {
    const start = new Date(this.startDate);
    const end = new Date(this.endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    return diffDays;
});

// Virtual for calculating remaining balance with discount
BookingSchema.virtual('remainingBalance').get(function() {
    const discountAmount = (this.totalBill * (this.discountPercentage || 0)) / 100;
    const discountedTotal = this.totalBill - discountAmount;
    return discountedTotal - this.advancePaid;
});

// Add virtual for discounted total amount
BookingSchema.virtual('discountedTotalAmount').get(function() {
    const discountAmount = (this.totalBill * (this.discountPercentage || 0)) / 100;
    return this.totalBill - discountAmount;
});

// Method to check if dates overlap with existing bookings
BookingSchema.statics.checkAvailability = async function(carId, startDate, endDate, excludeBookingId = null) {
    const query = {
        carId: carId,
        status: 'active',
        $or: [
            {
                startDate: { $lte: endDate },
                endDate: { $gte: startDate }
            }
        ]
    };

    // Exclude current booking when checking for updates
    if (excludeBookingId) {
        query._id = { $ne: excludeBookingId };
    }

    const existingBooking = await this.findOne(query);
    return !existingBooking;
};

// Add method to check if booking can be modified
BookingSchema.methods.canModify = function() {
    return this.status === 'active' && new Date(this.startDate) > new Date();
};

// Add indexes for frequently queried fields
BookingSchema.index({ carId: 1 });
BookingSchema.index({ driverId: 1 });
BookingSchema.index({ status: 1 });
BookingSchema.index({ startDate: 1, endDate: 1 });
BookingSchema.index({ createdAt: -1 });

// Time format validation function
const timeFormatValidator = function(time) {
    if (!time) return true; // Allow null/undefined if the field is not required
    
    // If it's a Date object or ISO string, convert to HH:mm format
    if (time instanceof Date || (typeof time === 'string' && time.includes('T'))) {
        const date = new Date(time);
        if (isNaN(date.getTime())) return false; // Invalid date
        return true;
    }
    
    // If it's already in HH:mm format
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(time);
};

// Pre-save middleware to format the time
BookingSchema.pre('save', function(next) {
    if (this.endTime) {
        // Convert to HH:mm format if it's a Date or ISO string
        if (this.endTime instanceof Date || this.endTime.includes('T')) {
            const date = new Date(this.endTime);
            this.endTime = date.toTimeString().slice(0, 5); // Convert to HH:mm
        }
    }
    next();
});

const Booking = mongoose.model("Booking", BookingSchema);

module.exports = Booking; 