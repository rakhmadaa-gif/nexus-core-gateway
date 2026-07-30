const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

const API_KEY = process.env.API_KEY; 

app.use((req, res, next) => {
    const requestKey = req.headers['x-api-key'];
    
    if (API_KEY && API_KEY === requestKey) {
        next();
    } else {
        res.status(401).json({ error: "API Key tidak valid atau tidak ada" });
    }
});

// Kalau kuncinya bener, baru masuk sini
app.get('/', (req, res) => {
    res.json({ message: "Gateway Hidup - API Key Bener" });
});

app.listen(port, () => {
    console.log(`Gateway jalan di port ${port}`);
});
