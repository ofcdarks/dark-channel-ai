// server.js

// 1. Importação de Módulos
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcryptjs');
const { google } = require('googleapis');
const googleTrends = require('google-trends-api');
const axios = require('axios');

// 2. Configuração Inicial
const app = express();
const PORT = process.env.PORT || 3000;

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

// Helper para validar a estrutura da resposta do explorador de subnichos
const validateSubnicheData = (data) => {
    if (!Array.isArray(data) || data.length === 0) return false;
    for (const item of data) {
        if (!item.scores || typeof item.scores.Potencial !== 'number' || typeof item.scores.Concorrência !== 'number' || typeof item.scores.Originalidade !== 'number') {
            console.warn("Item de subnicho com estrutura de 'scores' inválida foi encontrado e descartado:", item);
            return false;
        }
    }
    return true;
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


// 5. [ATUALIZADO] Rota Segura para Geração de Conteúdo com IA
app.post('/api/generate', async (req, res) => {
    const userId = req.headers['x-user-id'];
    const { prompt, schema } = req.body;

    if (!userId) return res.status(401).json({ message: "Usuário não autenticado." });
    if (!prompt) return res.status(400).json({ message: "O prompt é obrigatório." });

    try {
        const settingsResult = await pool.query('SELECT settings FROM users WHERE id = $1', [userId]);
        if (settingsResult.rows.length === 0) return res.status(404).json({ message: 'Usuário não encontrado.' });
        
        const apiKeys = settingsResult.rows[0].settings || {};
        const openAIKey = apiKeys.openai;
        const geminiKeys = (apiKeys.gemini || []).filter(k => k && k.trim() !== '');
        let lastError = null;

        // Tentativa 1: OpenAI (se a chave existir)
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
                if (schema) {
                    try {
                        const parsedContent = JSON.parse(content);
                        const isSubnicheRequest = schema?.items?.properties?.subniche_name;
                        if (isSubnicheRequest && !validateSubnicheData(parsedContent)) {
                            throw new Error("OpenAI retornou dados de subnicho malformados.");
                        }
                        data = parsedContent;
                    } catch (parseError) {
                        throw new Error(`Falha ao decodificar JSON da OpenAI: ${parseError.message}`);
                    }
                } else {
                    data = { text: content };
                }
                console.log("Sucesso com OpenAI.");
                return res.json({ data: data, apiSource: 'OpenAI' });

            } catch (error) {
                lastError = error;
                console.error("Erro na API da OpenAI, tentando Gemini como fallback:", error.message);
            }
        }

        // Tentativa 2: Gemini (fallback ou padrão)
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
                        if (schema) {
                             try {
                                const parsedContent = JSON.parse(text);
                                const isSubnicheRequest = schema?.items?.properties?.subniche_name;
                                if (isSubnicheRequest && !validateSubnicheData(parsedContent)) {
                                    throw new Error("Gemini retornou dados de subnicho malformados.");
                                }
                                data = parsedContent;
                            } catch (parseError) {
                                throw new Error(`Falha ao decodificar JSON da Gemini: ${parseError.message}`);
                            }
                        } else {
                            data = { text: text };
                        }
                        console.log("Sucesso com Gemini.");
                        return res.json({ data: data, apiSource: 'Gemini' });
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


// 6. Rotas da API (YouTube Data & Google Trends)
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
            maxResults: 50, 
            order: 'relevance'
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


// 7. Rota Genérica (Catch-all) para servir o index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 8. Inicialização do Servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  initializeDb();
});
