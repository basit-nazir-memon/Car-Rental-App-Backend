const express = require("express");
const router = express.Router();
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const auth = require("../middleware/auth");
const Car = require("../models/Car");
const Booking = require("../models/Booking");
const Expense = require("../models/Expense");

// Add new stakeholder
router.post("/", auth, async (req, res) => {
    try {
        const {
            fullName,
            idCardNumber,
            email,
            cellPhone,
            commissionPercentage,
            avatar
        } = req.body;

        // Validate required fields
        if (!fullName || !idCardNumber || !email || !cellPhone || !commissionPercentage) {
            return res.status(400).json({ 
                error: "All fields are required" 
            });
        }

        // Validate email format
        if (!/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(email)) {
            return res.status(400).json({ 
                error: "Invalid email format" 
            });
        }

        // Validate phone number (11 digits)
        if (!/^\d{11}$/.test(cellPhone)) {
            return res.status(400).json({ 
                error: "Invalid phone number format. Please enter 11 digits" 
            });
        }

        // Validate commission percentage
        if (commissionPercentage < 0 || commissionPercentage > 100) {
            return res.status(400).json({ 
                error: "Commission percentage must be between 0 and 100" 
            });
        }

        // Check if user already exists
        const existingUser = await User.findOne({
            $or: [
                { email },
                { idNumber: idCardNumber },
                { phone: cellPhone }
            ]
        });

        if (existingUser) {
            return res.status(400).json({ 
                error: "A user with this email, CNIC, or phone number already exists" 
            });
        }

        // Generate a random password for the stakeholder
        const randomPassword = "Abcd1234@";
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(randomPassword, salt);

        // Create new stakeholder
        const newStakeholder = new User({
            name: fullName,
            idNumber: idCardNumber,
            email,
            phone: cellPhone,
            commissionPercentage,
            avatar: avatar || undefined, // Use default if not provided
            password: hashedPassword,
            role: "stakeholder",
            age: 0, // Required field, can be updated later
            address: "To be updated" // Required field, can be updated later
        });

        await newStakeholder.save();

        // Remove password from response
        const stakeholderResponse = newStakeholder.toObject();
        delete stakeholderResponse.password;

        res.status(201).json({
            message: "Stakeholder registered successfully",
            stakeholder: stakeholderResponse,
        });

    } catch (error) {
        console.error("Error registering stakeholder:", error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: "Failed to register stakeholder" });
    }
});

// Get all stakeholders
router.get("/", auth, async (req, res) => {
    try {
        const stakeholders = await User.find({ role: "stakeholder" })
            .select('-password')  // Exclude password
            .sort({ createdAt: -1 });

        res.json(stakeholders);
    } catch (error) {
        console.error("Error fetching stakeholders:", error);
        res.status(500).json({ error: "Failed to fetch stakeholders" });
    }
});

// Get detailed stakeholder information
router.get("/details/:id", auth, async (req, res) => {
    try {
        // Get stakeholder details
        const stakeholder = await User.findById(req.params.id)
            .select('-password');

        if (!stakeholder) {
            return res.status(404).json({ error: "Stakeholder not found" });
        }

        // Get all cars owned by the stakeholder
        const cars = await Car.find({ user: stakeholder._id });

        // Get all bookings for these cars
        const carIds = cars.map(car => car._id);
        const bookings = await Booking.find({
            carId: { $in: carIds }
        }).populate('carId', 'model registrationNumber');

        // Get all expenses for these cars
        const expenses = await Expense.find({
            carId: { $in: carIds }
        });

        // Calculate financial metrics for each car
        const carsWithStats = await Promise.all(cars.map(async car => {
            const carBookings = bookings.filter(booking => 
                booking.carId._id.toString() === car._id.toString()
            );

            const completedBookings = carBookings.filter(booking => 
                booking.status === 'completed'
            );

            const totalRevenue = completedBookings.reduce((sum, booking) =>
                sum + (booking.totalBill * (100 - (booking.discountPercentage || 0)) / 100), 0
            );

            const carExpenses = expenses.filter(expense =>
                expense.carId.toString() === car._id.toString()
            );

            const totalExpenses = carExpenses.reduce((sum, expense) => 
                sum + expense.amount, 0
            );

            const commissionAmount = (totalRevenue * stakeholder.commissionPercentage) / 100;
            const totalProfit = totalRevenue - commissionAmount - totalExpenses;

            return {
                id: car._id,
                model: car.model,
                year: car.year,
                color: car.color,
                variant: car.variant,
                registrationNumber: car.registrationNumber,
                image: car.image || "/placeholder.svg?height=200&width=300",
                stats: {
                    totalBookings: carBookings.length,
                    completedBookings: completedBookings.length,
                    totalRevenue,
                    totalExpenses,
                    commissionAmount,
                    totalProfit
                }
            };
        }));

        // Calculate overall statistics
        const totalRevenue = carsWithStats.reduce((sum, car) => 
            sum + car.stats.totalRevenue, 0
        );

        const totalExpenses = carsWithStats.reduce((sum, car) => 
            sum + car.stats.totalExpenses, 0
        );

        const totalCommission = carsWithStats.reduce((sum, car) => 
            sum + car.stats.commissionAmount, 0
        );

        const totalProfit = carsWithStats.reduce((sum, car) => 
            sum + car.stats.totalProfit, 0
        );

        const totalBookings = carsWithStats.reduce((sum, car) => 
            sum + car.stats.totalBookings, 0
        );

        const completedBookings = carsWithStats.reduce((sum, car) => 
            sum + car.stats.completedBookings, 0
        );

        // Format response
        const response = {
            stakeholder: {
                id: stakeholder._id,
                name: stakeholder.name,
                email: stakeholder.email,
                phone: stakeholder.phone,
                commissionPercentage: stakeholder.commissionPercentage,
                avatar: stakeholder.avatar
            },
            overview: {
                totalCars: cars.length,
                totalBookings,
                completedBookings,
                totalRevenue,
                totalExpenses,
                totalCommission,
                totalProfit
            },
            cars: carsWithStats
        };

        res.json(response);

    } catch (error) {
        console.error("Error fetching stakeholder details:", error);
        res.status(500).json({ error: "Failed to fetch stakeholder details" });
    }
});

module.exports = router; 