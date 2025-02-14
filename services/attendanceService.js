const fs = require('fs');
const ZKLib = require('node-zklib');
const Attendance = require('../models/attendanceModel');

const DEVICE_IP = process.env.DEVICE_IP;
const DEVICE_PORT = parseInt(process.env.DEVICE_PORT, 10);
const users = JSON.parse(fs.readFileSync('users.json', 'utf8'));

function getUserName(userId) {
    const user = users.find(u => u.id === userId);
    return user ? user.name : userId;
}

async function fetchAndStoreAttendance() {
    try {
        console.log('⏳ Connecting to ZKTeco device...');
        const device = new ZKLib(DEVICE_IP, DEVICE_PORT, 5200, 20000);

        await device.createSocket();
        await new Promise(resolve => setTimeout(resolve, 20000)); // Ensure connection stability
        console.log('✅ Connected to ZKTeco device');

        console.log('📌 Fetching attendance logs...');
        const logs = await device.getAttendances();
        await device.disconnect();

        console.log(logs.data, "logs=====>");

        if (logs.data.length > 0) {
            console.log('📤 Processing logs...');
            const processedLogs = processAttendanceLogs(logs.data);
            console.log('💾 Saving logs to MongoDB...');
            await saveToDatabase(processedLogs);
        } else {
            console.log('⚠️ No new logs to update.');
        }
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

function processAttendanceLogs(logs) {
    const userLogs = {};
    logs.forEach(log => {
        const userId = log.deviceUserId;
        const date = new Date(log.recordTime).toISOString().split("T")[0]; // Extract only date (YYYY-MM-DD)
        const timestamp = new Date(log.recordTime);
        const key = `${userId}_${date}`;

        if (!userLogs[key]) {
            userLogs[key] = { userId, name: getUserName(userId), date, checkIn: timestamp, checkOut: timestamp };
        } else {
            if (timestamp < userLogs[key].checkIn) userLogs[key].checkIn = timestamp;
            if (timestamp > userLogs[key].checkOut) userLogs[key].checkOut = timestamp;
        }
    });
    return Object.values(userLogs);
}

async function saveToDatabase(logs) {
    try {
        for (const log of logs) {
            const existingRecord = await Attendance.findOne({ userId: log.userId, date: log.date });

            if (existingRecord) {
                existingRecord.checkIn = log.checkIn < existingRecord.checkIn ? log.checkIn : existingRecord.checkIn;
                existingRecord.checkOut = log.checkOut > existingRecord.checkOut ? log.checkOut : existingRecord.checkOut;
                await existingRecord.save();
                console.log(`🔄 Updated record for ${log.name} on ${log.date}`);
            } else {
                await Attendance.create(log);
                console.log(`✅ Saved new record for ${log.name} on ${log.date}`);
            }
        }
    } catch (error) {
        console.error("❌ Error saving to database:", error);
    }
}

module.exports = { fetchAndStoreAttendance };
