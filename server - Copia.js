// server.js

// 1. Importação de Módulos
// Express.js para criar o servidor e as rotas da API.
// pg (node-postgres) para conectar e interagir com o banco de dados PostgreSQL.
// path para lidar com caminhos de arquivos (ex: servir o index.html).
// bcryptjs para criptografar as senhas dos usuários de forma segura.
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcryptjs');

// 2. Configuração Inicial
const app = express();
// A porta será fornecida pelo EasyPanel via variável de ambiente, ou usamos 3000 para desenvolvimento local.
const PORT = process.env.PORT || 3000;

// Middlewares para o Express
// Habilita o parsing de JSON no corpo das requisições (ex: vindo de um formulário de login).
app.use(express.json());
// Serve todos os arquivos estáticos (HTML, CSS, JS do cliente) da pasta 'public'.
app.use(express.static(path.join(__dirname, 'public')));

// 3. Conexão com o Banco de Dados PostgreSQL
// O EasyPanel fornecerá a URL de conexão completa como uma variável de ambiente.
// Isso mantém nossas credenciais seguras e fora do código.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Necessário para conexões em ambientes como Heroku/EasyPanel
  }
});

// Função para criar a tabela de usuários se ela não existir.
// Isso garante que a aplicação funcione na primeira vez que for executada.
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

// 4. Rotas da API (Endpoints)

// Rota para Registro de Novos Usuários
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });
  }

  try {
    // Criptografa a senha antes de salvar no banco. Nunca salve senhas em texto plano!
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await pool.query(
      'INSERT INTO users (email, password_hash, settings) VALUES ($1, $2, $3) RETURNING id, email',
      [email, passwordHash, {}] // Inicia com configurações vazias
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    // Código '23505' é o erro de violação de unicidade (e-mail já existe)
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Este e-mail já está em uso.' });
    }
    console.error(err);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
});

// Rota para Login de Usuários
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        // Verifica se o usuário existe e se a senha está correta
        if (user && await bcrypt.compare(password, user.password_hash)) {
            // Login bem-sucedido. Em uma app real, você geraria um token (JWT).
            // Para simplificar, retornamos o ID e o e-mail.
            res.json({ id: user.id, email: user.email, message: 'Login bem-sucedido!' });
        } else {
            res.status(401).json({ message: 'Credenciais inválidas.' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

// Rota para Obter as Configurações de um Usuário
app.get('/api/settings/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query('SELECT settings FROM users WHERE id = $1', [userId]);
        if (result.rows.length > 0) {
            res.json(result.rows[0].settings || {}); // Retorna um objeto vazio se as configurações forem nulas
        } else {
            res.status(404).json({ message: 'Usuário não encontrado.' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

// Rota para Salvar as Configurações de um Usuário
app.post('/api/settings/:userId', async (req, res) => {
    const { userId } = req.params;
    const { settings } = req.body; // Espera um objeto JSON com as configurações

    try {
        const result = await pool.query(
            'UPDATE users SET settings = $1 WHERE id = $2 RETURNING id',
            [settings, userId]
        );
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


// 5. Rota Genérica (Catch-all)
// Se nenhuma rota da API for correspondida, serve o arquivo `index.html`.
// Isso é crucial para que a aplicação de página única (SPA) funcione corretamente.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 6. Inicialização do Servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  // Garante que a tabela do banco de dados exista antes de aceitar conexões.
  initializeDb();
});
