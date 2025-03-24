const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const userSchema = new Schema({
    name: { type: String, required: true },
    avatar: { type: String, default: "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png" },
    password: { type: String, required: true },
    role: { type: String, enum: ["employee", "admin", "stakeholder"], default: "employee" },
    blocked: { type: Boolean, default: false },
    phone: { type: String},
    createdAt: { type: Date, default: Date.now},
    email: { type: String, required: true },
    resetPasswordToken: String,
    resetPasswordExpires: Date,
});

const User = mongoose.model("User", userSchema);
module.exports = User;