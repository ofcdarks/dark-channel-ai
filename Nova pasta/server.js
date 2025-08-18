// server.js (Ponto de Entrada Principal)
// Responsabilidade: Configurar e iniciar o servidor Express.

// 1. Importação de Módulos Essenciais
const express = require('express');
const path = require('path');
const { initializeDb } = require('./config/db'); // Importa a inicialização do DB

// 2. Importação de Rotas
const authRoutes = require('./routes/authRoutes');
const apiRoutes = require('./routes/apiRoutes');
const settingsRoutes = require('./routes/settingsRoutes');

// 3. Configuração Inicial do App
const app = express();
const PORT = process.env.PORT || 3000;

// 4. Middlewares Globais
// Habilita o parsing de JSON com um limite de 10MB para payloads
app.use(express.json({ limit: '10mb' }));
// Serve arquivos estáticos da pasta 'public' (onde o index.html e seus assets ficarão)
app.use(express.static(path.join(__dirname, 'public')));

// 5. Montagem das Rotas da API
// Todas as rotas de autenticação usarão o prefixo /api/auth
app.use('/api/auth', authRoutes);
// Rotas para as APIs externas (YouTube, Trends, etc.)
app.use('/api', apiRoutes);
// Rotas para salvar e carregar configurações do usuário
app.use('/api/settings', settingsRoutes);

// 6. Rota Genérica (Catch-all)
// Para qualquer outra requisição GET, serve o 'index.html'.
// Isso é crucial para Single-Page Applications (SPAs) funcionarem com rotas no frontend.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 7. Inicialização do Servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  // Chama a função para verificar/criar a tabela de usuários ao iniciar
  initializeDb();
});
