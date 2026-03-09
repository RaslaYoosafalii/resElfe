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

import methodOverride from 'method-override';

import userRouter from './routes/userRoutes.js';
import adminRouter from './routes/adminRoutes.js';
import STATUS_CODES from './utils/statusCodes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(methodOverride('_method'));

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
app.locals.imageUrl = function (img) {

  if (!img) return '/images/placeholder.png';

  // If already an S3 URL
  if (img.startsWith('http')) {
    return img;
  }

  // Otherwise it's a local file
  return '/uploads/products/' + img;
};

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
app.use('/',noCache, userRouter);
app.use('/admin',noCache, adminRouter);

//fallback handler 
app.use((req, res) => {

  // admin route
  if (req.originalUrl.startsWith('/admin')) {
    return res.status(STATUS_CODES.NOT_FOUND).render('error-page'); 
  }

  // user routes
  return res.status(STATUS_CODES.NOT_FOUND).render('page-404', {
    message: 'Page not found'
  });

});


//error halndler
app.use((err, req, res, next) => {
  console.error('Unhandled error for', req.method, req.originalUrl, err);
  if (res.headersSent) return next(err);
  return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).render('page-404', { message: 'Something went wrong', user: null });
});


//Start server 
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`server running on http://localhost:${port}`);
});

export default app;
