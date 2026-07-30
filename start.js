const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const app = express();
const port = process.env.PORT || 3000;

// 1. AMBIL KUNCI DARI RAILWAY
const API_KEY = process.env.API_KEY; 

// 2. GEMBOKNYA: Middleware cek API Key
app.use((req, res, next) => {
    const requestKey = req.headers['x-api-key'];
    
    if (API_KEY && API_KEY === requestKey) {
        next(); // Kuncinya bener, lanjut
    } else {
        res.status(401).json({ error: "API Key tidak valid atau tidak ada" }); // Ditolak
    }
});

// 3. ROUTE PROXY KE MICROSERVICE
// Contoh: /users -> lempar ke service users
app.use('/users', createProxyMiddleware({ 
    target: 'http://localhost:8081', 
    changeOrigin: true 
}));

// Route default
app.get('/', (req, res) => {
    res.json({ message: "Gateway Hidup - Tapi wajib pakai API Key" });
});

app.listen(port, () => {
    console.log(`Gateway jalan di port ${port}`);
});
