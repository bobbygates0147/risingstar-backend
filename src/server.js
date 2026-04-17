const path = require('path');
const dotenv = require('dotenv');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

dotenv.config();

const connectDatabase = require('./config/db');
const contentRoutes = require('./routes/content');
const authRoutes = require('./routes/auth');
const currencyRoutes = require('./routes/currency');
const dashboardRoutes = require('./routes/dashboard');
const adminRoutes = require('./routes/admin');
const aiBotRoutes = require('./routes/ai-bot');
const leaderboardRoutes = require('./routes/leaderboard');
const profileRoutes = require('./routes/profile');
const referralsRoutes = require('./routes/referrals');
const walletRoutes = require('./routes/wallet');
const { ensureAdminUser } = require('./services/auth-service');

const app = express();
const port = Number(process.env.PORT || 4000);
const downloadsDir = path.resolve(__dirname, '..', 'downloads');

app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(morgan('dev'));

app.use('/media', express.static(downloadsDir));
app.use('/api/currency', currencyRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', contentRoutes);
app.use('/api', dashboardRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/referrals', referralsRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ai-bot', aiBotRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Uploaded file is too large' });
  }

  if (err && Number.isInteger(err.statusCode)) {
    return res.status(err.statusCode).json({ message: err.message || 'Request failed' });
  }

  console.error(err);
  return res.status(500).json({ message: 'Internal server error' });
});

async function start() {
  try {
    await connectDatabase();
    await ensureAdminUser();
    app.listen(port, () => {
      console.log(`Backend running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

start();
