// server.js (Ponto de Entrada Principal)

// 1. Carrega as variáveis de ambiente do arquivo .env
// ESTA LINHA É A CORREÇÃO MAIS IMPORTANTE
require('dotenv').config();

// 2. Importação de Módulos Essenciais
const express = require('express');
const path = require('path');
const { initializeDb } = require('./config/db'); // Importa a inicialização do DB

// 3. Importação de Rotas
const authRoutes = require('./routes/authRoutes');
const apiRoutes = require('./routes/apiRoutes');
const settingsRoutes = require('./routes/settingsRoutes');

// 4. Configuração Inicial do App
const app = express();
const PORT = process.env.PORT || 3000;

// 5. Middlewares Globais
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 6. Montagem das Rotas da API
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/api/settings', settingsRoutes);

// 7. Rota Genérica (Catch-all)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 8. Inicialização do Servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  initializeDb();
});
