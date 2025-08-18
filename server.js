// server.js

// 1. Importação de Módulos
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcryptjs');
const { google } = require('googleapis');
const googleTrends = require('google-trends-api');

// 2. Configuração Inicial
const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
// O express.static foi removido pois o Vercel lida com arquivos estáticos de outra forma.
// Se for rodar localmente, você pode descomentar a linha abaixo.
// app.use(express.static(path.join(__dirname, 'public'))); 

// 3. Conexão com o Banco de Dados PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const initializeDb = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        settings JSONB
      );
    `);
    console.log('Tabela "users" verificada/criada com sucesso.');
  } catch (err) {
    console.error('Erro ao criar a tabela de usuários:', err);
  } finally {
    client.release();
  }
};

// 4. Rotas da API (Autenticação e Configurações)
app.post('/api/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });
    try {
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const result = await pool.query('INSERT INTO users (email, password_hash, settings) VALUES ($1, $2, $3) RETURNING id, email', [email, passwordHash, {}]);
        res.status(201).json(result.rows[0]);
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
        if (user && await bcrypt.compare(password, user.password_hash)) {
            res.json({ id: user.id, email: user.email, message: 'Login bem-sucedido!' });
        } else {
            res.status(401).json({ message: 'Credenciais inválidas.' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

app.get('/api/settings/:userId', async (req, res) => {
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

app.post('/api/settings/:userId', async (req, res) => {
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

// 5. Rotas da API (YouTube Data & Google Trends)
const getGoogleApiKey = async (userId) => {
    const result = await pool.query('SELECT settings FROM users WHERE id = $1', [userId]);
    if (result.rows.length > 0 && result.rows[0].settings) {
        return result.rows[0].settings.google_api;
    }
    return null;
};

const formatStat = (stat) => stat ? parseInt(stat).toLocaleString('pt-BR') : '0';

app.get('/api/video-details/:videoId', async (req, res) => {
    const { videoId } = req.params;
    const userId = req.headers['x-user-id']; 
    if (!userId) return res.status(401).json({ message: "Usuário não autenticado." });

    try {
        const apiKey = await getGoogleApiKey(userId);
        if (!apiKey) return res.status(400).json({ message: "Chave da API do Google não configurada." });

        const youtube = google.youtube({ version: 'v3', auth: apiKey });
        const response = await youtube.videos.list({
            part: 'snippet,statistics',
            id: videoId,
        });

        if (response.data.items.length === 0) {
            return res.status(404).json({ message: 'Vídeo não encontrado.' });
        }
        const video = response.data.items[0];
        const snippet = video.snippet;
        const stats = video.statistics;
        
        res.json({
            title: snippet.title,
            description: snippet.description,
            tags: snippet.tags || [],
            channelTitle: snippet.channelTitle,
            viewCount: formatStat(stats.viewCount),
            likeCount: formatStat(stats.likeCount),
            commentCount: formatStat(stats.commentCount),
            detectedLanguage: snippet.defaultAudioLanguage || snippet.defaultLanguage || 'pt'
        });
    } catch (error) {
        console.error("Erro na API do YouTube:", error.message);
        res.status(500).json({ message: "Erro ao buscar dados do vídeo. Verifique a chave da API e o ID do vídeo." });
    }
});

app.get('/api/youtube-stats/:channelId', async (req, res) => {
    const { channelId } = req.params;
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ message: "Usuário não autenticado." });

    try {
        const apiKey = await getGoogleApiKey(userId);
        if (!apiKey) return res.status(400).json({ message: "Chave da API do Google não configurada." });

        const youtube = google.youtube({ version: 'v3', auth: apiKey });
        const response = await youtube.channels.list({
            part: 'statistics,snippet,contentDetails', 
            id: channelId,
        });

        if (response.data.items.length === 0) {
            return res.status(404).json({ message: 'Canal não encontrado.' });
        }
        const channel = response.data.items[0];
        const stats = channel.statistics;
        const snippet = channel.snippet;
        
        res.json({
            subscriberCount: formatStat(stats.subscriberCount),
            videoCount: formatStat(stats.videoCount),
            viewCount: formatStat(stats.viewCount),
            publishedAt: snippet.publishedAt ? new Date(snippet.publishedAt).toLocaleDateString('pt-BR') : 'N/A',
            country: snippet.country || 'Não especificado',
            uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads
        });
    } catch (error) {
        console.error("Erro na API do YouTube:", error.message);
        res.status(500).json({ message: "Erro ao buscar dados do canal. Verifique a chave da API e o ID do canal." });
    }
});

app.get('/api/youtube-recent-videos/:uploadsPlaylistId', async (req, res) => {
    const { uploadsPlaylistId } = req.params;
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ message: "Usuário não autenticado." });

    try {
        const apiKey = await getGoogleApiKey(userId);
        if (!apiKey) return res.status(400).json({ message: "Chave da API do Google não configurada." });

        const youtube = google.youtube({ version: 'v3', auth: apiKey });
        
        const playlistResponse = await youtube.playlistItems.list({
            part: 'snippet',
            playlistId: uploadsPlaylistId,
            maxResults: 5
        });

        if (playlistResponse.data.items.length === 0) {
            return res.json([]);
        }
        
        const videoIds = playlistResponse.data.items.map(item => item.snippet.resourceId.videoId);

        const videosResponse = await youtube.videos.list({
            part: 'snippet,statistics',
            id: videoIds.join(',')
        });

        const videosData = videosResponse.data.items.map(video => ({
            id: video.id,
            title: video.snippet.title,
            thumbnail: video.snippet.thumbnails.default.url,
            viewCount: formatStat(video.statistics.viewCount),
            likeCount: formatStat(video.statistics.likeCount),
            commentCount: formatStat(video.statistics.commentCount)
        }));

        res.json(videosData);
    } catch (error) {
        console.error("Erro na API do YouTube ao buscar vídeos recentes:", error.message);
        res.status(500).json({ message: "Erro ao buscar vídeos recentes. Verifique a chave da API." });
    }
});

// [NOVA ROTA] Busca os comentários de um vídeo
app.get('/api/video-comments/:videoId', async (req, res) => {
    const { videoId } = req.params;
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ message: "Usuário não autenticado." });

    try {
        const apiKey = await getGoogleApiKey(userId);
        if (!apiKey) return res.status(400).json({ message: "Chave da API do Google não configurada." });

        const youtube = google.youtube({ version: 'v3', auth: apiKey });
        
        const response = await youtube.commentThreads.list({
            part: 'snippet',
            videoId: videoId,
            maxResults: 50, // Pega os 50 comentários principais
            order: 'relevance' // Pega os mais relevantes
        });

        const comments = response.data.items.map(item => item.snippet.topLevelComment.snippet.textDisplay);
        res.json(comments);

    } catch (error) {
        console.error("Erro na API do YouTube ao buscar comentários:", error.response?.data?.error || error.message);
        if (error.response?.data?.error?.errors[0]?.reason === 'commentsDisabled') {
             return res.status(403).json({ message: "Os comentários estão desativados para este vídeo." });
        }
        res.status(500).json({ message: "Erro ao buscar comentários. Verifique a chave da API e se o vídeo permite comentários." });
    }
});


app.get('/api/google-trends/:keyword/:country', async (req, res) => {
    const { keyword, country } = req.params;
    try {
        const results = await googleTrends.interestOverTime({
            keyword: keyword,
            geo: country,
            startTime: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) // Last 12 months
        });
        res.json(JSON.parse(results));
    } catch (error) {
        console.error("Erro na API do Google Trends:", error.message);
        res.status(500).json({ message: "Erro ao buscar dados de tendências." });
    }
});


// 6. Rota Genérica (Catch-all) para servir o index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 7. Inicialização do Servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  initializeDb();
});
