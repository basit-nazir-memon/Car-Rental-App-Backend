const express = require("express");
const router = express.Router();
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const auth = require("../middleware/auth");

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

module.exports = router; 