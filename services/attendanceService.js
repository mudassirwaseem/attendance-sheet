const fs = require('fs');
const ZKLib = require('node-zklib');
const Attendance = require('../models/attendanceModel');
const ExcelJS = require('exceljs');
const { google } = require('googleapis');
const { SESClient, SendRawEmailCommand } = require("@aws-sdk/client-ses");

require('dotenv').config();

const DEVICE_IP = process.env.DEVICE_IP;
const DEVICE_PORT = parseInt(process.env.DEVICE_PORT, 10);
const users = JSON.parse(fs.readFileSync('users.json', 'utf8'));

const {
    GOOGLE_CLIENT_EMAIL,
    GOOGLE_PRIVATE_KEY,
    SPREADSHEET_ID,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    AWS_REGION,
    PRIMARY_EMAIL
  } = process.env;


  const sesClient = new SESClient({
    region: AWS_REGION,
    credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
});

  const jwtClient = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), 
    ['https://www.googleapis.com/auth/spreadsheets'],
    null
  );

  const sheets = google.sheets({ version: 'v4', auth: jwtClient });

async function saveLogsToGoogleSheets(logs) {
    try {
        const spreadsheetId = SPREADSHEET_ID;  

        const currentDate = new Date();
        const monthName = currentDate.toLocaleString('default', { month: 'long' });
        const year = currentDate.getFullYear();
        const sheetName = `${monthName} ${year}`;

        // Check if sheet exists
        const sheetsList = await sheets.spreadsheets.get({ spreadsheetId });
        const existingSheet = sheetsList.data.sheets.find(sheet => sheet.properties.title === sheetName);

        // If sheet does not exist, create it
        if (!existingSheet) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                resource: {
                    requests: [{
                        addSheet: {
                            properties: { title: sheetName }
                        }
                    }]
                }
            });
            console.log(`✅ Created new sheet: ${sheetName}`);
        }

        const range = `${sheetName}!A1`;

        // ** Step 1: Fetch Existing Data from Sheet **
        const existingData = await getExistingDataFromSheet(spreadsheetId, sheetName);
        
        // Extract existing users and dates from sheet
        const existingRecords = {};
        existingData.forEach(row => {
            const name = row[0];
            row.slice(1).forEach((cell, index) => {
                if (cell) {
                    const dateIndex = Math.floor(index / 2); 
                    const date = existingData[0][dateIndex * 2 + 1]; 
                    const key = `${name}_${date}`;
                    existingRecords[key] = row.slice(index + 1, index + 3);
                }
            });
        });

        // ** Step 2: Process New Logs and Compare with Existing Data **
        const dates = [...new Set(logs.map(log => log.date))].sort();
        const users = [...new Set(logs.map(log => log.userId))];

        const headerRow = ['Name'];
        dates.forEach(date => headerRow.push(date, ''));

        const subHeaderRow = [''];
        dates.forEach(() => subHeaderRow.push('Check-In', 'Check-Out'));

        const updatedLogs = users.map(userId => {
            const userLogs = logs.filter(log => log.userId === userId);
            const row = [getUserName(userId)];

            dates.forEach(date => {
                const key = `${getUserName(userId)}_${date}`;
                const newRecord = userLogs.find(log => log.date === date);
                const existingRecord = existingRecords[key];

                let checkInTime = '';
                let checkOutTime = '';

                if (newRecord) {
                    checkInTime = newRecord.checkIn ? formatTime(newRecord.checkIn) : '';
                    checkOutTime = newRecord.checkOut ? formatTime(newRecord.checkOut) : '';
                }

                if (existingRecord) {
                    checkInTime = checkInTime || existingRecord[0]; 
                    checkOutTime = checkOutTime || existingRecord[1]; 
                }

                row.push(checkInTime, checkOutTime);
            });

            return row;
        });

        // ** Step 3: Append New and Updated Data to Sheet **
        const values = [headerRow, subHeaderRow, ...updatedLogs];

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range,
            valueInputOption: 'RAW',
            resource: { values },
        });

        console.log(`✅ Successfully updated logs in sheet: ${sheetName}`);
    } catch (error) {
        console.error('❌ Error saving logs to Google Sheets:', error);
    }
}

// Function to get existing data from Google Sheets
async function getExistingDataFromSheet(spreadsheetId, sheetName) {
    try {
        const range = `${sheetName}!A:Z`; // Fetch a broad range
        const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });

        return response.data.values || [];
    } catch (error) {
        console.warn(`⚠️ No existing data found for ${sheetName}, starting fresh.`);
        return [];
    }
}

function formatTime(time) {
    
    let hours = time.getUTCHours();
    let minutes = time.getMinutes();
    let seconds = time.getSeconds();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12; // Convert to 12-hour format
    hours = hours ? hours : 12; // Handle midnight case
    minutes = minutes < 10 ? '0' + minutes : minutes;
    seconds = seconds < 10 ? '0' + seconds : seconds;
    return `${hours}:${minutes}:${seconds} ${ampm}`;
}


function getUserName(userId) {
    const user = users.find(u => u.id === userId);
    return user ? user.name : userId;
}

async function generateExcelFile(logs) {
    console.log(logs, "logs new");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Attendance Logs');

    const dates = [...new Set(logs.map(log => log.date))].sort();
    const userIds = [...new Set(logs.map(log => log.userId))];
    
    const headerRow = ['Name'];
    dates.forEach(date => {
        headerRow.push(date, '');
    });
    sheet.addRow(headerRow);

    const subHeaderRow = [''];
    dates.forEach(() => {
        subHeaderRow.push('Check-In', 'Check-Out');
    });
    sheet.addRow(subHeaderRow);
    
    // Populate user data
    userIds.forEach(userId => {
        const row = [getUserName(userId)];
        dates.forEach(date => {
            const record = logs.find(log => log.userId === userId && log.date === date);
            if (record) {
                
                const checkInTime = formatTime(record.checkIn);
                const checkOutTime = formatTime(record.checkOut);
        
                row.push(checkInTime, checkOutTime);
            } else {
                row.push('', '');
            }
        });
        
        
        sheet.addRow(row);
    });

    sheet.columns.forEach((column, i) => {
        column.width = i === 0 ? 20 : 15;
    });

    // Save file
    const filePath = './attendance.xlsx';
    await workbook.xlsx.writeFile(filePath);
    console.log(`📂 Attendance data saved to ${filePath}`);
    return filePath;
}


async function fetchAndStoreAttendance() {
    try {
        console.log('⏳ Connecting to ZKTeco device...');
        const device = new ZKLib(DEVICE_IP, DEVICE_PORT, 5200, 40000);

        await device.createSocket();
        await new Promise(resolve => setTimeout(resolve, 40000));
        console.log('✅ Connected to ZKTeco device');

        console.log('📌 Fetching attendance logs...');
        const logs = await device.getAttendances();
        await device.disconnect();

        if (logs.data.length > 0) {
            console.log('📤 Processing logs...');
            const processedLogs = processAttendanceLogs(logs.data);
            console.log('💾 Saving logs to MongoDB...', JSON.stringify(processedLogs));

            // const filePath = await generateExcelFile(processedLogs);

            await saveLogsToGoogleSheets(processedLogs);
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

        const utcDate = new Date(log.recordTime);
        const pkDate = new Date(utcDate.getTime() + 5 * 60 * 60 * 1000); // Convert to PKT

        let date = pkDate.toISOString().split("T")[0]; 
        const timestamp = pkDate;
        const hours = pkDate.getUTCHours();

        if (hours < 6) {
            const prevDate = new Date(pkDate);
            prevDate.setDate(prevDate.getDate() - 1);
            date = prevDate.toISOString().split("T")[0]; // Set to previous day
        }

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

async function sendMonthlyReportToHR() {
    try {
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        const monthName = lastMonth.toLocaleString('default', { month: 'long' });
        const year = lastMonth.getFullYear();
        const sheetName = `${monthName} ${year}`;
        
        console.log(`📂  ${sheetName}...`);

        // Fetch the sheet data
        const range = `${sheetName}!A:Z`;
      

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,  
            range
        });

        if (!response.data.values || response.data.values.length === 0) {
            console.log(`⚠️ No data found for ${sheetName}.`);
            return;
        }

        const fileName = `${sheetName}_Attendance.xlsx`;
        const filePath = `./${fileName}`;
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet(sheetName);

        response.data.values.forEach(row => {
            sheet.addRow(row);
        });

        await workbook.xlsx.writeFile(filePath);
        console.log(`📂 Excel file created: ${filePath}`);

        await sendExcelReportEmail(fileName, sheetName, filePath);

        console.log(`✅ Email sent to HR with ${sheetName} report.`);
    } catch (error) {
        console.error("❌ Error sending monthly HR report:", error);
    }
}

// **Function to Send Email with Excel Attachment**
async function sendExcelReportEmail(fileName, sheetName, filePath) {
    try {
        // Read file and encode in base64
        const fileContent = fs.readFileSync(filePath);
        const fileBase64 = fileContent.toString("base64");

        const boundary = "NextPart";
        const fromEmail = PRIMARY_EMAIL;
        const toEmail = "hr@geeksofkolachi.com";

        const rawEmail = [
            `From: ${fromEmail}`,
            `To: ${toEmail}`,
            `Subject: Monthly Attendance Report`,
            "MIME-Version: 1.0",
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
            "",
            `--${boundary}`,
            "Content-Type: text/plain; charset=UTF-8",
            "Content-Transfer-Encoding: 7bit",
            "",
            "Please find attached the attendance report for last month.",
            "",
            `--${boundary}`,
            `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="${fileName}"`,
            "Content-Transfer-Encoding: base64",
            `Content-Disposition: attachment; filename="${fileName}"`,
            "",
            fileBase64,
            "",
            `--${boundary}--`,
        ].join("\n");

        const params = {
            RawMessage: { Data: Buffer.from(rawEmail) },
            Source: fromEmail,
            Destinations: [toEmail],
        };

        const command = new SendRawEmailCommand(params);
        await sesClient.send(command);

        console.log(`✅ Email sent to HR with ${sheetName} report.`);

        // Remove the generated file after sending email
        fs.unlinkSync(filePath);

    } catch (error) {
        console.error("❌ Error sending email:", error);
    }
}

const removeDeviceLogs = async () => {
    const device = new ZKLib(DEVICE_IP, DEVICE_PORT, 5200, 10000);

    try {
        await device.createSocket();
        await new Promise(resolve => setTimeout(resolve, 10000)); 
        console.log('✅ Connected to ZKTeco device')

        // Try clearing the logs
        console.log('📌 Clearing attendance logs...');
        await device.clearAttendanceLog(); 

        await device.disconnect();
        console.log('✅ Device logs cleared successfully!');
    } catch (error) {
        console.error('❌ Error clearing device logs:', error);
    }
};



module.exports = { fetchAndStoreAttendance, sendMonthlyReportToHR, removeDeviceLogs };
