const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
    userId: String,
    name: String,
    date: String,  
    checkIn: Date,
    checkOut: Date
}, { timestamps: true });

const Attendance = mongoose.model('Attendance', attendanceSchema);

module.exports = Attendance;
