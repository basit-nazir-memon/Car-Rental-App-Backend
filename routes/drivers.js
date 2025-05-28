const express = require("express");
const User = require("../models/User");
const Driver = require("../models/Driver");
const Booking = require("../models/Booking");
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");
const router = express.Router();

// GET all drivets
router.get("/", async (req, res) => {
    try {
        const drivers = await Driver.find();

        const formatedDrivers = drivers.map((driver, index) => ({
            id: driver._id,
            name: driver.name,
            idCard: driver.idNumber,
            address: driver.address,
            lisenceNumber: driver.lisenceNumber,
            phone: driver.phone,
            emergencyPhone: driver.emergencyPhone,
            dateOfJoining: driver.createdAt.toISOString().split("T")[0], // Format date
            status: driver.available ? "available" : "not available",
            image: driver.avatar,
        }));

        res.json(formatedDrivers);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch drivers" });
    }
});

// POST: Add a new employee
router.post("/", async (req, res) => {
    try {
        const { name, lisenceNumber, idCard, address, phone, image, emergencyPhone } = req.body;

        if (!name || !lisenceNumber || !idCard || !address || !phone || !emergencyPhone) {
            return res.status(400).json({ error: "All fields are required" });
        }

        const newUser = new Driver({
            name,
            lisenceNumber,
            idNumber: idCard,
            address,
            phone,
            emergencyPhone,
            avatar: image || undefined, // If no image provided, default will be used
        });

        await newUser.save();
        res.status(201).json({ message: "Driver added successfully" });
    } catch (error) {
        res.status(500).json({ error: "Failed to add driver" });
    }
});

// Add this new route to get driver names and IDs
router.get("/names", async (req, res) => {
    try {
        const drivers = await Driver.find({}, '_id name'); // Only fetch _id and name fields

        const driversList = drivers.map(driver => ({
            id: driver._id,
            name: driver.name
        }));

        res.json(driversList);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch drivers list" });
    }
});

// Add this new route to get available drivers for a date range
router.get("/available", async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        // Validate date parameters
        if (!startDate || !endDate) {
            return res.status(400).json({ error: "Start date and end date are required" });
        }

        // Convert string dates to Date objects
        const start = new Date(startDate);
        const end = new Date(endDate);

        // Validate date values
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ error: "Invalid date format" });
        }

        if (start >= end) {
            return res.status(400).json({ error: "End date must be after start date" });
        }

        // Find all bookings that overlap with the requested date range
        const busyDriverIds = await Booking.distinct('driverId', {
            status: 'active',
            $or: [
                {
                    startDate: { $lte: end },
                    endDate: { $gte: start }
                }
            ]
        });

        // Find all drivers that are not in the busy drivers list and are available
        const availableDrivers = await Driver.find({
            _id: { $nin: busyDriverIds },
            available: true,
        }, '_id name');

        // Format the response
        const driversList = availableDrivers.map(driver => ({
            id: driver._id,
            name: driver.name
        }));

        res.json(driversList);

    } catch (error) {
        console.error("Error fetching available drivers:", error);
        res.status(500).json({ error: "Failed to fetch available drivers" });
    }
});

// Delete/Deactivate driver (Admin only)
router.delete("/:driverId", auth, admin, async (req, res) => {
    try {
        const { driverId } = req.params;

        // Find driver
        const driver = await Driver.findById(driverId);
        if (!driver) {
            return res.status(404).json({ error: "Driver not found" });
        }

        // Check for active or pending bookings
        const activeBookings = await Booking.find({
            driverId: driverId,
            status: { $in: ['active', 'pending'] }
        });

        if (activeBookings.length > 0) {
            return res.status(400).json({ 
                error: "Cannot delete driver with active or pending bookings" 
            });
        }

        // Instead of deleting, mark as unavailable
        driver.available = false;
        await driver.save();

        res.json({
            message: "Driver deactivated successfully",
            driver: {
                id: driver._id,
                name: driver.name,
                phone: driver.phone,
                status: "not available",
                deactivatedAt: new Date()
            }
        });

    } catch (error) {
        console.error("Error deactivating driver:", error);
        res.status(500).json({ error: "Failed to deactivate driver" });
    }
});

module.exports = router;
