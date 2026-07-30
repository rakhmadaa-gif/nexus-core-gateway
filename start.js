const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

// Health check biar Railway tau servernya hidup
app.get('/', (req, res) => {
  res.json({ status: 'Gateway Hidup', message: 'Nexus Core Gateway Jalan' });
});

// Contoh endpoint proxy ke backend lu
app.post('/api/proxy', async (req, res) => {
  try {
    const response = await axios.post('https://backend-kamu.com/api', req.body);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Gateway jalan di port ${PORT}`);
});
