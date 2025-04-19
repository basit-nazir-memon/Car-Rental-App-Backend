const express = require("express");
const router = express.Router();
const Booking = require("../models/Booking");
const Car = require("../models/Car");
const Customer = require("../models/Customer");
const Expense = require("../models/Expense");
const auth = require("../middleware/auth");

// Get dashboard data
router.get("/", auth, async (req, res) => {
    try {
        // Get current date and last month's date
        const now = new Date();
        const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

        // Get current month's revenue and bookings
        const currentMonthBookings = await Booking.find({
            startDate: { $gte: currentMonth }
        });

        // Get last month's revenue and bookings
        const lastMonthBookings = await Booking.find({
            startDate: { 
                $gte: lastMonth,
                $lte: lastMonthEnd
            }
        });

        // Calculate revenues
        const currentRevenue = currentMonthBookings.reduce((sum, booking) => 
            sum + booking.totalBill * (100 - (booking.discountPercentage || 0)) / 100, 0);
        const lastMonthRevenue = lastMonthBookings.reduce((sum, booking) => 
            sum + booking.totalBill * (100 - (booking.discountPercentage || 0)) / 100, 0);

        // Get active bookings count
        const activeBookings = await Booking.countDocuments({ status: 'active' });
        const lastMonthActiveBookings = await Booking.countDocuments({
            status: 'active',
            startDate: { 
                $gte: lastMonth,
                $lte: lastMonthEnd
            }
        });

        // Get available cars
        const totalCars = await Car.countDocuments();
        const bookedCars = await Booking.distinct('carId', { status: 'active' });
        const availableCars = totalCars - bookedCars.length;

        const lastMonthBookedCars = await Booking.distinct('carId', {
            status: 'active',
            startDate: { 
                $gte: lastMonth,
                $lte: lastMonthEnd
            }
        });
        const lastMonthAvailableCars = totalCars - lastMonthBookedCars.length;

        // Get customer counts
        const currentCustomers = await Customer.countDocuments();
        const lastMonthCustomers = await Customer.countDocuments({
            createdAt: { 
                $lte: lastMonthEnd
            }
        });

        // Get last 6 months revenue data
        const last6Months = Array.from({ length: 6 }, (_, i) => {
            const date = new Date();
            date.setMonth(date.getMonth() - i);
            return {
                start: new Date(date.getFullYear(), date.getMonth(), 1),
                end: new Date(date.getFullYear(), date.getMonth() + 1, 0),
                month: date.toLocaleString('default', { month: 'short' })
            };
        }).reverse();

        const revenueData = await Promise.all(last6Months.map(async (month) => {
            const monthlyBookings = await Booking.find({
                startDate: { $gte: month.start, $lte: month.end }
            });
            const monthlyExpenses = await Expense.find({
                date: { $gte: month.start, $lte: month.end }
            });

            return {
                month: month.month,
                revenue: monthlyBookings.reduce((sum, booking) => 
                    sum + booking.totalBill * (100 - (booking.discountPercentage || 0)) / 100, 0),
                expenses: monthlyExpenses.reduce((sum, expense) => 
                    sum + expense.amount, 0)
            };
        }));

        // Get recent bookings
        const recentBookings = await Booking.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .populate([
                { path: 'carId', select: 'model' },
                { path: 'customerId', select: 'fullName' }
            ]);

        // Calculate percentage changes
        const calculatePercentChange = (current, previous) => {
            if (previous === 0) return current > 0 ? "+100%" : "0%";
            const change = ((current - previous) / previous) * 100;
            return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
        };

        // Format response
        const response = {
            stats: {
                totalRevenue: currentRevenue,
                revenueSubText: `${calculatePercentChange(currentRevenue, lastMonthRevenue)} from last month`,
                activeBookings: activeBookings,
                activeSubtext: `${activeBookings - lastMonthActiveBookings > 0 ? '+' : ''}${activeBookings - lastMonthActiveBookings} from last month`,
                availableCars: availableCars,
                carsSubText: `${availableCars - lastMonthAvailableCars > 0 ? '+' : ''}${availableCars - lastMonthAvailableCars} from last month`,
                totalCustomers: currentCustomers,
                customerSubText: `${currentCustomers - lastMonthCustomers > 0 ? '+' : ''}${currentCustomers - lastMonthCustomers} from last month`
            },
            revenueData: revenueData,
            recentBookings: recentBookings.map(booking => ({
                id: booking._id,
                carModel: booking.carId.model,
                customerName: booking.customerId.fullName,
                startDate: booking.startDate.toISOString().split('T')[0],
                endDate: booking.endDate.toISOString().split('T')[0],
                amount: booking.totalBill * (100 - (booking.discountPercentage || 0)) / 100,
                status: booking.status
            }))
        };

        res.json(response);

    } catch (error) {
        console.error("Error fetching dashboard data:", error);
        res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
});

module.exports = router; 