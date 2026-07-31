require('dotenv').config();
const express = require('express');
const app = express();
const port = process.env.PORT || 10000; // Render pake 10000
app.use(express.json()); // PENTING: biar bisa baca JSON dari Agentverse

// 1. AMBIL KUNCI DARI RENDER
const GROQ_API_KEY = process.env.GROQ_API_KEY;

console.log("Gateway Jalan. Mengecek API_KEY...");
if (!GROQ_API_KEY) {
    console.error("FATAL: GROQ_API_KEY tidak ditemukan!");
}

// 2. GEMBOKNYA: Cek setiap request dari Agentverse
app.use((req, res, next) => {
    const requestKey = req.headers['x-api-key'];
    if (GROQ_API_KEY && GROQ_API_KEY === requestKey) {
        next(); // Kuncinya bener
    } else {
        return res.status(401).json({ error: "API Key tidak valid" });
    }
});

// 3. INI YG BUAT NERIMA CHAT DARI AGENTVERSE
app.post('/', async (req, res) => {
    console.log("Menerima request dari Agentverse");
    const userMessage = req.body.message;

    try {
        // Panggil Groq
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": "llama3-8b-8192",
                "messages": [{"role": "user", "content": userMessage}]
            })
        });
        const data = await groqRes.json();
        const aiReply = data.choices[0].message.content;
        
        console.log("Balasan dari Groq:", aiReply);
        // FORMAT INI YG MAU AGENTVERSE
        return res.json({ message: aiReply });

    } catch (error) {
        console.error(error);
        return res.json({ message: "Maaf, Groq lagi error." });
    }
});

app.listen(port, () => {
    console.log(`Gateway jalan di port ${port}`);
});
