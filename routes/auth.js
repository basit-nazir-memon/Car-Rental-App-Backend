const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");
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

// // Upload Profile Picture Route
// router.post('/upload-profilePic', auth, upload.single('avatar'), async (req, res) => {
//     try {
//         const result = await uploadFile(req);
//         const user = await User.findById(req.user.id);
//         if (!user) {
//             return res.status(404).json({ error: 'User not found' });
//         }
//         user.avatar = result.secure_url;
//         await user.save();
//         res.status(200).json({ avatar: result.secure_url });
//     } catch (err) {
//         console.log(err);
//         res.status(500).json({ error: 'An error occurred while uploading the avatar' });
//     }
// });

// Register Route
// router.post('/register', async (req, res) => {
//     const { name, email, password } = req.body;
//     try {
//         if (name == ""){
//             return res.status(400).json({
//                 error: 'Name is Required'
//             })
//         }

//         if (!passwordValidator(password)) {
//             return res.status(400).json({
//                 error: 'Password should have one lowercase letter, one uppercase letter, one special character, one number, and be at least 8 characters long',
//             });
//         }

//         const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
//         if (!email.match(emailRegex)) {
//             return res.status(400).json({ error: 'Invalid email format' });
//         }

//         let existingUser = await User.findOne({ email });
//         if (existingUser) {
//             return res.status(400).json({ error: 'Email is already in use' });
//         }

//         let user = new User({
//             name,
//             email,
//             password,
//             pagesAccess: {}
//         });

//         const salt = await bcrypt.genSalt(10);
//         user.password = await bcrypt.hash(password, salt);

//         await sendEmail(user.email, `Welcome to BidBot Community`, getWelcomeEmail(name, '', `${process.env.FRONT_END_URL}/authentication/sign-in`, password));

//         await user.save();
//         res.status(200).json({ msg: 'User Registered Successfully' });

//     } catch (err) {
//         console.error(err.message);
//         res.status(500).send('Server Error');
//     }
// });

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
            return res.status(400).json({ error: 'Invalid Credentials' });
        }

        if (user.blocked) {
            return res.status(400).json({ error: 'Account Blocked' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid Credentials' });
        }

        const payload = {
            user: {
                id: user.id,
                role: user.role
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


module.exports = router;