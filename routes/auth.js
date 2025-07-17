const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
// const passwordValidator = require('password-validator');
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");
const Car = require('../models/Car');
const crypto = require('crypto');
require('dotenv').config();

cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.API_KEY,
    api_secret: process.env.API_SECRET,
    secure: true,
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,
    },
});

let streamUpload = (req) => {
    return new Promise((resolve, reject) => {
        let stream = cloudinary.uploader.upload_stream((error, result) => {
            if (result) {
                resolve(result);
            } else {
                reject(error);
            }
        });
        streamifier.createReadStream(req.file.buffer).pipe(stream);
    });
};

async function uploadFile(req) {
    let result = await streamUpload(req);
    return result;
}

// Upload Image Route
router.post('/upload-image', auth, upload.single('image'), async (req, res) => {
    try {
        const result = await uploadFile(req);
        res.status(200).json({ image_url: result.secure_url });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: 'An error occurred while uploading the image' });
    }
});

// Upload Profile Picture Route
router.post('/upload-profilePic', auth, upload.single('avatar'), async (req, res) => {
    try {
        const result = await uploadFile(req);
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        user.avatar = result.secure_url;
        await user.save();
        res.status(200).json({ avatar: result.secure_url });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: 'An error occurred while uploading the avatar' });
    }
});

// Register Route
router.post('/signup', async (req, res) => {
    
    const { fullName, email, password, confirmPassword, houseNumber, portion, area} = req.body;


    try {
        if (fullName == "" || houseNumber == "" || portion == "" || area == ""){
            return res.status(400).json({
                error: 'All fields are required'
            })
        }

        if (password != confirmPassword){
            return res.status(400).json({
                error: 'Passwords do not match'
            })
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email.match(emailRegex)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        let existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'Email is already in use' });
        }

        let user = new User({
            name: fullName,
            email,
            password,
            houseNumber,
            portionType: portion,
            address: area,
        });

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);

        await user.save();
        res.status(200).json({ msg: 'User Registered Successfully' });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Login Route
router.post('/login', async (req, res) => {
    const token = req.header('Authorization');
    if (token) {
        return res.status(401).json({ error: 'Already Logged In' });
    }
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) {
            console.log(user);
            return res.status(400).json({ error: 'Invalid Credentials' });
        }

        if (user.blocked) {
            console.log(user);
            return res.status(400).json({ error: 'Account Blocked' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            console.log(isMatch);
            return res.status(400).json({ error: 'Invalid Credentials' });
        }

        const payload = {
            user: {
                id: user.id,
                role: user.role,
                name: user.fullName,
                email: user.email,
                avatar: user.avatar,
            },
        };

        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1d" }, (err, token) => {
            if (err) throw err;
            res.json({ token, id: user.id, role: user.role, avatar: user.avatar, name: user.name, email: user.email });
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server Error: ' + err.message });
    
    }
});

// Route to change password
router.patch("/auth/change-password", auth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        // Validate request body
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                error: "Both current password and new password are required"
            });
        }

        // Password validation
        if (newPassword.length < 6) {
            return res.status(400).json({
                error: "New password must be at least 6 characters long"
            });
        }

        // Get user from database
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Current password is incorrect" });
        }

        // Check if new password is different from current
        if (currentPassword === newPassword) {
            return res.status(400).json({
                error: "New password must be different from current password"
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);

        // Save updated user
        await user.save();

        res.json({
            message: "Password updated successfully",
            timestamp: new Date(),
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error("Error changing password:", error);
        res.status(500).json({
            error: "Server error",
            details: error.message
        });
    }
});

// Route to send password reset email
router.post('/forget-password', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Generate a reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpiry = Date.now() + 1000 * 60 * 60; // 1 hour expiry
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = resetTokenExpiry;
        await user.save();
        // Construct reset link
        const resetLink = `${process.env.FRONT_END_URL}/reset-password?token=${resetToken}`;
        // Send email (assuming sendEmail utility exists)
        await sendEmail(user.email, 'Password Reset Request', `Click the link to reset your password: ${resetLink}`);
        res.status(200).json({ message: 'Password reset email sent' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Route to check if JWT token is valid
router.post('/check-token', async (req, res) => {
    // Try to get token from Authorization header or body

    console.log(req.body);

    let token = req.header('Authorization');
    if (!token && req.body.token) {
        token = req.body.token;
    }
    if (!token) {
        return res.status(400).json({ error: 'Token is required' });
    }
    // Remove 'Bearer ' prefix if present
    if (token.startsWith('Bearer ')) {
        token = token.slice(7, token.length);
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        res.status(200).json({ valid: true, payload: decoded });
    } catch (err) {
        res.status(401).json({ valid: false, error: 'Invalid or expired token' });
    }
});

module.exports = router;