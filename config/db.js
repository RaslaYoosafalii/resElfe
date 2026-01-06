// config/db.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('database connected');
  } catch (error) {
    console.log('database connection error', error.message);
    process.exit(1);
  }
};

export default connectDB;
