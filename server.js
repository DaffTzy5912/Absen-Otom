const express = require("express");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_BOT_TOKEN = "7990890271:AAFHGe2etMiRhZxaZj8JbcVHdPnBx-yHqB8";
const TELEGRAM_USER_ID = "7341190291"; 

const absensiFile = path.join(__dirname, "absensi.json");
const dataDir = path.join(__dirname, "data");

// Create data directory if it doesn't exist
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve the modern form
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Handle attendance submission
app.post("/api/absen", async (req, res) => {
  try {
    const { nama, noInduk, kelas, waktu } = req.body;
    
    // Generate unique ID for this attendance record
    const id = `abs_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    // Collect IP and user agent for security
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    
    const data = { 
      id,
      nama, 
      noInduk, 
      kelas, 
      waktu,
      metadata: {
        ip,
        userAgent,
        timestamp: Date.now()
      }
    };

    // Read existing attendance data
    let list = [];
    if (fs.existsSync(absensiFile)) {
      const fileContent = fs.readFileSync(absensiFile, 'utf8');
      if (fileContent.trim()) {
        try {
          list = JSON.parse(fileContent);
        } catch (err) {
          console.error("Error parsing absensi.json:", err);
          list = [];
        }
      }
    }
    
    // Add new attendance record
    list.push(data);
    
    // Write updated list back to file
    fs.writeFileSync(absensiFile, JSON.stringify(list, null, 2));

    // Send notification to Telegram    
    const telegramText = `✅ ABSENSI BARU:\nNama: ${nama}\nNo Induk: ${noInduk}\nKelas/Divisi: ${kelas}\nWaktu: ${waktu}`;
    
    try {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_USER_ID,
        text: telegramText,
        parse_mode: 'HTML'
      });
      
      // If location data is available, send the location as well
      if (location && location.latitude) {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendLocation`, {
          chat_id: TELEGRAM_USER_ID,
          latitude: location.latitude,
          longitude: location.longitude
        });
      }
    } catch (error) {
      console.error("Error sending Telegram notification:", error.message);
      // Continue process even if Telegram notification fails
    }

    // Send success response
    res.status(200).json({ success: true, message: "Absensi berhasil dicatat" });
  } catch (error) {
    console.error("Error processing attendance:", error);
    res.status(500).json({ success: false, message: "Terjadi kesalahan saat memproses absensi" });
  }
});

// Get attendance data (with optional filtering)
app.get("/api/absen", (req, res) => {
  try {
    if (!fs.existsSync(absensiFile)) {
      return res.status(200).json([]);
    }
    
    const fileContent = fs.readFileSync(absensiFile, 'utf8');
    const list = fileContent.trim() ? JSON.parse(fileContent) : [];
    
    // Simple filtering (can be expanded later)
    const { nama, kelas, fromDate, toDate } = req.query;
    
    let filteredList = list;
    
    if (nama) {
      filteredList = filteredList.filter(item => 
        item.nama && item.nama.toLowerCase().includes(nama.toLowerCase()));
    }
    
    if (kelas) {
      filteredList = filteredList.filter(item => 
        item.kelas && item.kelas.toLowerCase().includes(kelas.toLowerCase()));
    }
    
    if (fromDate) {
      const fromTimestamp = new Date(fromDate).getTime();
      filteredList = filteredList.filter(item => 
        new Date(item.waktu).getTime() >= fromTimestamp);
    }
    
    if (toDate) {
      const toTimestamp = new Date(toDate).getTime();
      filteredList = filteredList.filter(item => 
        new Date(item.waktu).getTime() <= toTimestamp);
    }
    
    res.status(200).json(filteredList);
  } catch (error) {
    console.error("Error retrieving attendance data:", error);
    res.status(500).json({ error: "Terjadi kesalahan saat mengambil data absensi" });
  }
});

// Telegram webhook endpoint
app.post(`/webhook/${TELEGRAM_BOT_TOKEN}`, async (req, res) => {
  try {
    const message = req.body.message;
    if (!message || !message.text) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text.toLowerCase();

    // Process different commands
    if (text === "/cekabsen" || text === "/cek") {
      let responseText = "📋 <b>DAFTAR ABSENSI TERBARU:</b>\n\n";

      if (fs.existsSync(absensiFile)) {
        const fileContent = fs.readFileSync(absensiFile, 'utf8');
        const list = fileContent.trim() ? JSON.parse(fileContent) : [];

        if (list.length === 0) {
          responseText = "Belum ada data absensi.";
        } else {
          // Show only the most recent 10 entries
          const recentEntries = list.slice(-10);
          
          recentEntries.forEach((item, index) => {
            const entryNum = list.length - (recentEntries.length - index - 1);
            responseText += `${entryNum}. <b>${item.nama}</b> | ${item.noInduk} th | ${item.kelas}\n    <i>${item.waktu}</i>\n\n`;
          });
          
          if (list.length > 10) {
            responseText += `\n<i>Menampilkan ${recentEntries.length} dari total ${list.length} data absensi</i>`;
          }
        }
      } else {
        responseText = "File absensi tidak ditemukan.";
      }

      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: responseText,
        parse_mode: "HTML"
      });
    } else if (text === "/total" || text.includes("total")) {
      // Return total attendance count
      if (fs.existsSync(absensiFile)) {
        const fileContent = fs.readFileSync(absensiFile, 'utf8');
        const list = fileContent.trim() ? JSON.parse(fileContent) : [];
        
        const totalCount = list.length;
        
        // Count unique names
        const uniqueNames = new Set();
        list.forEach(item => {
          if (item.nama) uniqueNames.add(item.nama.trim().toLowerCase());
        });
        
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: `📊 <b>STATISTIK ABSENSI</b>\n\nTotal absensi: <b>${totalCount}</b>\nTotal peserta unik: <b>${uniqueNames.size}</b>`,
          parse_mode: "HTML"
        });
      } else {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: "File absensi tidak ditemukan."
        });
      }
    } else if (text === "/help" || text === "/bantuan") {
      // Send help message
      const helpText = `🤖 <b>BANTUAN BOT ABSENSI</b>\n\n` +
        `Berikut perintah yang tersedia:\n\n` +
        `/cekabsen - Menampilkan data absensi terbaru\n` +
        `/total - Menampilkan statistik total absensi\n` +
        `/cari [nama] - Mencari absensi berdasarkan nama\n` +
        `/help - Menampilkan bantuan ini\n`;
      
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: helpText,
        parse_mode: "HTML"
      });
    } else if (text.startsWith("/cari ")) {
      // Search for attendance by name
      const searchQuery = text.substring(6).trim().toLowerCase();
      
      if (searchQuery.length < 3) {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: "Masukkan minimal 3 karakter untuk pencarian."
        });
        return res.sendStatus(200);
      }
      
      if (fs.existsSync(absensiFile)) {
        const fileContent = fs.readFileSync(absensiFile, 'utf8');
        const list = fileContent.trim() ? JSON.parse(fileContent) : [];
        
        const results = list.filter(item => 
          item.nama && item.nama.toLowerCase().includes(searchQuery)
        );
        
        if (results.length === 0) {
          await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: `Tidak ada hasil untuk pencarian "${searchQuery}"`
          });
        } else {
          let responseText = `🔍 <b>HASIL PENCARIAN:</b> "${searchQuery}"\n\n`;
          
          results.slice(0, 10).forEach((item, index) => {
            responseText += `${index + 1}. <b>${item.nama}</b> | ${item.noInduk} th | ${item.kelas}\n    <i>${item.waktu}</i>\n\n`;
          });
          
          if (results.length > 10) {
            responseText += `\n<i>Menampilkan 10 dari total ${results.length} hasil</i>`;
          }
          
          await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: responseText,
            parse_mode: "HTML"
          });
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Error handling Telegram webhook:", error);
    res.sendStatus(500);
  }
});

// Server monitoring endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`💡 Modern Absensi Digital - v1.2.0`);
});
