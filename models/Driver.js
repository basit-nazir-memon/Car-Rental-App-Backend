const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const driverSchema = new Schema({
    name: { type: String, required: true },
    avatar: { type: String, default: "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png" },
    available: { type: Boolean, default: true },
    phone: { type: String},
    createdAt: { type: Date, default: Date.now},
    idNumber: { type: String, required: true },
    address: { type: String, required: true },
    lisenceNumber: {type: String, required: true},
    resetPasswordToken: String,
    resetPasswordExpires: Date,
});

const Driver = mongoose.model("Driver", driverSchema);
module.exports = Driver;