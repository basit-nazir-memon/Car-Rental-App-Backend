const express = require("express");
const Car = require("../models/Car");
const auth = require("../middleware/auth");
const router = express.Router();

// Add a new car
router.post("/", auth, async (req, res) => {
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

// Get all cars for the logged-in user
router.get("/", auth, async (req, res) => {
    try {
        let cars = [];
        if (req.user.role === "admin"){
            cars = await Car.find();
        }else{
            cars = await Car.find({ user: req.user.id });
        }
        
        res.json(cars);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

module.exports = router;
