const express = require("express");
const router = express.Router();
const Expense = require("../models/Expense");
const auth = require("../middleware/auth");

// Get all expenses with optional filters
router.get("/", auth, async (req, res) => {
    try {
        const { 
            startDate, 
            endDate, 
            category,
            minAmount,
            maxAmount,
            sort = 'date'  // default sort by date
        } = req.query;

        // Build query
        let query = {};

        // Date filter
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        // Category filter
        if (category) {
            query.category = category;
        }

        // Amount range filter
        if (minAmount || maxAmount) {
            query.amount = {};
            if (minAmount) query.amount.$gte = Number(minAmount);
            if (maxAmount) query.amount.$lte = Number(maxAmount);
        }

        // Build sort object
        let sortObj = {};
        switch(sort) {
            case 'amount':
                sortObj = { amount: -1 };
                break;
            case 'amount_asc':
                sortObj = { amount: 1 };
                break;
            case 'date_asc':
                sortObj = { date: 1 };
                break;
            default:
                sortObj = { date: -1 }; // Default: most recent first
        }

        // Fetch expenses
        const expenses = await Expense.find(query)
            .sort(sortObj)
            .populate('addedBy', 'name');

        // Calculate summary
        const summary = {
            totalExpenses: expenses.length,
            totalAmount: expenses.reduce((sum, exp) => sum + exp.amount, 0),
            byCategory: {}
        };

        // Calculate totals by category
        expenses.forEach(expense => {
            if (!summary.byCategory[expense.category]) {
                summary.byCategory[expense.category] = {
                    count: 0,
                    total: 0
                };
            }
            summary.byCategory[expense.category].count++;
            summary.byCategory[expense.category].total += expense.amount;
        });

        res.json({
            expenses: expenses.map(expense => ({
                id: expense._id,
                title: expense.title,
                description: expense.description,
                amount: expense.amount,
                date: expense.date,
                category: expense.category,
                addedBy: expense.addedBy.name,
                office: expense.office,
                carId: expense.carId,
                createdAt: expense.createdAt
            })),
            summary
        });

    } catch (error) {
        console.error("Error fetching expenses:", error);
        res.status(500).json({ error: "Failed to fetch expenses" });
    }
});

// Add new expense
router.post("/", auth, async (req, res) => {
    try {
        const { title, description, amount, date, category, office, carId } = req.body;

        // Validate required fields
        if (!title || !amount || !category) {
            return res.status(400).json({ error: "Title, amount, and category are required" });
        }

        // Validate category
        const validCategories = [
            'Car',
            'Maintenance',
            'Rent',
            'Fuel',
            'Salary',
            'Insurance',
            'Utilities',
            'Marketing',
            'Other'
        ];

        if (!validCategories.includes(category)) {
            return res.status(400).json({ error: "Invalid category" });
        }

        // Create new expense
        const newExpense = new Expense({
            title,
            description,
            amount: Number(amount),
            date: date ? new Date(date) : new Date(),
            category,
            office,
            carId: carId !== "" ? carId : undefined,
            addedBy: req.user.id
        });

        await newExpense.save();

        // Fetch the saved expense with populated user
        const savedExpense = await Expense.findById(newExpense._id)
            .populate('addedBy', 'name');

        res.status(201).json({
            message: "Expense added successfully",
            expense: {
                id: savedExpense._id,
                title: savedExpense.title,
                description: savedExpense.description,
                amount: savedExpense.amount,
                date: savedExpense.date,
                category: savedExpense.category,
                addedBy: savedExpense.addedBy.name,
                createdAt: savedExpense.createdAt
            }
        });

    } catch (error) {
        console.error("Error adding expense:", error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: "Failed to add expense" });
    }
});

// Get expense statistics
router.get("/statistics", auth, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        // Build date range query
        let dateQuery = {};
        if (startDate || endDate) {
            dateQuery.date = {};
            if (startDate) dateQuery.date.$gte = new Date(startDate);
            if (endDate) dateQuery.date.$lte = new Date(endDate);
        }

        // Get statistics by category
        const categoryStats = await Expense.aggregate([
            { $match: dateQuery },
            {
                $group: {
                    _id: "$category",
                    totalAmount: { $sum: "$amount" },
                    count: { $sum: 1 },
                    avgAmount: { $avg: "$amount" }
                }
            },
            { $sort: { totalAmount: -1 } }
        ]);

        // Get monthly totals
        const monthlyStats = await Expense.aggregate([
            { $match: dateQuery },
            {
                $group: {
                    _id: {
                        year: { $year: "$date" },
                        month: { $month: "$date" }
                    },
                    totalAmount: { $sum: "$amount" },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id.year": -1, "_id.month": -1 } }
        ]);

        res.json({
            categoryStatistics: categoryStats,
            monthlyStatistics: monthlyStats,
            summary: {
                totalExpenses: categoryStats.reduce((sum, cat) => sum + cat.count, 0),
                totalAmount: categoryStats.reduce((sum, cat) => sum + cat.totalAmount, 0),
                averageExpense: categoryStats.reduce((sum, cat) => sum + cat.avgAmount, 0) / categoryStats.length
            }
        });

    } catch (error) {
        console.error("Error fetching expense statistics:", error);
        res.status(500).json({ error: "Failed to fetch expense statistics" });
    }
});

// Delete expense
router.delete("/:expenseId", auth, async (req, res) => {
    try {
        const { expenseId } = req.params;

        // Find expense
        const expense = await Expense.findById(expenseId)
            .populate('addedBy', 'name');

        if (!expense) {
            return res.status(404).json({ error: "Expense not found" });
        }

        // Optional: Add additional authorization check
        // For example, only allow admin users or the user who created the expense to delete it
        if (req.user.role !== 'admin' && expense.addedBy._id.toString() !== req.user.id) {
            return res.status(403).json({ 
                error: "You don't have permission to delete this expense" 
            });
        }

        // Store expense details before deletion for response
        const deletedExpenseDetails = {
            id: expense._id,
            title: expense.title,
            amount: expense.amount,
            category: expense.category,
            date: expense.date,
            addedBy: expense.addedBy.name,
            deletedAt: new Date(),
            deletedBy: req.user.id
        };

        // Delete the expense
        await Expense.findByIdAndDelete(expenseId);

        // Send response with deleted expense details
        res.json({
            message: "Expense deleted successfully",
            deletedExpense: deletedExpenseDetails
        });

    } catch (error) {
        console.error("Error deleting expense:", error);
        if (error.kind === 'ObjectId') {
            return res.status(400).json({ error: "Invalid expense ID" });
        }
        res.status(500).json({ error: "Failed to delete expense" });
    }
});


module.exports = router; 