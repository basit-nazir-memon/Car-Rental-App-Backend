const express = require("express");
const router = express.Router();
const Customer = require("../models/Customer");
const auth = require("../middleware/auth");
const Booking = require("../models/Booking");

// Get all customers
router.get("/", auth, async (req, res) => {
    try {
        const customers = await Customer.find()
            .sort({ createdAt: -1 }); // Sort by newest first

        res.json(customers);
    } catch (error) {
        console.error("Error fetching customers:", error);
        res.status(500).json({ error: "Failed to fetch customers" });
    }
});

// Get customer by phone number or ID card (for search/autocomplete)
router.get("/search", auth, async (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query) {
            return res.status(400).json({ error: "Search query is required" });
        }

        const customers = await Customer.find({
            $or: [
                { phoneNumber: { $regex: query, $options: 'i' } },
                { idCardNumber: { $regex: query, $options: 'i' } },
                { fullName: { $regex: query, $options: 'i' } }
            ]
        }).limit(10);

        res.json(customers);
    } catch (error) {
        console.error("Error searching customers:", error);
        res.status(500).json({ error: "Failed to search customers" });
    }
});

// Add a new customer
router.post("/", auth, async (req, res) => {
    try {
        const { fullName, phoneNumber, idCardNumber } = req.body;

        // Validate required fields
        if (!fullName || !phoneNumber || !idCardNumber) {
            return res.status(400).json({ error: "All fields are required" });
        }

        // Check if customer already exists with same phone or ID card
        const existingCustomer = await Customer.findOne({
            $or: [
                { phoneNumber },
                { idCardNumber }
            ]
        });

        if (existingCustomer) {
            return res.status(400).json({ 
                error: "Customer already exists with this phone number or ID card number" 
            });
        }

        // Create new customer
        const newCustomer = new Customer({
            fullName,
            phoneNumber,
            idCardNumber
        });

        await newCustomer.save();

        res.status(201).json({
            message: "Customer added successfully",
            customer: newCustomer
        });

    } catch (error) {
        console.error("Error adding customer:", error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: "Failed to add customer" });
    }
});

// Get customer by ID
router.get("/:id", auth, async (req, res) => {
    try {
        const customer = await Customer.findById(req.params.id);
        
        if (!customer) {
            return res.status(404).json({ error: "Customer not found" });
        }

        res.json(customer);
    } catch (error) {
        console.error("Error fetching customer:", error);
        if (error.kind === 'ObjectId') {
            return res.status(400).json({ error: "Invalid customer ID" });
        }
        res.status(500).json({ error: "Failed to fetch customer" });
    }
});

// Get customer details with booking history
router.get("/:customerId/details", auth, async (req, res) => {
    try {
        const { customerId } = req.params;

        // Get customer details
        const customer = await Customer.findById(customerId);
        if (!customer) {
            return res.status(404).json({ error: "Customer not found" });
        }

        // Format customer data
        const customerData = {
            id: customer._id,
            name: customer.fullName,
            phone: customer.phoneNumber,
            idCard: customer.idCardNumber,
            email: customer.email || "",
            address: customer.address || "",
            joinDate: customer.createdAt.toISOString().split('T')[0],
            bookingCount: customer.bookingCount,
            lastBookingDate: customer.lastBookingDate
        };

        // Get customer's bookings with populated car and driver details
        const bookings = await Booking.find({
            $or: [
                { customerId: customer._id },
            ]
        })
        .populate({
            path: 'carId',
            select: 'model year registrationNumber'
        })
        .populate({
            path: 'driverId',
            select: 'name'
        })
        .sort({ startDate: -1 }); // Most recent bookings first

        // Format bookings data
        const customerBookings = bookings.map(booking => ({
            id: booking._id,
            carModel: booking.carId.model,
            carYear: booking.carId.year,
            registrationNumber: booking.carId.registrationNumber,
            driverName: booking.driverId.name,
            startDate: booking.startDate,
            endDate: booking.endDate,
            totalAmount: booking.totalBill * (100 - (booking.discountPercentage || 0)) / 100,
            status: booking.status,
            tripType: booking.tripType,
            cityName: booking.cityName,
            advancePaid: booking.advancePaid,
            remainingAmount: booking.totalBill - booking.advancePaid,
            discountPercentage: booking.discountPercentage || 0,
            meterReading: booking.meterReading
        }));

        // Calculate statistics
        const statistics = {
            totalBookings: customerBookings.length,
            totalSpent: customerBookings.reduce((sum, booking) => sum + booking.totalAmount, 0),
            completedBookings: customerBookings.filter(b => b.status === 'completed').length,
            activeBookings: customerBookings.filter(b => b.status === 'active').length,
            averageBookingAmount: customerBookings.length > 0 
                ? customerBookings.reduce((sum, booking) => sum + booking.totalAmount, 0) / customerBookings.length 
                : 0
        };

        res.json({
            customerData,
            customerBookings,
            statistics
        });

    } catch (error) {
        console.error("Error fetching customer details:", error);
        if (error.kind === 'ObjectId') {
            return res.status(400).json({ error: "Invalid customer ID" });
        }
        res.status(500).json({ error: "Failed to fetch customer details" });
    }
});

// Update customer details
router.patch("/:customerId", auth, async (req, res) => {
    try {
        const { customerId } = req.params;
        const { fullName, phoneNumber, idCardNumber, email, address } = req.body;

        // Find customer
        const customer = await Customer.findById(customerId);
        if (!customer) {
            return res.status(404).json({ error: "Customer not found" });
        }

        // Check if phone number or ID card is being changed and if it's already in use
        if (phoneNumber && phoneNumber !== customer.phoneNumber) {
            const existingCustomer = await Customer.findOne({ phoneNumber });
            if (existingCustomer) {
                return res.status(400).json({ error: "Phone number already in use" });
            }
            customer.phoneNumber = phoneNumber;
        }

        if (idCardNumber && idCardNumber !== customer.idCardNumber) {
            const existingCustomer = await Customer.findOne({ idCardNumber });
            if (existingCustomer) {
                return res.status(400).json({ error: "ID card number already in use" });
            }
            customer.idCardNumber = idCardNumber;
        }

        // Update other fields
        if (fullName) customer.fullName = fullName;
        if (email) customer.email = email;
        if (address) customer.address = address;

        await customer.save();

        res.json({
            message: "Customer details updated successfully",
            customer: {
                id: customer._id,
                name: customer.fullName,
                phone: customer.phoneNumber,
                idCard: customer.idCardNumber,
                email: customer.email,
                address: customer.address,
                joinDate: customer.createdAt.toISOString().split('T')[0],
                bookingCount: customer.bookingCount,
                lastBookingDate: customer.lastBookingDate
            }
        });

    } catch (error) {
        console.error("Error updating customer:", error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: "Failed to update customer" });
    }
});

module.exports = router; 