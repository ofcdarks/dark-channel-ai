// server.js

// 1. Importação de Módulos
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'); // Importado para segurança
const { google } = require('googleapis');
const googleTrends = require('google-trends-api');
const axios = require('axios');

// 2. Configuração Inicial
const app = express();
const PORT = process.env.PORT || 3000;
// É crucial definir um segredo para o JWT nas suas variáveis de ambiente
const JWT_SECRET = process.env.JWT_SECRET || 'seu-segredo-super-secreto-padrao';

// Middlewares
app.use(express.json());
// CORREÇÃO: Servir ficheiros estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));


// 3. Conexão com o Banco de Dados PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Função de inicialização da base de dados atualizada
const initializeDb = async () => {
  const client = await pool.connect();
  try {
    // Tabela de utilizadores atualizada com cargo e status
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        settings JSONB,
        role VARCHAR(50) NOT NULL DEFAULT 'user',
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('Tabela "users" verificada/criada com sucesso.');

    // Nova tabela para histórico de logins
    await client.query(`
      CREATE TABLE IF NOT EXISTS login_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        login_timestamp TIMESTAMPTZ DEFAULT NOW(),
        ip_address VARCHAR(50)
      );
    `);
    console.log('Tabela "login_history" verificada/criada com sucesso.');
    
    // Nova tabela para sessões ativas
    await client.query(`
        CREATE TABLE IF NOT EXISTS active_sessions (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            email VARCHAR(255),
            last_seen TIMESTAMPTZ NOT NULL
        );
    `);
    console.log('Tabela "active_sessions" verificada/criada com sucesso.');

    // **LÓGICA DE ADMINISTRAÇÃO REFORÇADA**
    // Garante que o utilizador administrador principal existe, tem o cargo correto e está ativo.
    const adminEmail = 'rudysilvaads@gmail.com';
    const adminPassword = '253031';

    const adminCheck = await client.query("SELECT id FROM users WHERE email = $1", [adminEmail]);

    if (adminCheck.rowCount === 0) {
        // Se o admin não existir, cria-o com a senha especificada.
        console.log(`Utilizador admin ${adminEmail} não encontrado. A criar...`);
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(adminPassword, salt);
        await client.query(
            "INSERT INTO users (email, password_hash, role, is_active, settings) VALUES ($1, $2, 'admin', true, '{}')",
            [adminEmail, passwordHash]
        );
        console.log(`Utilizador administrador ${adminEmail} criado com sucesso.`);
    } else {
        // Se o admin já existir, garante que ele tem o cargo 'admin' E que está ATIVO.
        await client.query("UPDATE users SET role = 'admin', is_active = true WHERE email = $1", [adminEmail]);
        console.log(`Cargo de administrador e status ativo para ${adminEmail} verificado e garantido.`);
    }

  } catch (err) {
    console.error('Erro ao inicializar a base de dados:', err);
  } finally {
    client.release();
  }
};

// 4. Middleware de Segurança (Verificação de Token JWT)
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Formato "Bearer TOKEN"

    if (!token) {
        return res.status(401).json({ message: 'Acesso negado. Nenhum token fornecido.' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ message: 'Token inválido ou expirado.' });
        }
        req.user = decoded; // Adiciona os dados do utilizador (id, role) ao objeto req
        next();
    });
};

// Middleware para exigir cargo de Admin
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Acesso negado. Recurso exclusivo para administradores.' });
    }
    next();
};


// 5. Rotas da API (Autenticação e Configurações)
app.post('/api/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });
    try {
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        // Garante que o novo utilizador é criado como ativo
        const result = await pool.query('INSERT INTO users (email, password_hash, settings, is_active) VALUES ($1, $2, $3, true) RETURNING id, email', [email, passwordHash, {}]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: 'Este e-mail já está em uso.' });
        console.error(err);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const adminEmail = 'rudysilvaads@gmail.com';

    if (!email || !password) return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });
    try {
        // **CORREÇÃO FINAL E DEFINITIVA**
        // Se o email de login for o do administrador, reativa a conta antes de qualquer outra verificação.
        if (email === adminEmail) {
            console.log(`Tentativa de login do administrador ${adminEmail}. A garantir que a conta está ativa...`);
            await pool.query("UPDATE users SET is_active = true WHERE email = $1", [adminEmail]);
        }

        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ message: 'Credenciais inválidas.' });
        }

        // Esta verificação agora só irá bloquear outros utilizadores que não sejam o admin.
        if (!user.is_active) {
            return res.status(403).json({ message: 'A sua conta foi desativada por um administrador.' });
        }

        // Gerar Token JWT
        const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '24h' });

        // Registar no histórico de logins
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        await pool.query('INSERT INTO login_history (user_id, ip_address) VALUES ($1, $2)', [user.id, ip]);

        // Registar na sessão ativa
        await pool.query(
            'INSERT INTO active_sessions (user_id, email, last_seen) VALUES ($1, $2, NOW()) ON CONFLICT (user_id) DO UPDATE SET last_seen = NOW(), email = $2',
            [user.id, user.email]
        );

        res.json({ 
            message: 'Login bem-sucedido!', 
            token, // Enviar o token para o cliente
            user: { id: user.id, email: user.email, role: user.role }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

// Rota para o frontend reportar que o utilizador continua ativo
app.post('/api/heartbeat', verifyToken, async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE active_sessions SET last_seen = NOW() WHERE user_id = $1',
            [req.user.id]
        );
        if (result.rowCount > 0) {
            res.sendStatus(200);
        } else {
            // Se não existir, insere (caso a sessão tenha expirado no servidor)
            const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [req.user.id]);
            if (userResult.rowCount > 0) {
                 await pool.query(
                    'INSERT INTO active_sessions (user_id, email, last_seen) VALUES ($1, $2, NOW()) ON CONFLICT (user_id) DO UPDATE SET last_seen = NOW()',
                    [req.user.id, userResult.rows[0].email]
                );
                res.sendStatus(200);
            } else {
                res.sendStatus(404);
            }
        }
    } catch (error) {
        console.error('Erro no heartbeat:', error);
        res.sendStatus(500);
    }
});


app.get('/api/settings', verifyToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT settings FROM users WHERE id = $1', [req.user.id]);
        if (result.rows.length > 0) {
            res.json(result.rows[0].settings || {});
        } else {
            res.status(404).json({ message: 'Utilizador não encontrado.' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

app.post('/api/settings', verifyToken, async (req, res) => {
    const { settings } = req.body;
    try {
        const result = await pool.query('UPDATE users SET settings = $1 WHERE id = $2 RETURNING id', [settings, req.user.id]);
        if (result.rowCount > 0) {
            res.json({ message: 'Configurações salvas com sucesso!' });
        } else {
            res.status(404).json({ message: 'Utilizador não encontrado.' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});


// 6. Rota Segura para Geração de Conteúdo com IA
app.post('/api/generate', verifyToken, async (req, res) => {
    const userId = req.user.id;
    const { prompt, schema } = req.body;

    if (!prompt) return res.status(400).json({ message: "O prompt é obrigatório." });

    try {
        const settingsResult = await pool.query('SELECT settings FROM users WHERE id = $1', [userId]);
        if (settingsResult.rows.length === 0) return res.status(404).json({ message: 'Utilizador não encontrado.' });
        
        const apiKeys = settingsResult.rows[0].settings || {};
        const openAIKey = apiKeys.openai;
        const geminiKeys = (apiKeys.gemini || []).filter(k => k && k.trim() !== '');
        let lastError = null;

        if (openAIKey) {
            try {
                console.log("Tentando com a API da OpenAI...");
                const payload = { model: "gpt-3.5-turbo", messages: [{ role: "user", content: prompt }] };
                if (schema) payload.response_format = { type: "json_object" };

                const response = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
                    headers: { 'Authorization': `Bearer ${openAIKey}` },
                    timeout: 60000
                });
                
                const content = response.data.choices[0].message.content;
                let data;
                try {
                    data = schema ? JSON.parse(content) : { text: content };
                } catch (e) {
                    throw new Error("OpenAI retornou um JSON malformado.");
                }
                console.log("Sucesso com OpenAI.");
                return res.json({ data, apiSource: 'OpenAI' });

            } catch (error) {
                lastError = error;
                console.error("Erro na API da OpenAI, tentando Gemini como fallback:", error.message);
            }
        }

        if (geminiKeys.length > 0) {
             console.log("Usando a API Gemini...");
             for (const key of geminiKeys) {
                try {
                    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${key}`;
                    let payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
                    if (schema) payload.generationConfig = { response_mime_type: "application/json", response_schema: schema };
                    
                    const response = await axios.post(apiUrl, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 60000 });
                    
                    if (response.data.candidates?.[0]?.content?.parts?.[0]) {
                        const text = response.data.candidates[0].content.parts[0].text;
                        let data;
                        try {
                           data = schema ? JSON.parse(text) : { text };
                        } catch(e) {
                            throw new Error("Gemini retornou um JSON malformado.");
                        }
                        console.log("Sucesso com Gemini.");
                        return res.json({ data, apiSource: 'Gemini' });
                    }
                } catch (error) {
                    lastError = error;
                    console.error(`Falha com uma chave Gemini. Tentando a próxima. Erro:`, error.message);
                }
             }
        }
        
        const errorMessage = lastError?.message || "Nenhuma API de IA disponível ou todas falharam.";
        return res.status(500).json({ message: `Falha ao gerar conteúdo. Verifique suas chaves de API. Último erro: ${errorMessage}` });

    } catch (error) {
        console.error("Erro geral na rota /api/generate:", error);
        res.status(500).json({ message: 'Erro interno do servidor ao processar a requisição de IA.' });
    }
});


// 7. Rotas da API (YouTube Data & Google Trends) - Agora protegidas
const getGoogleApiKey = async (userId) => {
    const result = await pool.query('SELECT settings FROM users WHERE id = $1', [userId]);
    if (result.rows.length > 0 && result.rows[0].settings) {
        return result.rows[0].settings.google_api;
    }
    return null;
};

const formatStat = (stat) => stat ? parseInt(stat).toLocaleString('pt-BR') : '0';

app.get('/api/video-details/:videoId', verifyToken, async (req, res) => {
    const { videoId } = req.params;
    try {
        const apiKey = await getGoogleApiKey(req.user.id);
        if (!apiKey) return res.status(400).json({ message: "Chave da API do Google não configurada." });
        const youtube = google.youtube({ version: 'v3', auth: apiKey });
        const response = await youtube.videos.list({ part: 'snippet,statistics', id: videoId });
        if (response.data.items.length === 0) return res.status(404).json({ message: 'Vídeo não encontrado.' });
        const video = response.data.items[0];
        res.json({
            title: video.snippet.title,
            description: video.snippet.description,
            tags: video.snippet.tags || [],
            channelId: video.snippet.channelId,
            channelTitle: video.snippet.channelTitle,
            viewCount: formatStat(video.statistics.viewCount),
            likeCount: formatStat(video.statistics.likeCount),
            commentCount: formatStat(video.statistics.commentCount),
            detectedLanguage: video.snippet.defaultAudioLanguage || video.snippet.defaultLanguage || 'pt'
        });
    } catch (error) {
        console.error("Erro na API do YouTube:", error.message);
        res.status(500).json({ message: "Erro ao buscar dados do vídeo. Verifique a chave da API e o ID do vídeo." });
    }
});

app.get('/api/channel-details/:channelId', verifyToken, async (req, res) => {
    const { channelId } = req.params;
    try {
        const apiKey = await getGoogleApiKey(req.user.id);
        if (!apiKey) return res.status(400).json({ message: "Chave da API do Google não configurada." });
        const youtube = google.youtube({ version: 'v3', auth: apiKey });
        const response = await youtube.channels.list({ part: 'statistics', id: channelId });
        if (response.data.items.length === 0) return res.status(404).json({ message: 'Canal não encontrado.' });
        const stats = response.data.items[0].statistics;
        res.json({
            subscriberCount: formatStat(stats.subscriberCount),
            videoCount: formatStat(stats.videoCount),
        });
    } catch (error) {
        console.error("Erro na API do YouTube (detalhes do canal):", error.message);
        res.status(500).json({ message: "Erro ao buscar dados do canal." });
    }
});

app.get('/api/youtube-stats/:channelId', verifyToken, async (req, res) => {
    const { channelId } = req.params;
    try {
        const apiKey = await getGoogleApiKey(req.user.id);
        if (!apiKey) return res.status(400).json({ message: "Chave da API do Google não configurada." });
        const youtube = google.youtube({ version: 'v3', auth: apiKey });
        const response = await youtube.channels.list({ part: 'statistics,snippet,contentDetails', id: channelId });
        if (response.data.items.length === 0) return res.status(404).json({ message: 'Canal não encontrado.' });
        const channel = response.data.items[0];
        res.json({
            subscriberCount: formatStat(channel.statistics.subscriberCount),
            videoCount: formatStat(channel.statistics.videoCount),
            viewCount: formatStat(channel.statistics.viewCount),
            uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads
        });
    } catch (error) {
        console.error("Erro na API do YouTube (stats):", error.message);
        res.status(500).json({ message: "Erro ao buscar dados do canal." });
    }
});

app.get('/api/youtube-recent-videos/:uploadsPlaylistId', verifyToken, async (req, res) => {
    const { uploadsPlaylistId } = req.params;
    try {
        const apiKey = await getGoogleApiKey(req.user.id);
        if (!apiKey) return res.status(400).json({ message: "Chave da API do Google não configurada." });
        const youtube = google.youtube({ version: 'v3', auth: apiKey });
        const playlistResponse = await youtube.playlistItems.list({ part: 'snippet', playlistId: uploadsPlaylistId, maxResults: 5 });
        if (playlistResponse.data.items.length === 0) return res.json([]);
        const videoIds = playlistResponse.data.items.map(item => item.snippet.resourceId.videoId);
        const videosResponse = await youtube.videos.list({ part: 'snippet,statistics', id: videoIds.join(',') });
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
        console.error("Erro na API do YouTube (vídeos recentes):", error.message);
        res.status(500).json({ message: "Erro ao buscar vídeos recentes." });
    }
});

app.get('/api/video-comments/:videoId', verifyToken, async (req, res) => {
    const { videoId } = req.params;
    try {
        const apiKey = await getGoogleApiKey(req.user.id);
        if (!apiKey) return res.status(400).json({ message: "Chave da API do Google não configurada." });
        const youtube = google.youtube({ version: 'v3', auth: apiKey });
        const response = await youtube.commentThreads.list({ part: 'snippet', videoId: videoId, maxResults: 50, order: 'relevance' });
        const comments = response.data.items.map(item => item.snippet.topLevelComment.snippet.textDisplay);
        res.json(comments);
    } catch (error) {
        console.error("Erro na API do YouTube (comentários):", error.response?.data?.error || error.message);
        if (error.response?.data?.error?.errors[0]?.reason === 'commentsDisabled') {
             return res.status(403).json({ message: "Os comentários estão desativados para este vídeo." });
        }
        res.status(500).json({ message: "Erro ao buscar comentários." });
    }
});

app.get('/api/google-trends/:keyword/:country', verifyToken, async (req, res) => {
    const { keyword, country } = req.params;
    try {
        const results = await googleTrends.interestOverTime({
            keyword: keyword,
            geo: country,
            startTime: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
        });
        res.json(JSON.parse(results));
    } catch (error) {
        console.error("Erro na API do Google Trends:", error.message);
        res.status(500).json({ message: "Erro ao buscar dados de tendências." });
    }
});

// 8. Novas Rotas de Administração
app.get('/api/admin/users', verifyToken, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.email, u.role, u.is_active, TO_CHAR(MAX(lh.login_timestamp), 'DD/MM/YYYY HH24:MI:SS') as last_login
            FROM users u
            LEFT JOIN login_history lh ON u.id = lh.user_id
            GROUP BY u.id
            ORDER BY u.created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error("Erro ao buscar utilizadores:", error);
        res.status(500).json({ message: "Erro interno do servidor." });
    }
});

app.put('/api/admin/user/:userId/status', verifyToken, requireAdmin, async (req, res) => {
    const { userId } = req.params;
    const { isActive } = req.body;
    try {
        await pool.query('UPDATE users SET is_active = $1 WHERE id = $2', [isActive, userId]);
        res.json({ message: 'Status do utilizador atualizado com sucesso.' });
    } catch (error) {
        console.error("Erro ao atualizar status do utilizador:", error);
        res.status(500).json({ message: "Erro interno do servidor." });
    }
});

app.get('/api/admin/sessions', verifyToken, requireAdmin, async (req, res) => {
    try {
        // Considera ativos os utilizadores vistos nos últimos 5 minutos
        const result = await pool.query("SELECT user_id, email, TO_CHAR(last_seen, 'DD/MM/YYYY HH24:MI:SS') as last_seen FROM active_sessions WHERE last_seen > NOW() - INTERVAL '5 minutes' ORDER BY last_seen DESC");
        res.json(result.rows);
    } catch (error) {
        console.error("Erro ao buscar sessões ativas:", error);
        res.status(500).json({ message: "Erro interno do servidor." });
    }
});

app.get('/api/admin/history', verifyToken, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT lh.id, u.email, TO_CHAR(lh.login_timestamp, 'DD/MM/YYYY HH24:MI:SS') as login_time, lh.ip_address
            FROM login_history lh
            JOIN users u ON lh.user_id = u.id
            ORDER BY lh.login_timestamp DESC
            LIMIT 50
        `);
        res.json(result.rows);
    } catch (error) {
        console.error("Erro ao buscar histórico de logins:", error);
        res.status(500).json({ message: "Erro interno do servidor." });
    }
});


// 9. Rota Genérica (Catch-all) para servir o index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 10. Inicialização do Servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  initializeDb();
});
