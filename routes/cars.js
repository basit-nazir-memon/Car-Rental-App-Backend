const express = require("express");
const Car = require("../models/Car");
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");
const router = express.Router();
const Booking = require("../models/Booking");
const User = require("../models/User");

// Add this route to get stakeholder's cars with statistics
router.get("/mine", auth, async (req, res) => {

    try {
        // Check if user is a stakeholder
        if (req.user.role !== 'stakeholder') {
            return res.status(403).json({
                error: "Only stakeholders can access their cars"
            });
        }

        // Get all cars owned by the stakeholder
        const cars = await Car.find({ user: req.user.id });

        // Get all completed bookings for these cars
        const carIds = cars.map(car => car._id);
        const bookings = await Booking.find({
            carId: { $in: carIds },
            status: 'completed'
        });

        // Get stakeholder's commission percentage
        const stakeholder = await User.findById(req.user.id);
        const commissionPercentage = stakeholder.commissionPercentage || 0;

        // Calculate statistics for each car
        const carsWithStats = await Promise.all(cars.map(async car => {
            // Get bookings for this specific car
            const carBookings = bookings.filter(booking =>
                booking.carId.toString() === car._id.toString()
            );

            // Calculate totals
            const totalBookings = carBookings.length;
            const totalRevenue = carBookings.reduce((sum, booking) =>
                sum + (booking.totalBill * (100 - (booking.discountPercentage || 0)) / 100), 0
            );

            // Calculate profit after commission
            const totalProfit = totalRevenue * ((100 - commissionPercentage) / 100);

            // Check if car is currently available
            const activeBooking = await Booking.findOne({
                carId: car._id,
                status: 'active'
            });

            return {
                id: car._id,
                model: car.model,
                year: car.year,
                color: car.color,
                registrationNumber: car.registrationNumber,
                chassisNumber: car.chassisNumber,
                engineNumber: car.engineNumber,
                image: car.image || "/placeholder.svg?height=200&width=300",
                available: !activeBooking,
                totalBookings,
                totalRevenue,
                totalProfit: Math.round(totalProfit) // Round to nearest integer
            };
        }));

        res.json({
            cars: carsWithStats,
        });

    } catch (error) {
        console.error("Error fetching stakeholder cars:", error);
        res.status(500).json({ error: "Failed to fetch cars data" });
    }
});

// Add a new car
router.post("/", auth, async (req, res) => {

    if (!(req.user.role === "admin" || req.user.role === "stakeholder")) {
        return res.status(403).json({ error: "Access denied" });
    }

    try {
        const { model, year, color, registrationNumber, chassisNumber, engineNumber, image } = req.body;
        if (!model || !year || !color || !registrationNumber || !chassisNumber || !engineNumber) {
            return res.status(400).json({ error: "All fields are required" });
        }

        const newCar = new Car({ model, year, color, registrationNumber, chassisNumber, engineNumber, image, user: req.user.id });
        await newCar.save();
        res.status(201).json(newCar);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

// Get all cars with optional date range filtering
router.get("/", auth, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let unavailableCarIds = new Set();

        // If date range is provided, check for unavailable cars
        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);

            // Validate dates if provided
            if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                if (start >= end) {
                    return res.status(400).json({ 
                        error: "Start date must be before end date" 
                    });
                }

                // Find overlapping bookings
                const overlappingBookings = await Booking.find({
                    $and: [
                        { startDate: { $lt: end } },
                        { endDate: { $gt: start } },
                        { status: { $in: ['active', 'pending'] } }
                    ]
                });

                unavailableCarIds = new Set(
                    overlappingBookings.map(booking => booking.carId.toString())
                );
            }
        }

        // Get all cars
        const cars = await Car.find( { deleted: false } ).populate('user', 'name commissionPercentage');

        // Get all completed bookings for statistics
        const completedBookings = await Booking.find({
            status: 'completed'
        });

        // Process cars with availability and statistics
        const processedCars = cars.map(car => {
            // Calculate car statistics
            const carBookings = completedBookings.filter(
                booking => booking.carId.toString() === car._id.toString()
            );

            const totalRevenue = carBookings.reduce(
                (sum, booking) => sum + booking.totalBill, 0
            );

            const isAvailable = !unavailableCarIds.has(car._id.toString());

            return {
                model: car.model,
                color: car.color.toLowerCase(),
                image: car.image || "/placeholder.svg?height=200&width=300",
                available: isAvailable,
                stats: {
                    totalBookings: carBookings.length,
                    totalRevenue
                }
            };
        });

        // Group cars by model
        const groupedCars = processedCars.reduce((acc, car) => {
            const existingModel = acc.find(item => item.name === car.model);

            if (existingModel) {
                // Add color if not already present
                if (!existingModel.availableColors.includes(car.color)) {
                    existingModel.availableColors.push(car.color);
                }
                existingModel.totalCount++;
                if (car.available) {
                    existingModel.availableCount++;
                }
            } else {
                // Create new model entry
                acc.push({
                    id: acc.length + 1,
                    name: car.model,
                    image: car.image,
                    availableColors: [car.color],
                    availableCount: car.available ? 1 : 0,
                    totalCount: 1,
                    stats: car.stats
                });
            }
            return acc;
        }, []);

        // Add search period info if dates were provided
        const response = {
            cars: groupedCars,
            summary: {
                totalModels: groupedCars.length,
                totalCars: cars.length,
                availableCars: cars.filter(car => 
                    !unavailableCarIds.has(car._id.toString())
                ).length
            }
        };

        if (startDate && endDate) {
            response.searchPeriod = {
                startDate,
                endDate,
                durationDays: Math.ceil(
                    (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)
                )
            };
        }

        res.json(response);

    } catch (err) {
        console.error(err);
        res.status(500).json({ 
            error: "Server error",
            details: err.message 
        });
    }
});

// Get cars by model name with optional date range filtering
router.get("/:modelName", auth, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let unavailableCarIds = new Set();

        // Convert url-friendly format (toyota-fortuner) to display format (Toyota Fortuner)
        const modelName = req.params.modelName
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');

        // Check for unavailable cars if date range is provided
        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);

            // Validate dates
            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                return res.status(400).json({ 
                    error: "Invalid date format. Please use ISO date format (YYYY-MM-DDTHH:mm:ss.sssZ)" 
                });
            }

            if (start >= end) {
                return res.status(400).json({ 
                    error: "Start date must be before end date" 
                });
            }

            // Find overlapping bookings
            const overlappingBookings = await Booking.find({
                $and: [
                    { startDate: { $lt: end } },
                    { endDate: { $gt: start } },
                    { status: { $in: ['active', 'pending'] } }
                ]
            });

            unavailableCarIds = new Set(
                overlappingBookings.map(booking => booking.carId.toString())
            );
        }

        // Get cars of the specified model
        const cars = await Car.find({ model: modelName, deleted: false })
            .populate('user', 'name commissionPercentage');

        if (cars.length === 0) {
            return res.status(404).json({ error: "No cars found with this model name" });
        }

        // Get completed bookings for statistics
        const completedBookings = await Booking.find({
            carId: { $in: cars.map(car => car._id) },
            status: 'completed'
        });

        // Process car instances with availability and statistics
        const carInstances = cars.map(car => {
            const carBookings = completedBookings.filter(
                booking => booking.carId.toString() === car._id.toString()
            );

            const totalRevenue = carBookings.reduce(
                (sum, booking) => sum + booking.totalBill, 0
            );

            const isAvailable = !unavailableCarIds.has(car._id.toString());

            return {
                id: car._id,
                color: car.color.toLowerCase(),
                registrationNumber: car.registrationNumber,
                chassisNumber: car.chassisNumber,
                engineNumber: car.engineNumber,
                year: car.year,
                available: isAvailable,
                image: car.image,
                owner: car.user?.name || 'N/A',
                stats: {
                    totalBookings: carBookings.length,
                    totalRevenue,
                    totalProfit: totalRevenue * ((100 - (car.user?.commissionPercentage || 0)) / 100)
                }
            };
        });

        // Format the response
        const carDetails = {
            id: 1,
            name: modelName,
            image: cars[0].image || "/placeholder.svg?height=200&width=300",
            availableColors: [...new Set(cars.map(car => car.color.toLowerCase()))],
            availableCount: carInstances.filter(car => car.available).length,
            totalCount: cars.length,
            instances: carInstances
        };

        // Add search period info if dates were provided
        const response = {
            ...carDetails,
            summary: {
                totalCars: cars.length,
                availableCars: carInstances.filter(car => car.available).length,
                unavailableCars: carInstances.filter(car => !car.available).length
            }
        };

        if (startDate && endDate) {
            response.searchPeriod = {
                startDate,
                endDate,
                durationDays: Math.ceil(
                    (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)
                )
            };
        }

        res.json(response);

    } catch (err) {
        console.error(err);
        res.status(500).json({ 
            error: "Server error",
            details: err.message 
        });
    }
});

// Add this new route to get a specific car by ID
router.get("/details/:carId", auth, async (req, res) => {
    try {
        const carId = req.params.carId;

        // Find the specific car
        const car = await Car.findById(carId);

        // Check if car exists
        if (!car) {
            return res.status(404).json({ error: "Car not found" });
        }

        // Format the response
        const carDetails = {
            id: car._id,
            model: car.model,
            year: car.year,
            color: car.color.toLowerCase(),
            registrationNumber: car.registrationNumber,
            chassisNumber: car.chassisNumber,
            engineNumber: car.engineNumber,
            image: car.image || "/placeholder.svg?height=200&width=300",
            createdAt: car.createdAt,
            updatedAt: car.updatedAt
        };

        res.json(carDetails);
    } catch (err) {
        console.error(err);
        if (err.kind === 'ObjectId') {
            return res.status(400).json({ error: "Invalid car ID format" });
        }
        res.status(500).json({ error: "Server error" });
    }
});

// Detailed car information route
router.get("/detailed/info/:id", auth, async (req, res) => {
    try {
        // Get car details with owner information
        const car = await Car.findById(req.params.id)
            .populate('user', 'commissionPercentage');

        if (!car) {
            return res.status(404).json({ error: "Car not found" });
        }

        // Check if user is authorized (admin or car owner)
        if (req.user.role !== 'admin' && car.user._id.toString() !== req.user.id) {
            return res.status(403).json({
                error: "You don't have permission to view this car's details"
            });
        }

        // Get all bookings for this car
        const bookings = await Booking.find({ carId: car._id })
            .populate('customerId', 'fullName')
            .populate('driverId', 'name')
            .sort({ startDate: -1 }); // Most recent first

        // Calculate financial metrics
        const completedBookings = bookings.filter(booking =>
            booking.status === 'completed'
        );

        const totalRevenue = completedBookings.reduce((sum, booking) =>
            sum + (booking.totalBill * (100 - (booking.discountPercentage || 0)) / 100), 0
        );

        const commission = car.user.commissionPercentage || 0;
        const commissionAmount = (totalRevenue * commission) / 100;
        const totalProfit = totalRevenue - commissionAmount;

        // Format bookings data
        const formattedBookings = bookings.map(booking => ({
            id: booking._id,
            customerName: booking.customerId?.fullName || 'N/A',
            driverName: booking.driverId?.name || 'Self Drive',
            startDate: booking.startDate,
            endDate: booking.endDate,
            totalAmount: (booking.totalBill * (100 - (booking.discountPercentage || 0)) / 100),
            status: booking.status
        }));

        // Get current car status
        const activeBooking = await Booking.findOne({
            carId: car._id,
            status: 'active'
        });

        // Calculate monthly statistics for the current year
        const currentYear = new Date().getFullYear();
        const monthlyStats = await Booking.aggregate([
            {
                $match: {
                    carId: car._id,
                    status: 'completed',
                    startDate: {
                        $gte: new Date(currentYear, 0, 1),
                        $lte: new Date(currentYear, 11, 31)
                    }
                }
            },
            {
                $group: {
                    _id: { $month: "$startDate" },
                    revenue: {
                        $sum: {
                            $multiply: [
                                "$totalBill",
                                {
                                    $divide: [
                                        { $subtract: [100, { $ifNull: ["$discountPercentage", 0] }] },
                                        100
                                    ]
                                }
                            ]
                        }
                    },
                }
            },

            {
                $sort: { _id: 1 }
            }
        ]);

        // Format response
        const response = {
            id: car._id,
            model: car.model,
            year: car.year,
            color: car.color,
            registrationNumber: car.registrationNumber,
            chassisNumber: car.chassisNumber,
            engineNumber: car.engineNumber,
            status: activeBooking ? 'booked' : 'available',
            image: car.image || "/placeholder.svg?height=400&width=600",
            financials: {
                totalRevenue,
                totalProfit,
                commission,
                commissionAmount
            },
            bookings: formattedBookings,
            monthlyStats: Array.from({ length: 12 }, (_, i) => {
                const monthData = monthlyStats.find(stat => stat._id === i + 1) ||
                    { revenue: 0, bookings: 0 };
                return {
                    month: new Date(2024, i, 1).toLocaleString('default', { month: 'short' }),
                    revenue: monthData.revenue
                };
            }),

        };

        res.json(response);

    } catch (error) {
        console.error("Error fetching car details:", error);
        res.status(500).json({ error: "Failed to fetch car details" });
    }
});

// Delete (deactivate) a car
router.delete("/:carId", auth, admin, async (req, res) => {
    try {
        const carId = req.params.carId;

        // Find the car
        const car = await Car.findById(carId);
        if (!car) {
            return res.status(404).json({ error: "Car not found" });
        }

        // Check for active or pending bookings
        const activeBooking = await Booking.findOne({
            carId: car._id,
            status: { $in: ['active', 'pending'] }
        });

        if (activeBooking) {
            return res.status(400).json({ error: "Car cannot be deleted because it is currently booked." });
        }

        // Mark the car as unavailable
        car.deleted = true;
        await car.save();

        res.json({
            message: "Car marked as unavailable successfully.",
            car: {
                id: car._id,
                model: car.model,
                registrationNumber: car.registrationNumber,
                deleted: car.deleted
            }
        });
    } catch (error) {
        console.error("Error deleting car:", error);
        res.status(500).json({ error: "Failed to delete car" });
    }
});

module.exports = router;
