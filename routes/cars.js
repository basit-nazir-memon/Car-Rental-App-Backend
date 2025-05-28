const express = require("express");
const Car = require("../models/Car");
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");
const router = express.Router();
const Booking = require("../models/Booking");
const User = require("../models/User");
const Expense = require("../models/Expense");
const PDFDocument = require('pdfkit');

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
            status: { $ne: 'active' }
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
                variant: car.variant,
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


router.get("/all", auth, admin, async (req, res) => {
    const cars = await Car.find();
    res.status(200).json(cars)
})

// Add a new car
router.post("/", auth, async (req, res) => {
    if (!(req.user.role === "admin" || req.user.role === "stakeholder")) {
        return res.status(403).json({ error: "Access denied" });
    }

    try {
        const { model, year, color, registrationNumber, chassisNumber, engineNumber, image, variant, ownerId } = req.body;
        if (!model || !year || !color || !registrationNumber || !chassisNumber || !engineNumber) {
            return res.status(400).json({ error: "All fields are required" });
        }

        console.log(req.body)

        // Create new car with variant
        const newCar = new Car({
            model,
            year,
            color,
            registrationNumber,
            chassisNumber,
            engineNumber,
            image,
            variant: variant || '', // Set empty string as default if not provided
            user: ownerId ? ownerId : req.user.id
        });

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
        const cars = await Car.find({ deleted: false }).populate('user', 'name commissionPercentage');

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
                variant: car.variant,
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
                variant: car.variant,
                owner: car.user?.name || 'N/A',
                totalBookings: carBookings.length,
                totalRevenue: totalRevenue,
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

        console.log(response);

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
            variant: car.variant,
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
            .populate('user', 'name commissionPercentage');

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


        const totalRevenue = bookings.filter(b => b.status !== "cancelled").reduce((sum, booking) =>
            sum + (booking.totalBill * (100 - (booking.discountPercentage || 0)) / 100), 0
        );

        const commission = car.user.commissionPercentage || 0;
        const commissionAmount = (totalRevenue * commission) / 100;

        // Get expenses for this car
        const expenses = await Expense.find({ carId: car._id })
            .sort({ date: -1 });

        const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);

        const totalProfit = totalRevenue - commissionAmount - totalExpenses;

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
                    status: { $ne: 'cancelled' },
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
            variant: car.variant,
            registrationNumber: car.registrationNumber,
            chassisNumber: car.chassisNumber,
            engineNumber: car.engineNumber,
            status: activeBooking ? 'booked' : 'available',
            image: car.image || "/placeholder.svg?height=400&width=600",
            user: car.user.name,
            financials: {
                totalRevenue,
                totalProfit,
                commission,
                commissionAmount,
                totalExpenses
            },
            bookings: formattedBookings,
            expenses: expenses.map(expense => ({
                id: expense._id,
                title: expense.title,
                description: expense.description,
                amount: expense.amount,
                date: expense.date.toISOString().split('T')[0],
                category: expense.category
            })),
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

// Add download route for cars data
router.get("/download", auth, async (req, res) => {
    try {
        const cars = await Car.find({ deleted: false })
            .populate('user', 'name commissionPercentage');

        // Get all completed bookings for statistics
        const completedBookings = await Booking.find({
            status: 'completed'
        });

        // Process cars with availability and statistics
        const processedCars = cars.map(car => {
            const carBookings = completedBookings.filter(
                booking => booking.carId.toString() === car._id.toString()
            );

            const totalRevenue = carBookings.reduce(
                (sum, booking) => sum + booking.totalBill, 0
            );

            return {
                model: car.model,
                year: car.year,
                color: car.color,
                variant: car.variant || 'N/A',
                registrationNumber: car.registrationNumber,
                chassisNumber: car.chassisNumber,
                engineNumber: car.engineNumber,
                owner: car.user?.name || 'N/A',
                totalBookings: carBookings.length,
                totalRevenue: totalRevenue.toFixed(2),
                totalProfit: (totalRevenue * ((100 - (car.user?.commissionPercentage || 0)) / 100)).toFixed(2)
            };
        });

        // Create HTML content with inline styles
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Cars Report</title>
                <style>
                    @media print {
                        .page-break {
                            page-break-before: always;
                        }
                    }
                    body { 
                        font-family: Arial, sans-serif; 
                        margin: 20px;
                        font-size: 12px;
                    }
                    table { 
                        width: 100%; 
                        border-collapse: collapse; 
                        margin-top: 20px;
                    }
                    th, td { 
                        border: 1px solid #000; 
                        padding: 8px; 
                        text-align: left;
                        font-size: 12px;
                    }
                    th { 
                        background-color: #f5f5f5;
                        font-weight: bold;
                    }
                    .header { 
                        text-align: center; 
                        margin-bottom: 20px;
                    }
                    .summary { 
                        margin: 20px 0; 
                        padding: 10px; 
                        background-color: #f5f5f5;
                    }
                    .page-title {
                        font-size: 16px;
                        font-weight: bold;
                        margin-bottom: 15px;
                    }
                </style>
            </head>
            <body>
                <!-- First Page - Car Details -->
                <div class="header">
                    <h1>Cars Report</h1>
                    <p>Generated on: ${new Date().toLocaleString()}</p>
                </div>
                <div class="page-title">Car Details</div>
                <table>
                    <thead>
                        <tr>
                            <th>Model</th>
                            <th>Year</th>
                            <th>Color</th>
                            <th>Variant</th>
                            <th>Registration</th>
                            <th>Chassis</th>
                            <th>Engine</th>
                            <th>Owner</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${processedCars.map(car => `
                            <tr>
                                <td>${car.model}</td>
                                <td>${car.year}</td>
                                <td>${car.color}</td>
                                <td>${car.variant}</td>
                                <td>${car.registrationNumber}</td>
                                <td>${car.chassisNumber}</td>
                                <td>${car.engineNumber}</td>
                                <td>${car.owner}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <!-- Second Page - Financial Details -->
                <div class="page-break"></div>
                <div class="header">
                    <h1>Cars Report</h1>
                    <p>Generated on: ${new Date().toLocaleString()}</p>
                </div>
                <div class="page-title">Financial Details</div>
                <table>
                    <thead>
                        <tr>
                            <th>Model</th>
                            <th>Registration</th>
                            <th>Total Bookings</th>
                            <th>Total Revenue</th>
                            <th>Total Profit</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${processedCars.map(car => `
                            <tr>
                                <td>${car.model}</td>
                                <td>${car.registrationNumber}</td>
                                <td>${car.totalBookings}</td>
                                <td>${car.totalRevenue}</td>
                                <td>${car.totalProfit}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <div class="summary">
                    <h3>Summary</h3>
                    <p>Total Cars: ${cars.length}</p>
                    <p>Total Revenue: ${processedCars.reduce((sum, car) => sum + parseFloat(car.totalRevenue), 0).toFixed(2)}</p>
                    <p>Total Profit: ${processedCars.reduce((sum, car) => sum + parseFloat(car.totalProfit), 0).toFixed(2)}</p>
                </div>
            </body>
            </html>
        `;

        // Set headers for file download
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', 'attachment; filename=cars-report.html');

        res.send(htmlContent);
    } catch (error) {
        console.error("Error generating cars report:", error);
        res.status(500).json({ error: "Failed to generate cars report" });
    }
});

// Add detailed car report route
router.get("/report/:carId", auth, async (req, res) => {
    try {
        const carId = req.params.carId;

        // Get car details
        const car = await Car.findById(carId)
            .populate('user', 'name commissionPercentage');

        if (!car) {
            return res.status(404).json({ error: "Car not found" });
        }

        // Calculate date range (last 6 months)
        const endDate = new Date();
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 6);

        // Get bookings for the car
        const bookings = await Booking.find({
            carId: carId,
            startDate: { $gte: startDate }
        }).populate('customerId', 'fullName');

        // Get expenses for the car
        const expenses = await Expense.find({
            carId: carId,
            date: { $gte: startDate }
        });

        // Calculate total revenue and expenses
        const totalRevenue = bookings.filter((booking) => booking.status !== "cancelled")
            .reduce((sum, booking) =>
                sum + (booking.totalBill * (100 - (booking.discountPercentage || 0)) / 100), 0);

        const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
        const netProfit = totalRevenue - totalExpenses;

        // Calculate utilization rate
        const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
        const bookedDays = bookings.reduce((sum, booking) => {
            if (booking.status === 'completed' || booking.status === 'active') {
                const bookingDays = Math.ceil(
                    (new Date(booking.endDate) - new Date(booking.startDate)) /
                    (1000 * 60 * 60 * 24)
                );
                return sum + bookingDays;
            }
            return sum;
        }, 0);
        const utilizationRate = Math.round((bookedDays / totalDays) * 100);

        // Calculate average booking duration
        const completedBookings = bookings.filter(b => b.status === 'completed');
        const averageBookingDuration = completedBookings.length > 0
            ? Math.round(completedBookings.reduce((sum, booking) => {
                const duration = Math.ceil(
                    (new Date(booking.endDate) - new Date(booking.startDate)) /
                    (1000 * 60 * 60 * 24)
                );
                return sum + duration;
            }, 0) / completedBookings.length)
            : 0;

        // Format booking history
        const bookingHistory = bookings.map(booking => ({
            id: booking._id,
            customerName: booking.customerId?.fullName || 'N/A',
            startDate: booking.startDate.toISOString().split('T')[0],
            endDate: booking.endDate.toISOString().split('T')[0],
            amount: booking.totalBill * (100 - (booking.discountPercentage || 0)) / 100,
            status: booking.status.charAt(0).toUpperCase() + booking.status.slice(1)
        }));

        // Format expenses
        const formattedExpenses = expenses.map(expense => ({
            id: expense._id,
            title: expense.title,
            amount: expense.amount,
            date: expense.date.toISOString().split('T')[0],
            category: expense.category
        }));

        // Calculate monthly revenue and bookings
        const monthlyData = {};
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        // Initialize monthly data
        months.forEach(month => {
            monthlyData[month] = { revenue: 0, bookings: 0 };
        });

        // Calculate monthly revenue
        bookings.filter((booking) => booking.status !== "cancelled").forEach(booking => {
            const month = months[new Date(booking.startDate).getMonth()];
            monthlyData[month].revenue += booking.totalBill * (100 - (booking.discountPercentage || 0)) / 100;
            monthlyData[month].bookings += 1;
        });

        // Get last 6 months of data
        const currentMonth = new Date().getMonth();
        const monthlyRevenue = [];
        const monthlyBookings = [];

        for (let i = 5; i >= 0; i--) {
            const monthIndex = (currentMonth - i + 12) % 12;
            const month = months[monthIndex];
            monthlyRevenue.push({ month, revenue: monthlyData[month].revenue });
            monthlyBookings.push({ month, bookings: monthlyData[month].bookings });
        }

        // Prepare the response
        const report = {
            id: car._id,
            model: car.model,
            variant: car.variant || 'N/A',
            registrationNumber: car.registrationNumber,
            year: car.year,
            color: car.color,
            chassisNumber: car.chassisNumber,
            engineNumber: car.engineNumber,
            totalBookings: bookings.filter(b => b.status != "cancelled").length,
            totalRevenue: Math.round(totalRevenue),
            totalExpenses: Math.round(totalExpenses),
            netProfit: Math.round(netProfit),
            utilizationRate,
            averageBookingDuration,
            bookingHistory,
            expenses: formattedExpenses,
            monthlyRevenue,
            monthlyBookings
        };

        res.json(report);

    } catch (error) {
        console.error("Error generating car report:", error);
        res.status(500).json({ error: "Failed to generate car report" });
    }
});

// Add detailed car PDF report route
router.get("/report/pdf/:carId", auth, async (req, res) => {
    try {
        const carId = req.params.carId;

        // Get car details with owner information
        const car = await Car.findById(carId)
            .populate('user', 'name commissionPercentage');

        if (!car) {
            return res.status(404).json({ error: "Car not found" });
        }

        // Get all bookings for this car
        const bookings = await Booking.find({ carId: car._id })
            .populate('customerId', 'fullName')
            .populate('driverId', 'name')
            .sort({ startDate: -1 });


        const totalRevenue = bookings.filter(b => b.status !== "cancelled").reduce((sum, booking) =>
            sum + (booking.totalBill * (100 - (booking.discountPercentage || 0)) / 100), 0
        );

        const commission = car.user.commissionPercentage || 0;
        const commissionAmount = (totalRevenue * commission) / 100;
        
        // Get expenses for this car
        const expenses = await Expense.find({ carId: car._id })
            .sort({ date: -1 });

        const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);

        const totalProfit = totalRevenue - commissionAmount - totalExpenses;

        // Format bookings data
        const formattedBookings = bookings.map(booking => ({
            customerName: booking.customerId?.fullName || 'N/A',
            driverName: booking.driverId?.name || 'Self Drive',
            startDate: booking.startDate.toLocaleDateString(),
            endDate: booking.endDate.toLocaleDateString(),
            totalAmount: (booking.totalBill * (100 - (booking.discountPercentage || 0)) / 100).toFixed(2),
            status: booking.status.charAt(0).toUpperCase() + booking.status.slice(1)
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
                    status: {$ne: 'cancelled'},
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

        // Create PDF document
        const doc = new PDFDocument({
            size: 'A4',
            margin: 50,
            info: {
                Title: `${car.model} - Detailed Report`,
                Author: 'Car Rental System'
            }
        });

        // Handle errors in the PDF generation
        doc.on('error', (err) => {
            console.error('PDF Generation Error:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: "Failed to generate PDF report" });
            }
        });

        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${car.model}-report.pdf`);

        // Pipe the PDF to the response
        doc.pipe(res);

        // Add company logo or header
        doc.fontSize(24)
            .fillColor('#2c3e50')
            .text('Car Rental System', { align: 'center' })
            .moveDown();

        // Add report title
        doc.fontSize(20)
            .fillColor('#34495e')
            .text(`${car.model} - Detailed Report`, { align: 'center' })
            .moveDown(2);

        // Add car details section
        doc.fontSize(16)
            .fillColor('#2c3e50')
            .text('Vehicle Information', { underline: true })
            .moveDown();

        // Car details in a table format
        const carDetails = [
            ['Model', car.model],
            ['Year', car.year],
            ['Color', car.color],
            ['Variant', car.variant || 'N/A'],
            ['Registration Number', car.registrationNumber],
            ['Chassis Number', car.chassisNumber],
            ['Engine Number', car.engineNumber],
            ['Current Status', activeBooking ? 'Booked' : 'Available'],
            ['Owner', car.user.name]
        ];

        // Draw car details table
        let y = doc.y;
        carDetails.forEach(([label, value]) => {
            doc.fontSize(12)
                .fillColor('#7f8c8d')
                .text(label + ':', 50, y)
                .fillColor('#2c3e50')
                .text(value, 200, y);
            y += 20;
        });

        doc.moveDown(2);

        // Add financial summary section
        doc.fontSize(16)
            .fillColor('#2c3e50')
            .text('Financial Summary', { underline: true })
            .moveDown();

        const financialDetails = [
            ['Total Revenue', `Rs.${totalRevenue.toFixed(2)}`],
            ['Commission Rate', `${commission}%`],
            ['Commission Amount', `Rs.${commissionAmount.toFixed(2)}`],
            ['Total Profit', `Rs.${totalProfit.toFixed(2)}`]
        ];

        // Draw financial details table
        y = doc.y;
        financialDetails.forEach(([label, value]) => {
            doc.fontSize(12)
                .fillColor('#7f8c8d')
                .text(label + ':', 50, y)
                .fillColor('#2c3e50')
                .text(value, 200, y);
            y += 20;
        });

        doc.moveDown(2);

        // Add monthly revenue chart
        doc.fontSize(16)
            .fillColor('#2c3e50')
            .text('Monthly Revenue', { underline: true })
            .moveDown();

        // Draw monthly revenue table
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        y = doc.y;
        months.forEach((month, index) => {
            const monthData = monthlyStats.find(stat => stat._id === index + 1) || { revenue: 0 };
            doc.fontSize(10)
                .fillColor('#7f8c8d')
                .text(month + ':', 50, y)
                .fillColor('#2c3e50')
                .text(`Rs.${monthData.revenue.toFixed(2)}`, 200, y);
            y += 15;
        });

        doc.moveDown(2);


        // Add recent bookings section
        doc.fontSize(16)
            .fillColor('#2c3e50')
            .text('Recent Bookings', { underline: true })
            .moveDown();

        // Draw bookings table header
        const tableTop = doc.y;
        const tableHeaders = ['Customer', 'Driver', 'Start Date', 'End Date', 'Amount', 'Status'];
        const columnWidths = [100, 80, 80, 80, 80, 60];
        let x = 50;

        // Draw table headers
        tableHeaders.forEach((header, i) => {
            doc.fontSize(10)
                .fillColor('#7f8c8d')
                .text(header, x, tableTop);
            x += columnWidths[i];
        });

        // Draw table rows
        let rowY = tableTop + 20;
        formattedBookings.slice(0, 10).forEach(booking => {
            x = 50;
            doc.fontSize(9)
                .fillColor('#2c3e50')
                .text(booking.customerName, x, rowY, { width: columnWidths[0] });
            x += columnWidths[0];
            doc.text(booking.driverName, x, rowY, { width: columnWidths[1] });
            x += columnWidths[1];
            doc.text(booking.startDate, x, rowY, { width: columnWidths[2] });
            x += columnWidths[2];
            doc.text(booking.endDate, x, rowY, { width: columnWidths[3] });
            x += columnWidths[3];
            doc.text(booking.totalAmount, x, rowY, { width: columnWidths[4] });
            x += columnWidths[4];
            doc.text(booking.status, x, rowY, { width: columnWidths[5] });
            rowY += 15;
        });

        // Add footer with page numbers
        const addPageNumbers = () => {
            const pages = doc.bufferedPageRange();
            for (let i = pages.start; i < pages.start + pages.count; i++) {
                doc.switchToPage(i);
                doc.fontSize(10)
                    .fillColor('#7f8c8d')
                    .text(
                        `Page ${i} of ${pages.count}`,
                        50,
                        doc.page.height - 100,
                        { align: 'center' }
                    );
            }
        };

        // Add page numbers and finalize
        // addPageNumbers();
        doc.end();

    } catch (error) {
        console.error("Error generating PDF report:", error);
        if (!res.headersSent) {
            res.status(500).json({ error: "Failed to generate PDF report" });
        }
    }
});

module.exports = router;
