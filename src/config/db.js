const mongoose = require('mongoose');

async function connectDatabase() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/risingstar';
  await mongoose.connect(mongoUri, {
    autoIndex: true,
  });
  console.log('MongoDB connected');
}

module.exports = connectDatabase;
