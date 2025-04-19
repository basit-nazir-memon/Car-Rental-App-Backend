const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const StakeholderSchema = new Schema(
    {
        fullName: { 
            type: String, 
            required: [true, "Full name is required"],
            trim: true
        },
        idCardNumber: { 
            type: String, 
            required: [true, "ID card number (CNIC) is required"],
            unique: true,
            trim: true,
            match: [
                /^[0-9]{13}$/, 
                'Please enter a valid 13-digit CNIC number without dashes'
            ]
        },
        email: { 
            type: String, 
            required: [true, "Email is required"],
            unique: true,
            trim: true,
            lowercase: true,
            match: [
                /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
                'Please enter a valid email address'
            ]
        },
        cellPhone: { 
            type: String, 
            required: [true, "Cell phone number is required"],
            trim: true,
            match: [
                /^[0-9]{11}$/,
                'Please enter a valid 11-digit phone number'
            ]
        },
        
        picture: { 
            type: String,
            default: "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png"
        },
        totalCars: {
            type: Number,
            default: 0
        },
        totalRevenue: {
            type: Number,
            default: 0
        },
        totalCommissionPaid: {
            type: Number,
            default: 0
        },
        status: {
            type: String,
            enum: ['active', 'inactive'],
            default: 'active'
        },
        joiningDate: {
            type: Date,
            default: Date.now
        },
        lastPaymentDate: {
            type: Date
        },
        bankDetails: {
            accountTitle: {
                type: String,
                trim: true
            },
            accountNumber: {
                type: String,
                trim: true
            },
            bankName: {
                type: String,
                trim: true
            }
        }
    },
    { 
        timestamps: true 
    }
);

// Virtual for calculating current month's commission
StakeholderSchema.virtual('currentMonthCommission').get(function() {
    // This would need to be calculated based on current month's bookings
    // Implementation would depend on your booking model structure
    return 0;
});

// Add indexes for frequently queried fields
StakeholderSchema.index({ email: 1 });
StakeholderSchema.index({ idCardNumber: 1 });
StakeholderSchema.index({ status: 1 });

// Method to calculate commission for a given period
StakeholderSchema.methods.calculateCommission = async function(startDate, endDate) {
    try {
        const bookings = await mongoose.model('Booking').find({
            carId: { $in: await mongoose.model('Car').find({ stakeholderId: this._id }).distinct('_id') },
            startDate: { $gte: startDate },
            endDate: { $lte: endDate },
            status: 'completed'
        });

        const totalRevenue = bookings.reduce((sum, booking) => sum + booking.totalBill, 0);
        return (totalRevenue * this.commissionPercentage) / 100;
    } catch (error) {
        console.error('Error calculating commission:', error);
        return 0;
    }
};

// Pre-save middleware to format phone number
StakeholderSchema.pre('save', function(next) {
    // Remove any non-numeric characters from phone number
    if (this.cellPhone) {
        this.cellPhone = this.cellPhone.replace(/\D/g, '');
    }
    next();
});

// Create a compound index for unique email per status
StakeholderSchema.index(
    { email: 1, status: 1 }, 
    { unique: true, partialFilterExpression: { status: 'active' } }
);

const Stakeholder = mongoose.model("Stakeholder", StakeholderSchema);

module.exports = Stakeholder; 