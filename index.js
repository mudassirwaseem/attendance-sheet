
require('dotenv').config();
const cron = require('node-cron');
const connectDB = require('./db');
const { fetchAndStoreAttendance, sendMonthlyReportToHR , removeDeviceLogs } = require('./services/attendanceService');

async function startApp() {
    await connectDB(); 

// **Daily Cron Job (Runs at 5 AM PST)**
    cron.schedule('0 5 * * *', async () => {
        await fetchAndStoreAttendance();
    });


// **Monthly Cron Job (Runs on the 1st of Every Month at 6 AM PST)**
    cron.schedule('0 6 1 * *', async () => {
        console.log('📤 Running monthly HR report job at 6 AM PST...');
        await sendMonthlyReportToHR();
        console.log('✅ Monthly HR report sent.');
    }, { timezone: "Asia/Karachi" });
    

    cron.schedule('0 6 * * 0', async () => {
        console.log('📤 Running weekly device logs cleanup job at 6 AM PST...');
        await removeDeviceLogs();
        console.log('✅ Device logs removed.');
    }, { timezone: "Asia/Karachi" });

    // console.log("🚀 Attendance cron job scheduled (Runs every minute)");
    // await fetchAndStoreAttendance();
    // await sendMonthlyReportToHR();
}

startApp();
