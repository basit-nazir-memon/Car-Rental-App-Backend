const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const CustomerSchema = new Schema(
    {
        fullName: { 
            type: String, 
            required: true,
            trim: true
        },
        careOf: { 
            type: String,
            required: true,
            trim: true
        },
        email: { 
            type: String,
            match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email address']
        },
        address: { 
            type: String, 
            trim: true
        },
        phoneNumber: { 
            type: String, 
            required: true,
            trim: true,
            unique: true,
            match: [/^[0-9]{11}$/, 'Please enter a valid phone number']
        },
        idCardNumber: { 
            type: String, 
            required: true,
            trim: true,
            unique: true,
        },
        bookingCount: {
            type: Number,
            default: 0,
            min: 0
        },
        lastBookingDate: {
            type: Date,
            default: null
        }
    },
    { 
        timestamps: true 
    }
);

// Add indexes for frequently queried fields
CustomerSchema.index({ phoneNumber: 1 });
CustomerSchema.index({ idCardNumber: 1 });
CustomerSchema.index({ bookingCount: -1 }); // For finding most frequent customers

const Customer = mongoose.model("Customer", CustomerSchema);

module.exports = Customer; 