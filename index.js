
require('dotenv').config();
const cron = require('node-cron');
const connectDB = require('./db');
const { fetchAndStoreAttendance } = require('./services/attendanceService');

async function startApp() {
    await connectDB(); 

    cron.schedule('0 5 * * *', async () => {
        console.log('⏳ Running attendance sync (every minute)...');
        await fetchAndStoreAttendance();
    });

    console.log("🚀 Attendance cron job scheduled (Runs every minute)");
    await fetchAndStoreAttendance(); // Run immediately on startup
}

startApp();
