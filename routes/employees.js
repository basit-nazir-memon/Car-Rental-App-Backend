const express = require("express");
const User = require("../models/User");
const router = express.Router();
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");
const bcrypt = require("bcryptjs");
const Booking = require("../models/Booking");

// GET all employees
router.get("/", async (req, res) => {
    try {
        const employees = await User.find({ role: "employee" });

        const formattedEmployees = employees.map((employee, index) => ({
            id: employee._id,
            name: employee.name,
            idCard: employee.idNumber,
            address: employee.address,
            email: employee.email,
            age: employee.age,
            dateOfJoining: employee.createdAt.toISOString().split("T")[0], // Format date
            status: employee.blocked ? "inactive" : "active",
            image: employee.avatar,
        }));

        res.json(formattedEmployees);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch employees" });
    }
});

// POST: Add a new employee
router.post("/", async (req, res) => {
    try {
        const { name, email, password, idCard, address, age, profilePicture } = req.body;

        if (!name || !email || !password || !idCard || !address || !age) {
            return res.status(400).json({ error: "All fields are required" });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const newPassword = await bcrypt.hash(password, salt);

        const newUser = new User({
            name,
            email,
            password: newPassword,
            idNumber: idCard,
            address,
            age,
            role: "employee",
            avatar: profilePicture || undefined, // If no image provided, default will be used
        });

        await newUser.save();
        res.status(201).json({ message: "Employee added successfully" });
    } catch (error) {
        res.status(500).json({ error: "Failed to add employee" });
    }
});

// Change employee password (Admin only)
router.patch("/:employeeId/password", auth, admin, async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { newPassword } = req.body;

        // Validate request
        if (!newPassword) {
            return res.status(400).json({ error: "New password is required" });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ 
                error: "Password must be at least 6 characters long" 
            });
        }

        // Find employee
        const employee = await User.findOne({ 
            _id: employeeId,
            role: "employee"
        });

        if (!employee) {
            return res.status(404).json({ error: "Employee not found" });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        employee.password = await bcrypt.hash(newPassword, salt);

        // Save updated employee
        await employee.save();

        res.json({
            message: "Employee password updated successfully",
            employee: {
                id: employee._id,
                name: employee.name,
                email: employee.email
            }
        });

    } catch (error) {
        console.error("Error updating employee password:", error);
        res.status(500).json({ error: "Failed to update employee password" });
    }
});

// Delete employee (Admin only)
router.delete("/:employeeId", auth, admin, async (req, res) => {
    try {
        const { employeeId } = req.params;

        // Find employee
        const employee = await User.findOne({ 
            _id: employeeId,
            role: "employee"
        });

        if (!employee) {
            return res.status(404).json({ error: "Employee not found" });
        }

        // await employee.deleteOne();
        
        // Check if employee has any active bookings
        const activeBookings = await Booking.find({
            driverId: employeeId,
            status: { $in: ['active', 'pending'] }
        });

        if (activeBookings.length > 0) {
            return res.status(400).json({ 
                error: "Cannot delete employee with active or pending bookings" 
            });
        }

        // Instead of deleting, mark as blocked
        employee.blocked = true;
        await employee.save();

        res.json({
            message: "Employee deactivated successfully",
            employee: {

        // res.json({
        //     message: "Employee deleted successfully",
        //     employee: {
                id: employee._id,
                name: employee.name,
                email: employee.email,
                status: "inactive"
            }
        });

    } catch (error) {
        console.error("Error deactivating employee:", error);
        res.status(500).json({ error: "Failed to deactivate employee" });
    }
});

module.exports = router;
