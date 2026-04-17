import { getAuth, getSpreadSheetValues, updateSpreadSheetsValues } from "../services/GoogleSheetServices.js";
import { sendMail } from "../services/NodeMailerServices.js";
import QRCode from "qrcode";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const scanQR = async (req, res, next) => {
    try {
        const { id } = req.body;
        const { sheetId, sheetName } = req.event;
        const auth = await getAuth();
        const sheets = await getSpreadSheetValues({
            spreadsheetId: sheetId,
            auth,
            range: `${sheetName}!A2:F1000`,
        });

        if (!sheets.values || sheets.values.length === 0) {
            return res.status(404).json({ msg: "No data in sheet" });
        }

        for (let i = 0; i < sheets.values.length; i++) {
            if (id === sheets.values[i][1]) {
                return res.status(200).json({
                    excelRow: i + 2,
                    name: sheets.values[i][0],
                    couponsLeft: sheets.values[i][4],
                });
            }
        }
        return res.status(404).json({ msg: "User didn't register" });
    } catch (ex) {
        next(ex);
    }
};

export const redeemQR = async (req, res, next) => {
    try {
        const { id, count } = req.body;
        const { sheetId, sheetName } = req.event;
        const auth = await getAuth();
        const sheets = await getSpreadSheetValues({
            spreadsheetId: sheetId,
            auth,
            range: `${sheetName}!A2:F1000`,
        });

        if (!sheets.values || sheets.values.length === 0) {
            return res.status(404).json({ msg: "No data in sheet" });
        }

        for (let i = 0; i < sheets.values.length; i++) {
            if (id === sheets.values[i][1]) {
                if (sheets.values[i][4] === "0") {
                    return res.status(401).json({ msg: "All Coupons Scanned" });
                } else {
                    await updateSpreadSheetsValues({
                        spreadsheetId: sheetId,
                        auth,
                        range: `${sheetName}!E${i + 2}:E${i + 2}`,
                        data: [[sheets.values[i][4] - count]],
                    });
                    return res.status(200).json({
                        excelRow: i + 2,
                        msg: "Scanned Successfully",
                        couponsLeft: sheets.values[i][4] - count,
                    });
                }
            }
        }
        return res.status(404).json({ msg: "User didn't register" });
    } catch (ex) {
        next(ex);
    }
};

export const generateQR = async (req, res, next) => {
    try {
        const { sheetId, sheetName } = req.event;
        const auth = await getAuth();
        const sheets = await getSpreadSheetValues({
            spreadsheetId: sheetId,
            auth,
            range: `${sheetName}!A2:F1000`,
        });

        // Guard: empty sheet
        if (!sheets.values || sheets.values.length === 0) {
            return res.status(400).json({ message: "No data found in sheet. Please add attendee data first." });
        }

        const batchSize = 5;

        for (let i = 0; i < sheets.values.length; i += batchSize) {
            const batch = sheets.values.slice(i, i + batchSize);

            // Step 1: Generate QR codes and write to col C
            for (let j = 0; j < batch.length; j++) {
                const uniqueId = batch[j][1]; // col B - Unique ID
                if (!uniqueId) continue;

                const generatedQRCode = await QRCode.toDataURL(uniqueId);

                await updateSpreadSheetsValues({
                    spreadsheetId: sheetId,
                    auth,
                    range: `${sheetName}!C${i + j + 2}:C${i + j + 2}`,
                    data: [[generatedQRCode]],
                });

                // Update local copy so sendMail can read col C
                sheets.values[i + j][2] = generatedQRCode;
            }

            // Step 2: Send emails for this batch
            for (let j = 0; j < batch.length; j++) {
                await sendMail(i + j, sheets, sheetId, sheetName, auth);
            }

            // Step 3: Delay before next batch to avoid rate limiting
            if (i + batchSize < sheets.values.length) {
                await delay(5000);
            }
        }

        res.status(200).json({ message: "QR codes generated and emails sent successfully." });
    } catch (ex) {
        next(ex);
    }
};