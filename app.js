// app.js
// const express = require('express');
import express from 'express';
const app = express();
// const path = require('path');
import path from 'path';
import { fileURLToPath } from 'url';

// require('dotenv').config();
import dotenv from 'dotenv';
dotenv.config();

// const session = require('express-session');
import session from 'express-session';

// const passport = require('./config/passport');
import passport from './config/passport.js';

// const db = require('./config/db');
import db from './config/db.js';
db();

// const userRouter = require('./routes/userRoutes');
// const adminRouter = require('./routes/adminRoutes');
import userRouter from './routes/userRoutes.js';
import adminRouter from './routes/adminRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: 'connect.sid',
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 48 * 60 * 60 * 1000 // 48 hours
    }
  })
);

//passport
app.use(passport.initialize());
app.use(passport.session());

const noCache = (req, res, next) => {
 
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
};

// app.use(noCache);

app.use(express.static(path.join(__dirname, 'public')));

//view engine setup
app.set('view engine', 'ejs');
app.set('views', [path.join(__dirname, 'views/user'), path.join(__dirname, 'views/admin')]);

//ping route for smoke testing 
app.get('/ping', (req, res) => {
  console.log('PING endpoint hit');
  res.send('pong');
});

app.use((req, res, next) => {
  res.locals.allowRender = false;
  next();
});

//routers
app.use('/', userRouter);
app.use('/admin', adminRouter);

//error halndler
app.use((err, req, res, next) => {
  console.error('Unhandled error for', req.method, req.originalUrl, err);
  if (res.headersSent) return next(err);
  return res.status(500).render('page-404', { message: 'Something went wrong', user: null });
});

//Start server 
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`server running on http://localhost:${port}`);
});

export default app;
