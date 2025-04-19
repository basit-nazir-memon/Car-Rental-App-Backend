const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ExpenseSchema = new Schema(
    {
        title: { 
            type: String, 
            required: true,
            trim: true
        },
        description: { 
            type: String, 
            trim: true
        },
        amount: { 
            type: Number, 
            required: true,
            min: [0, 'Amount cannot be negative']
        },
        date: { 
            type: Date, 
            required: true,
            default: Date.now
        },
        category: { 
            type: String, 
            required: true,
            enum: [
                'Maintenance',
                'Rent',
                'Fuel',
                'Salary',
                'Insurance',
                'Utilities',
                'Marketing',
                'Other'
            ]
        },
        addedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        }
    },
    { 
        timestamps: true 
    }
);

// Add indexes for frequent queries
ExpenseSchema.index({ date: -1 });
ExpenseSchema.index({ category: 1 });

const Expense = mongoose.model("Expense", ExpenseSchema);

module.exports = Expense; 