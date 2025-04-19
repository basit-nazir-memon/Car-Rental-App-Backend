const express = require("express");
const User = require("../models/User");
const router = express.Router();

// GET all employees
router.get("/", async (req, res) => {
    try {
        const employees = await User.find({ role: "employee" });

        const formattedEmployees = employees.map((employee, index) => ({
            id: employee._id,
            name: employee.name,
            idCard: employee.idNumber,
            address: employee.address,
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
        const { name, email, password, idCard, address, age, image } = req.body;

        if (!name || !email || !password || !idCard || !address || !age) {
            return res.status(400).json({ error: "All fields are required" });
        }

        const newUser = new User({
            name,
            email,
            password,
            idNumber: idCard,
            address,
            age,
            role: "employee",
            avatar: image || undefined, // If no image provided, default will be used
        });

        await newUser.save();
        res.status(201).json({ message: "Employee added successfully" });
    } catch (error) {
        res.status(500).json({ error: "Failed to add employee" });
    }
});

module.exports = router;
