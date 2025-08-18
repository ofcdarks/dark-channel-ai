// server.js

// 1. Importação de Módulos
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcryptjs');
const { google } = require('googleapis');
const googleTrends = require('google-trends-api');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library'); // <-- NOVO
const jwt = require('jsonwebtoken'); // <-- NOVO

// 2. Configuração Inicial
const app = express();
const PORT = process.env.PORT || 3000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID; // <-- NOVO: Variável de ambiente
const JWT_SECRET = process.env.JWT_SECRET; // <-- NOVO: Variável de ambiente
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// Middlewares
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 3. Conexão com o Banco de Dados PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const initializeDb = async () => {
  const dbClient = await pool.connect();
  try {
    // Tabela de usuários modificada para aceitar login com Google
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        google_id VARCHAR(255) UNIQUE,
        password_hash VARCHAR(255),
        settings JSONB
      );
    `);
    console.log('Tabela "users" verificada/criada com sucesso.');
  } catch (err) {
    console.error('Erro ao inicializar o banco de dados:', err);
  } finally {
    dbClient.release();
  }
};

// 4. Middleware de Autenticação JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Formato "Bearer TOKEN"
    if (token == null) return res.sendStatus(401); // Não autorizado

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403); // Token inválido/expirado
        req.user = user;
        next();
    });
};


// 5. Rotas da API (Autenticação e Configurações)
app.post('/api/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });
    try {
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const result = await pool.query('INSERT INTO users (email, password_hash, settings) VALUES ($1, $2, $3) RETURNING id, email', [email, passwordHash, {}]);
        const user = result.rows[0];
        
        // Gera o token JWT
        const accessToken = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({ user, accessToken });

    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: 'Este e-mail já está em uso.' });
        console.error(err);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];
        if (user && user.password_hash && await bcrypt.compare(password, user.password_hash)) {
            const accessToken = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
            res.json({ user: {id: user.id, email: user.email}, accessToken });
        } else {
            res.status(401).json({ message: 'Credenciais inválidas.' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

// [NOVA ROTA] Login com Google
app.post('/api/google-login', async (req, res) => {
    const { credential } = req.body;
    try {
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const { sub: google_id, email, name } = payload;

        let result = await pool.query('SELECT * FROM users WHERE google_id = $1', [google_id]);
        let user = result.rows[0];

        if (!user) {
            // Se não encontrou por google_id, tenta por e-mail (para vincular contas)
            result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            user = result.rows[0];

            if (user) {
                // Vincula a conta existente
                await pool.query('UPDATE users SET google_id = $1, name = $2 WHERE email = $3', [google_id, name, email]);
            } else {
                // Cria um novo usuário
                result = await pool.query(
                    'INSERT INTO users (email, name, google_id, settings) VALUES ($1, $2, $3, $4) RETURNING *',
                    [email, name, google_id, {}]
                );
                user = result.rows[0];
            }
        }
        
        const accessToken = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ user: {id: user.id, email: user.email, name: user.name}, accessToken });

    } catch (error) {
        console.error("Erro no login com Google:", error);
        res.status(500).json({ message: "Falha na autenticação com o Google." });
    }
});


app.get('/api/settings/:userId', authenticateToken, async (req, res) => {
    // Verifica se o usuário autenticado é o mesmo da requisição
    if (req.user.id.toString() !== req.params.userId) return res.sendStatus(403);
    
    const { userId } = req.params;
    try {
        const result = await pool.query('SELECT settings FROM users WHERE id = $1', [userId]);
        if (result.rows.length > 0) {
            res.json(result.rows[0].settings || {});
        } else {
            res.status(404).json({ message: 'Usuário não encontrado.' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

app.post('/api/settings/:userId', authenticateToken, async (req, res) => {
    if (req.user.id.toString() !== req.params.userId) return res.sendStatus(403);

    const { userId } = req.params;
    const { settings } = req.body;
    try {
        const result = await pool.query('UPDATE users SET settings = $1 WHERE id = $2 RETURNING id', [settings, userId]);
        if (result.rowCount > 0) {
            res.json({ message: 'Configurações salvas com sucesso!' });
        } else {
            res.status(404).json({ message: 'Usuário não encontrado.' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

// 6. Rotas da API (YouTube Data, Google Trends & OpenRouter) - AGORA PROTEGIDAS
const getGoogleApiKey = async (userId) => {
    const result = await pool.query('SELECT settings FROM users WHERE id = $1', [userId]);
    if (result.rows.length > 0 && result.rows[0].settings) {
        return result.rows[0].settings.google_api;
    }
    return null;
};

app.get('/api/video-details/:videoId', authenticateToken, async (req, res) => {
    const { videoId } = req.params;
    const userId = req.user.id; // Pega o ID do usuário autenticado pelo token

    try {
        const apiKey = await getGoogleApiKey(userId);
        if (!apiKey) return res.status(400).json({ message: "Chave da API do Google não configurada." });

        const youtube = google.youtube({ version: 'v3', auth: apiKey });
        const response = await youtube.videos.list({ part: 'snippet,statistics', id: videoId });

        if (response.data.items.length === 0) {
            return res.status(404).json({ message: 'Vídeo não encontrado.' });
        }
        const video = response.data.items[0];
        res.json({
            title: video.snippet.title,
            description: video.snippet.description,
            tags: video.snippet.tags || [],
            detectedLanguage: video.snippet.defaultAudioLanguage || video.snippet.defaultLanguage || 'pt'
        });
    } catch (error) {
        console.error("Erro na API do YouTube:", error.message);
        res.status(500).json({ message: "Erro ao buscar dados do vídeo." });
    }
});

// ... (Restante das suas rotas, como /api/youtube-stats, etc. devem ter `authenticateToken` como middleware)
// Exemplo: app.get('/api/youtube-stats/:channelId', authenticateToken, async (req, res) => { ... });
// Adicione `authenticateToken` a todas as rotas que precisam de um usuário logado.

// 7. Rota Genérica (Catch-all) para servir o index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 8. Inicialização do Servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  initializeDb();
});
