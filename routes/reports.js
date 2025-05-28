const express = require("express");
const router = express.Router();
const Booking = require("../models/Booking");
const Expense = require("../models/Expense");
const Car = require("../models/Car");
const User = require("../models/User");
const auth = require("../middleware/auth");

// Get monthly report
router.get("/monthly", auth, async (req, res) => {
    try {
        const { month, year } = req.query;

        if (!month || !year) {
            return res.status(400).json({ error: "Month and year are required" });
        }

        // Convert month name to number (0-11)
        const months = ["january", "february", "march", "april", "may", "june", 
                       "july", "august", "september", "october", "november", "december"];
        const monthIndex = months.indexOf(month.toLowerCase());
        
        if (monthIndex === -1) {
            return res.status(400).json({ error: "Invalid month name" });
        }

        // Calculate date ranges for current and previous month
        const startDate = new Date(year, monthIndex, 1);
        const endDate = new Date(year, monthIndex + 1, 0);
        const prevStartDate = new Date(year, monthIndex - 1, 1);
        const prevEndDate = new Date(year, monthIndex, 0);

        // Get current month bookings
        const bookings = await Booking.find({
            startDate: { $gte: startDate, $lte: endDate }
        }).populate([
            { path: 'carId', select: 'model registrationNumber' },
            { path: 'customerId', select: 'fullName' },
            { path: 'driverId', select: 'name' }
        ]);

        // Get previous month bookings for comparison
        const prevBookings = await Booking.find({
            startDate: { $gte: prevStartDate, $lte: prevEndDate }
        });

        // Get expenses for current and previous month
        const expenses = await Expense.find({
            date: { $gte: startDate, $lte: endDate }
        });

        const prevExpenses = await Expense.find({
            date: { $gte: prevStartDate, $lte: prevEndDate }
        });

        // Calculate statistics
        const currentMonthStats = {
            totalBookings: bookings.length,
            activeBookings: bookings.filter(b => b.status === 'active').length,
            completedBookings: bookings.filter(b => b.status === 'completed').length,
            cancelledBookings: bookings.filter(b => b.status === 'cancelled').length,
            totalRevenue: bookings.filter(b => b.status !== 'cancelled').reduce((sum, b) => sum + b.totalBill * (100 - (b.discountPercentage || 0)) / 100, 0),
            totalExpenses: expenses.reduce((sum, e) => sum + e.amount, 0)
        };

        const prevMonthStats = {
            totalRevenue: prevBookings.filter(b => b.status !== 'cancelled').reduce((sum, b) => sum + b.totalBill * (100 - (b.discountPercentage || 0)) / 100, 0),
            totalExpenses: prevExpenses.reduce((sum, e) => sum + e.amount, 0)
        };

        // Calculate percentage changes
        const calculatePercentChange = (current, previous) => {
            if (previous === 0) return current > 0 ? "+100%" : "0%";
            const change = ((current - previous) / previous) * 100;
            return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
        };

        // Format response
        const response = {
            stats: {
                totalBookings: currentMonthStats.totalBookings,
                activeBookings: currentMonthStats.activeBookings,
                completedBookings: currentMonthStats.completedBookings,
                cancelledBookings: currentMonthStats.cancelledBookings,
                totalRevenue: currentMonthStats.totalRevenue,
                revenuePercent: calculatePercentChange(
                    currentMonthStats.totalRevenue,
                    prevMonthStats.totalRevenue
                ),
                totalExpenses: currentMonthStats.totalExpenses,
                expensesPercent: calculatePercentChange(
                    currentMonthStats.totalExpenses,
                    prevMonthStats.totalExpenses
                ),
                netProfit: currentMonthStats.totalRevenue - currentMonthStats.totalExpenses,
                netPercent: calculatePercentChange(
                    currentMonthStats.totalRevenue - currentMonthStats.totalExpenses,
                    prevMonthStats.totalRevenue - prevMonthStats.totalExpenses
                )
            },
            bookingReportData: bookings.map(booking => ({
                id: booking._id,
                carModel: booking.carId.model,
                registrationNumber: booking.carId.registrationNumber,
                customerName: booking.customerId.fullName,
                driverName: booking?.driverId?.name || "Self",
                startDate: booking.startDate,
                endDate: booking.endDate,
                totalAmount: booking.totalBill * (100 - (booking.discountPercentage || 0)) / 100,
                status: booking.status
            })),
            revenueReportData: [
                {
                    month: months[monthIndex - 1]?.charAt(0).toUpperCase() + months[monthIndex - 1]?.slice(1) || "",
                    revenue: prevMonthStats.totalRevenue,
                    expenses: prevMonthStats.totalExpenses,
                    profit: prevMonthStats.totalRevenue - prevMonthStats.totalExpenses
                },
                {
                    month: months[monthIndex].charAt(0).toUpperCase() + months[monthIndex].slice(1),
                    revenue: currentMonthStats.totalRevenue,
                    expenses: currentMonthStats.totalExpenses,
                    profit: currentMonthStats.totalRevenue - currentMonthStats.totalExpenses
                }
            ],
        };

        res.json(response);

    } catch (error) {
        console.error("Error generating monthly report:", error);
        res.status(500).json({ error: "Failed to generate monthly report" });
    }
});

module.exports = router; 