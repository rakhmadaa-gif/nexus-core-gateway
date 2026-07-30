require('dotenv').config();
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// 1. AMBIL KUNCI DARI RAILWAY
const API_KEY = process.env.API_KEY; 

console.log("Gateway Jalan. Mengecek API_KEY...");

// 2. GEMBOKNYA: Cek setiap request
app.use((req, res, next) => {
    const requestKey = req.headers['x-api-key'];
    
    if (API_KEY && API_KEY === requestKey) {
        next(); // Kuncinya bener, boleh masuk
    } else {
        return res.status(401).json({ error: "API Key tidak valid atau tidak ada" }); // Ditolak
    }
});

// 3. KALAU LOLOS GEMBOK, BARU MASUK SINI
app.get('/', (req, res) => {
    res.json({ message: "Gateway Hidup - API Key Bener ✅" });
});


app.listen(port, () => {
    console.log(`Gateway jalan di port ${port}`);
});
