const dotenv = require('dotenv');
const mongoose = require('mongoose');

const connectDatabase = require('../src/config/db');
const { seedDummyTasks } = require('../src/services/task-service');

dotenv.config();

async function run() {
  try {
    await connectDatabase();
    const report = await seedDummyTasks();
    console.log('Task seed complete:', JSON.stringify(report, null, 2));
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Task seed failed:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

run();
