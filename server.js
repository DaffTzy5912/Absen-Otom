const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_BOT_TOKEN = "8046810663:AAEDKWWGJeCA6us-g0j7RuZniHlKxSLqgSw";
const TELEGRAM_USER_ID = "7333629874"; 

const absensiFile = path.join(__dirname, "absensi.json");

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure the absensi.json file exists
async function ensureAbsensiFile() {
  try {
    await fs.access(absensiFile);
  } catch (error) {
    // File doesn't exist, create it with an empty array
    await fs.writeFile(absensiFile, '[]');
  }
}

// Read absensi data
async function readAbsensiData() {
  await ensureAbsensiFile();
  const data = await fs.readFile(absensiFile, 'utf8');
  return JSON.parse(data);
}

// Write absensi data
async function writeAbsensiData(data) {
  await fs.writeFile(absensiFile, JSON.stringify(data, null, 2));
}

// Get today's date in YYYY-MM-DD format
function getTodayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Standardize date from different formats
function standardizeDate(dateStr) {
  // Handle different formats
  if (!dateStr) return null;
  
  let date;
  // Try to parse various formats
  if (dateStr.includes("/")) {
    // Format like 5/6/2025 or 6/5/2025
    const parts = dateStr.split("/");
    if (parts.length >= 3) {
      // Adjust format based on whether day or month comes first
      date = new Date(`${parts[2].split(",")[0]}-${parts[0]}-${parts[1]}`);
    }
  } else {
    // Try standard parsing
    date = new Date(dateStr);
  }
  
  if (isNaN(date.getTime())) {
    return null;
  }
  
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Tampilkan halaman form
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Handle absen
app.post("/api/absen", async (req, res) => {
  try {
    const { nama, umur, kelas, waktu, location } = req.body;
    
    if (!nama || !umur || !kelas) {
      return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
    }
    
    // Create data object with timestamp
    const timestamp = new Date().toISOString();
    const data = { 
      nama, 
      umur, 
      kelas, 
      waktu: waktu || new Date().toLocaleString('id-ID'),
      timestamp,
      ...(location && { location: JSON.parse(location) })
    };
    
    // Read existing data
    const list = await readAbsensiData();
    
    // Add new data
    list.push(data);
    
    // Write updated data
    await writeAbsensiData(list);
    
    // Send notification to Telegram
    const locationInfo = data.location ? 
      `\nLokasi: https://www.google.com/maps?q=${data.location.latitude},${data.location.longitude}` : '';
    
    const text = `📍 Notifikasi Absensi:\nNama: ${nama}\nUmur: ${umur}\nDivisi/Kelas: ${kelas}\nWaktu: ${data.waktu}${locationInfo}`;
    
    try {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_USER_ID,
        text,
        parse_mode: 'HTML'
      });
    } catch (telegramError) {
      console.error('Telegram notification error:', telegramError);
      // Continue even if telegram notification fails
    }
    
    res.status(200).json({ success: true, message: 'Absensi berhasil dikirim' });
  } catch (error) {
    console.error('Absensi error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// API Endpoint for statistics
app.get("/api/stats", async (req, res) => {
  try {
    const list = await readAbsensiData();
    
    // Get total count
    const totalAbsensi = list.length;
    
    // Get unique users based on name
    const uniqueUsers = new Set(list.map(item => item.nama.trim().toLowerCase())).size;
    
    // Get today's count
    const today = getTodayDate();
    const todayCount = list.filter(item => {
      const itemDate = standardizeDate(item.waktu);
      return itemDate === today;
    }).length;
    
    res.json({
      totalAbsensi,
      uniqueUsers,
      todayCount
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// API Endpoint for latest activity
app.get("/api/latest-activity", async (req, res) => {
  try {
    const list = await readAbsensiData();
    
    // Sort by timestamp or date if available
    const sortedList = list.sort((a, b) => {
      const dateA = a.timestamp ? new Date(a.timestamp) : new Date(a.waktu);
      const dateB = b.timestamp ? new Date(b.timestamp) : new Date(b.waktu);
      return dateB - dateA; // Descending order
    });
    
    res.json(sortedList.slice(0, 10)); // Return the 10 most recent entries
  } catch (error) {
    console.error('Latest activity error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// API Endpoint for absensi history with pagination and search
app.get("/api/absensi-history", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    
    let list = await readAbsensiData();
    
    // Sort by timestamp or date
    list = list.sort((a, b) => {
      const dateA = a.timestamp ? new Date(a.timestamp) : new Date(a.waktu);
      const dateB = b.timestamp ? new Date(b.timestamp) : new Date(b.waktu);
      return dateB - dateA; // Descending order
    });
    
    // Apply search filter if provided
    if (search) {
      const searchLower = search.toLowerCase();
      list = list.filter(item => 
        item.nama.toLowerCase().includes(searchLower) || 
        (item.kelas && item.kelas.toLowerCase().includes(searchLower))
      );
    }
    
    // Calculate pagination
    const totalItems = list.length;
    const totalPages = Math.ceil(totalItems / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    // Get items for current page
    const items = list.slice(startIndex, endIndex);
    
    res.json({
      items,
      totalItems,
      totalPages,
      currentPage: page
    });
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Endpoint Webhook dari Telegram
app.post(`/webhook/${TELEGRAM_BOT_TOKEN}`, async (req, res) => {
  try {
    const message = req.body.message;
    if (!message || !message.text) return res.sendStatus(200);
    
    const chatId = message.chat.id;
    const text = message.text;
    
    // Handle different commands
    if (text === "/cekabsen" || text === "/stats") {
      const list = await readAbsensiData();
      
      // Get total count
      const totalAbsensi = list.length;
      
      // Get unique users based on name
      const uniqueUsers = new Set(list.map(item => item.nama.trim().toLowerCase())).size;
      
      // Get today's count
      const today = getTodayDate();
      const todayCount = list.filter(item => {
        const itemDate = standardizeDate(item.waktu);
        return itemDate === today;
      }).length;
      
      let responseText = `📊 <b>Statistik Absensi</b>\n\n`;
      responseText += `📌 Total Absensi: <b>${totalAbsensi}</b>\n`;
      responseText += `👥 Total Pengguna Unik: <b>${uniqueUsers}</b>\n`;
      responseText += `📅 Absensi Hari Ini: <b>${todayCount}</b>\n\n`;
      
      if (todayCount > 0) {
        responseText += `<b>Absensi Hari Ini:</b>\n`;
        
        const todayData = list.filter(item => {
          const itemDate = standardizeDate(item.waktu);
          return itemDate === today;
        });
        
        todayData.forEach((item, index) => {
          responseText += `${index + 1}. ${item.nama} (${item.kelas}) - ${item.waktu.split(',')[1] || item.waktu}\n`;
        });
      }
      
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: responseText,
        parse_mode: 'HTML'
      });
    } 
    else if (text === "/help") {
      const helpText = `
📋 <b>Daftar Perintah Bot</b>

/cekabsen - Menampilkan statistik absensi dan daftar absensi hari ini
/stats - Sama dengan /cekabsen
/latest - Menampilkan 5 absensi terbaru
/help - Menampilkan daftar perintah
/search [kata kunci] - Mencari data absensi berdasarkan nama atau kelas
`;
      
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: helpText,
        parse_mode: 'HTML'
      });
    }
    else if (text === "/latest") {
      const list = await readAbsensiData();
      
      // Sort by timestamp or date
      const sortedList = list.sort((a, b) => {
        const dateA = a.timestamp ? new Date(a.timestamp) : new Date(a.waktu);
        const dateB = b.timestamp ? new Date(b.timestamp) : new Date(b.waktu);
        return dateB - dateA; // Descending order
      });
      
      let responseText = `📋 <b>5 Absensi Terbaru</b>\n\n`;
      
      if (sortedList.length === 0) {
        responseText = "Belum ada data absensi.";
      } else {
        sortedList.slice(0, 5).forEach((item, index) => {
          responseText += `${index + 1}. <b>${item.nama}</b> (${item.kelas}) - ${item.waktu}\n`;
        });
      }
      
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: responseText,
        parse_mode: 'HTML'
      });
    }
    else if (text.startsWith("/search ")) {
      const keyword = text.substring(8).toLowerCase();
      
      if (!keyword) {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: "Silakan masukkan kata kunci pencarian. Contoh: /search Furqon",
          parse_mode: 'HTML'
        });
        return res.sendStatus(200);
      }
      
      const list = await readAbsensiData();
      
      // Filter by keyword
      const filteredList = list.filter(item => 
        item.nama.toLowerCase().includes(keyword) || 
        (item.kelas && item.kelas.toLowerCase().includes(keyword))
      );
      
      let responseText = `🔍 <b>Hasil Pencarian untuk "${keyword}"</b>\n\n`;
      
      if (filteredList.length === 0) {
        responseText += "Tidak ditemukan data yang sesuai.";
      } else {
        filteredList.slice(0, 10).forEach((item, index) => {
          responseText += `${index + 1}. <b>${item.nama}</b> (${item.kelas}) - ${item.waktu}\n`;
        });
        
        if (filteredList.length > 10) {
          responseText += `\n...dan ${filteredList.length - 10} lainnya`;
        }
      }
      
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: responseText,
        parse_mode: 'HTML'
      });
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✨ Server running on http://localhost:${PORT}`);
  
  // Ensure the absensi file exists when server starts
  ensureAbsensiFile().catch(err => {
    console.error('Error initializing absensi file:', err);
  });
});
