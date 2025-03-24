const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const CarSchema = new Schema(
    {
        model: { type: String, required: true },
        year: { type: Number, required: true },
        color: { type: String, required: true },
        registrationNumber: { type: String, unique: true, required: true },
        chassisNumber: { type: String, unique: true, required: true },
        engineNumber: { type: String, unique: true, required: true },
        image: { type: String },
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    },
    { timestamps: true }
);

const Car = mongoose.model("Car", CarSchema);
module.exports = Car;