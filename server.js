// server.js

// 1. Importação de Módulos
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const googleTrends = require('google-trends-api');
const axios = require('axios');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const multer =require('multer');
const fs = require('fs');

// 2. Configuração Inicial
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'seu-segredo-super-secreto-padrao';

// Obter o diretório base do projeto de forma segura
const BASE_DIR = __dirname;

// Middlewares
app.use(express.json());

// Servir arquivos estáticos da pasta 'public'.
app.use(express.static(path.join(BASE_DIR, 'public')));

// Servir uploads de imagens
app.use('/uploads', express.static(path.join(BASE_DIR, 'uploads')));

// Configuração do Multer para Upload de Imagens no Chat
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(BASE_DIR, 'uploads/');
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname)); // Nome do arquivo único
  }
});
const upload = multer({ storage: storage });

// 3. Conexão com o Banco de Dados PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Função de inicialização da base de dados
const initializeDb = async () => {
  const client = await pool.connect();
  try {
    // Garantir que a extensão uuid-ossp esteja disponível
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
    console.log("Extensão 'uuid-ossp' verificada/criada com sucesso.");

    // Tabela de Utilizadores
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        settings JSONB,
        role VARCHAR(50) NOT NULL DEFAULT 'user',
        is_active BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    
    // Tabela de Histórico de Login
    await client.query(`
      CREATE TABLE IF NOT EXISTS login_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        login_timestamp TIMESTAMPTZ DEFAULT NOW(),
        ip_address VARCHAR(50)
      );
    `);
    
    // Tabela de Sessões Ativas
    await client.query(`
        CREATE TABLE IF NOT EXISTS active_sessions (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            email VARCHAR(255),
            last_seen TIMESTAMPTZ NOT NULL
        );
    `);

    // Tabela de Mensagens do Chat
    await client.query(`
        CREATE TABLE IF NOT EXISTS chat_messages (
            id SERIAL PRIMARY KEY,
            sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            message TEXT NOT NULL,
            sent_at TIMESTAMPTZ DEFAULT NOW(),
            is_read BOOLEAN DEFAULT false
        );
    `);

    // Tabela de Recuperação de Senha
    await client.query(`
        CREATE TABLE IF NOT EXISTS password_resets (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token VARCHAR(255) NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL
        );
    `);

    // Tabela de Status da Aplicação (Manutenção/Anúncios)
    await client.query(`
        CREATE TABLE IF NOT EXISTS app_status (
            key VARCHAR(50) PRIMARY KEY,
            value JSONB
        );
    `);

    // NOVA TABELA: user_costs para a planilha de custos
    await client.query(`
        CREATE TABLE IF NOT EXISTS user_costs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            category_id VARCHAR(50) NOT NULL,
            item_name VARCHAR(255) NOT NULL,
            description TEXT,
            value NUMERIC(10, 2) NOT NULL,
            frequency VARCHAR(50) NOT NULL,
            payment_date DATE,
            payment_method VARCHAR(50),
            card_last_digits VARCHAR(4),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
    `);
    
    console.log("Tabelas verificadas/criadas com sucesso.");

    // Lógica de Administração Reforçada
    const adminEmail = 'rudysilvaads@gmail.com';
    const adminPassword = '253031';

    const adminCheck = await client.query("SELECT id FROM users WHERE email = $1", [adminEmail]);

    if (adminCheck.rowCount === 0) {
        console.log(`Utilizador admin ${adminEmail} não encontrado. A criar...`);
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(adminPassword, salt);
        await client.query(
            "INSERT INTO users (email, password_hash, role, is_active, settings) VALUES ($1, $2, 'admin', true, '{}')",
            [adminEmail, passwordHash]
        );
        console.log(`Utilizador administrador ${adminEmail} criado com sucesso.`);
    } else {
        await client.query("UPDATE users SET role = 'admin', is_active = true WHERE email = $1", [adminEmail]);
        console.log(`Cargo de administrador e status ativo para ${adminEmail} verificado e garantido.`);
    }

  } catch (err) {
    console.error('Erro ao inicializar a base de dados:', err);
  } finally {
    client.release();
  }
};

// 4. Middlewares de Segurança
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Acesso negado. Nenhum token fornecido.' });
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ message: 'Token inválido ou expirado.' });
        req.user = decoded;
        next();
    });
};

const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Acesso negado. Recurso exclusivo para administradores.' });
    next();
};

// 5. Configuração do Nodemailer
let transporter;
if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT || 587,
        secure: (process.env.EMAIL_PORT || 587) == 465,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });
    console.log("Nodemailer configurado com sucesso.");
} else {
    console.error("ERRO CRÍTICO: As variáveis de ambiente para envio de e-mail (EMAIL_HOST, EMAIL_USER, EMAIL_PASS) não estão definidas. As funcionalidades de e-mail estarão desativadas.");
    transporter = null;
}


// 6. Rotas da API
app.post('/api/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });
    try {
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const result = await pool.query('INSERT INTO users (email, password_hash, settings, is_active) VALUES ($1, $2, $3, false) RETURNING id, email', [email, passwordHash, {}]);
        
        if (transporter) {
            const mailOptions = {
                from: `"La Casa Canais Darks" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: 'Bem-vindo à La Casa Canais Darks!',
                html: `
                    <div style="font-family: Arial, sans-serif; background-color: #111827; color: #e5e7eb; padding: 20px; text-align: center;">
                        <h1 style="color: #DC2626; font-family: Oswald, sans-serif;">BEM-VINDO!</h1>
                        <p style="font-size: 16px;">O seu registo na plataforma La Casa Canais Darks foi concluído com sucesso.</p>
                        <p style="font-size: 16px;">A sua conta está pendente de ativação por um administrador. Entraremos em contacto assim que o seu acesso for liberado.</p>
                        <p style="font-size: 14px;">Para acelerar o processo, pode entrar em contacto via WhatsApp.</p>
                    </div>
                `,
            };
            transporter.sendMail(mailOptions).catch(err => console.error("Falha ao enviar e-mail de boas-vindas:", err));
        }

        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: 'Este e-mail já está em uso.' });
        console.error(err);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password, rememberMe } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ message: 'Email ou senha inválidos.' });
        }
        
        if (!user.is_active) {
            return res.status(403).json({ message: 'Sua conta precisa ser ativada por um administrador.' });
        }

        const expiresIn = rememberMe ? '30d' : '24h';
        const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn });
        
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        await pool.query('INSERT INTO login_history (user_id, ip_address) VALUES ($1, $2)', [user.id, ip]);
        await pool.query(
            'INSERT INTO active_sessions (user_id, email, last_seen) VALUES ($1, $2, NOW()) ON CONFLICT (user_id) DO UPDATE SET last_seen = NOW(), email = $2',
            [user.id, user.email]
        );
        res.json({ 
            message: 'Login bem-sucedido!', 
            token,
            user: { id: user.id, email: user.email, role: user.role }
        });
    } catch (err) {
        console.error("ERRO DETALHADO NO LOGIN:", err);
        res.status(500).json({ message: `Erro interno: ${err.message}` });
    }
});

app.post('/api/forgot-password', async (req, res) => {
    if (!transporter) {
        return res.status(500).json({ message: 'Serviço de e-mail não configurado no servidor.' });
    }
    const { email } = req.body;
    try {
        const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userResult.rows.length === 0) {
            return res.status(200).json({ message: 'Se este e-mail estiver registado, um link de recuperação foi enviado.' });
        }
        const user = userResult.rows[0];
        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 3600000); // 1 hora

        await pool.query('INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)', [user.id, token, expires]);

        const resetLink = `http://${req.headers.host}/?reset_token=${token}`;
        
        const mailOptions = {
            from: `"La Casa Canais Darks" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Recuperação de Senha - La Casa Canais Darks',
            html: `
                <div style="font-family: Arial, sans-serif; background-color: #111827; color: #e5e7eb; padding: 20px; text-align: center;">
                    <h1 style="color: #DC2626; font-family: Oswald, sans-serif;">LA CASA CANAIS DARKS</h1>
                    <p style="font-size: 16px;">Recebemos um pedido para redefinir a sua senha.</p>
                    <p style="font-size: 16px;">Clique no botão abaixo para criar uma nova senha:</p>
                    <a href="${resetLink}" style="background-color: #DC2626; color: #ffffff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; margin: 20px 0;">REDEFINIR SENHA</a>
                    <p style="font-size: 14px;">Se você não solicitou isso, por favor, ignore este e-mail.</p>
                </div>
            `,
        };

        await transporter.sendMail(mailOptions);
        res.json({ message: 'Se este e-mail estiver registado, um link de recuperação foi enviado.' });

    } catch (error) {
        console.error("Erro em forgot-password:", error);
        res.status(500).json({ message: 'Erro interno do servidor ao tentar enviar o e-mail.' });
    }
});

app.post('/api/reset-password', async (req, res) => {
    const { token, password } = req.body;
    try {
        const resetResult = await pool.query('SELECT * FROM password_resets WHERE token = $1 AND expires_at > NOW()', [token]);
        if (resetResult.rows.length === 0) {
            return res.status(400).json({ message: 'Token inválido ou expirado.' });
        }
        const resetRequest = resetResult.rows[0];
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, resetRequest.user_id]);
        await pool.query('DELETE FROM password_resets WHERE id = $1', [resetRequest.id]);
        res.json({ message: 'Senha redefinida com sucesso.' });
    } catch (error) {
        console.error("Erro em reset-password:", error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

app.get('/api/verify-session', verifyToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, email, role FROM users WHERE id = $1', [req.user.id]);
        if (result.rows.length > 0) {
            res.json({ user: result.rows[0] });
        } else {
            res.status(404).json({ message: 'Utilizador não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

app.post('/api/heartbeat', verifyToken, async (req, res) => {
    try {
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
    } catch (error) {
        console.error('Erro no heartbeat:', error);
        res.sendStatus(500);
    }
});

app.get('/api/settings', verifyToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT settings FROM users WHERE id = $1', [req.user.id]);
        res.json(result.rows.length > 0 ? result.rows[0].settings || {} : {});
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

app.post('/api/settings', verifyToken, async (req, res) => {
    const { settings } = req.body;
    try {
        await pool.query('UPDATE users SET settings = $1 WHERE id = $2', [settings, req.user.id]);
        res.json({ message: 'Configurações salvas com sucesso!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

app.get('/api/status', verifyToken, async (req, res) => {
    try {
        const statusResult = await pool.query("SELECT key, value FROM app_status WHERE key IN ('maintenance', 'announcement')");
        const status = {
            maintenance: statusResult.rows.find(r => r.key === 'maintenance')?.value || { is_on: false, message: '' },
            announcement: statusResult.rows.find(r => r.key === 'announcement')?.value || null
        };
        res.json(status);
    } catch (error) {
        console.error("Erro ao buscar status da aplicação:", error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});


// 7. Rota Segura para Geração de Conteúdo com IA
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
        
        const errorMessage = lastError?.response?.data?.error?.message || lastError?.message || "Nenhuma API de IA disponível ou todas falharam.";
        return res.status(500).json({ message: `Falha ao gerar conteúdo. Verifique suas chaves de API. Último erro: ${errorMessage}` });

    } catch (error) {
        console.error("Erro geral na rota /api/generate:", error);
        res.status(500).json({ message: 'Erro interno do servidor ao processar a requisição de IA.' });
    }
});


// 8. Rotas da API (YouTube Data & Google Trends)
const getGoogleApiKey = async (userId) => {
    const result = await pool.query('SELECT settings FROM users WHERE id = $1', [userId]);
    return result.rows.length > 0 && result.rows[0].settings ? result.rows[0].settings.google_api : null;
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

// NOVAS ROTAS PARA A PLANILHA DE CUSTOS
app.get('/api/costs', verifyToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM user_costs WHERE user_id = $1 ORDER BY created_at ASC', [req.user.id]);
        res.json(result.rows);
    } catch (error) {
        console.error("Erro ao buscar custos do utilizador:", error);
        res.status(500).json({ message: "Erro interno do servidor ao buscar custos." });
    }
});

app.post('/api/costs', verifyToken, async (req, res) => {
    const { id, category_id, item_name, description, value, frequency, payment_date, payment_method, card_last_digits } = req.body;
    const userId = req.user.id;

    try {
        if (id) {
            // Atualizar item existente
            const result = await pool.query(
                `UPDATE user_costs SET 
                    category_id = $1, 
                    item_name = $2, 
                    description = $3, 
                    value = $4, 
                    frequency = $5, 
                    payment_date = $6, 
                    payment_method = $7, 
                    card_last_digits = $8,
                    updated_at = NOW()
                WHERE id = $9 AND user_id = $10 RETURNING *`,
                [category_id, item_name, description, value, frequency, payment_date, payment_method, card_last_digits, id, userId]
            );
            if (result.rowCount === 0) {
                return res.status(404).json({ message: "Item de custo não encontrado ou não pertence ao utilizador." });
            }
            res.json(result.rows[0]);
        } else {
            // Inserir novo item
            const result = await pool.query(
                `INSERT INTO user_costs 
                    (user_id, category_id, item_name, description, value, frequency, payment_date, payment_method, card_last_digits) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                [userId, category_id, item_name, description, value, frequency, payment_date, payment_method, card_last_digits]
            );
            res.status(201).json(result.rows[0]);
        }
    } catch (error) {
        console.error("Erro ao salvar/atualizar custo do utilizador:", error);
        res.status(500).json({ message: "Erro interno do servidor ao salvar custo." });
    }
});

app.delete('/api/costs/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    try {
        const result = await pool.query('DELETE FROM user_costs WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
        if (result.rowCount === 0) {
            return res.status(404).json({ message: "Item de custo não encontrado ou não pertence ao utilizador." });
        }
        res.json({ message: 'Item de custo excluído com sucesso.', id });
    } catch (error) {
        console.error("Erro ao excluir custo do utilizador:", error);
        res.status(500).json({ message: "Erro interno do servidor ao excluir custo." });
    }
});

app.delete('/api/costs', verifyToken, async (req, res) => {
    const userId = req.user.id;
    try {
        await pool.query('DELETE FROM user_costs WHERE user_id = $1', [userId]);
        res.json({ message: 'Todos os custos do utilizador foram excluídos com sucesso.' });
    } catch (error) {
        console.error("Erro ao excluir todos os custos do utilizador:", error);
        res.status(500).json({ message: "Erro interno do servidor ao excluir todos os custos." });
    }
});


// 9. Rotas de Administração
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

// NOVO: Rota para excluir um utilizador
app.delete('/api/admin/user/:userId', verifyToken, requireAdmin, async (req, res) => {
    const { userId } = req.params;
    // Prevenção para não excluir o admin principal (ID 1) ou a si mesmo
    if (userId === '1' || userId === req.user.id.toString()) {
        return res.status(403).json({ message: 'Este utilizador não pode ser excluído.' });
    }
    try {
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        res.json({ message: 'Utilizador excluído com sucesso.' });
    } catch (error) {
        console.error("Erro ao excluir utilizador:", error);
        res.status(500).json({ message: "Erro interno do servidor." });
    }
});


app.get('/api/admin/stats', verifyToken, requireAdmin, async (req, res) => {
    try {
        const totalUsersRes = await pool.query("SELECT COUNT(*) FROM users");
        const pendingUsersRes = await pool.query("SELECT COUNT(*) FROM users WHERE is_active = false");
        const onlineUsersRes = await pool.query("SELECT COUNT(*) FROM active_sessions WHERE last_seen > NOW() - INTERVAL '5 minutes'");
        const logins24hRes = await pool.query("SELECT COUNT(*) FROM login_history WHERE login_timestamp > NOW() - INTERVAL '24 hours'");

        res.json({
            totalUsers: totalUsersRes.rows[0].count,
            pendingActivation: pendingUsersRes.rows[0].count,
            onlineNow: onlineUsersRes.rows[0].count,
            loginsLast24h: logins24hRes.rows[0].count
        });
    } catch (error) {
        console.error("Erro ao buscar estatísticas do admin:", error);
        res.status(500).json({ message: "Erro interno do servidor." });
    }
});

app.post('/api/admin/maintenance', verifyToken, requireAdmin, async (req, res) => {
    const { isOn, message } = req.body; 
    try {
        const value = { is_on: isOn, message };
        await pool.query(
            "INSERT INTO app_status (key, value) VALUES ('maintenance', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
            [value]
        );
        res.json({ message: 'Status de manutenção atualizado.' });
    } catch (error) {
        console.error("Erro ao atualizar status de manutenção:", error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

app.post('/api/admin/announcement', verifyToken, requireAdmin, async (req, res) => {
    const { message } = req.body;
    try {
        const value = { message, timestamp: new Date() };
        await pool.query(
            "INSERT INTO app_status (key, value) VALUES ('announcement', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
            [value]
        );
        res.json({ message: 'Anúncio global publicado.' });
    } catch (error) {
        console.error("Erro ao publicar anúncio:", error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

app.delete('/api/admin/announcement', verifyToken, requireAdmin, async (req, res) => {
    try {
        await pool.query("DELETE FROM app_status WHERE key = 'announcement'");
        res.json({ message: 'Anúncio limpo com sucesso.' });
    } catch (error) {
        console.error("Erro ao limpar anúncio:", error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

// 10. ROTAS DE CHAT
app.get('/api/chat/users', verifyToken, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                u.id as user_id, 
                u.email,
                (SELECT COUNT(*) FROM chat_messages WHERE sender_id = u.id AND receiver_id = $1 AND is_read = false) as unread_count,
                (SELECT EXISTS (SELECT 1 FROM active_sessions WHERE user_id = u.id AND last_seen > NOW() - INTERVAL '5 minutes')) as is_online
            FROM users u
            WHERE u.id != $1
            ORDER BY is_online DESC, u.email;
        `, [req.user.id]);
        res.json(result.rows);
    } catch (error) {
        console.error("Erro ao listar utilizadores do chat:", error);
        res.status(500).json({ message: "Erro interno do servidor." });
    }
});

app.get('/api/chat/history/:peerId', verifyToken, async (req, res) => {
    const myId = req.user.id;
    const peerId = parseInt(req.params.peerId, 10);
    try {
        await pool.query(
            "UPDATE chat_messages SET is_read = true WHERE sender_id = $1 AND receiver_id = $2",
            [peerId, myId]
        );
        const result = await pool.query(`
            SELECT * FROM chat_messages 
            WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
            ORDER BY sent_at ASC;
        `, [myId, peerId]);
        res.json(result.rows);
    } catch (error) {
        console.error("Erro ao buscar histórico do chat:", error);
        res.status(500).json({ message: "Erro interno do servidor." });
    }
});

app.post('/api/chat/send', verifyToken, async (req, res) => {
    const { receiverId, message } = req.body;
    const senderId = req.user.id;
    if (!receiverId || !message) return res.status(400).json({ message: "Destinatário e mensagem são obrigatórios." });
    try {
        await pool.query(
            "INSERT INTO chat_messages (sender_id, receiver_id, message) VALUES ($1, $2, $3)",
            [senderId, receiverId, message]
        );
        res.sendStatus(201);
    } catch (error) {
        console.error("Erro ao enviar mensagem:", error);
        res.status(500).json({ message: "Erro interno do servidor." });
    }
});

app.post('/api/chat/upload', verifyToken, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('Nenhum ficheiro enviado.');
    }
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ imageUrl });
});


app.get('/api/chat/notifications', verifyToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT sender_id, COUNT(*) as unread_count 
            FROM chat_messages 
            WHERE receiver_id = $1 AND is_read = false 
            GROUP BY sender_id;
        `, [req.user.id]);
        res.json(result.rows);
    } catch (error) {
        console.error("Erro ao buscar notificações:", error);
        res.status(500).json({ message: "Erro interno do servidor." });
    }
});

app.get('/api/chat/admin-status', verifyToken, async (req, res) => {
    try {
        const result = await pool.query("SELECT 1 FROM active_sessions WHERE user_id = 1 AND last_seen > NOW() - INTERVAL '5 minutes'");
        res.json({ isAdminOnline: result.rowCount > 0 });
    } catch (error) {
        console.error("Erro ao verificar status do admin:", error);
        res.status(500).json({ message: "Erro interno do servidor." });
    }
});


// 11. Rota Genérica (Catch-all) para SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'public', 'index.html'));
});

// 12. Inicialização do Servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  initializeDb();
});
