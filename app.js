const express = require('express')
const app = express();
const path = require('path')
const env = require('dotenv').config()
const session = require('express-session');
const passport = require('./config/passport')
const db = require('./config/db');
db()

const userRouter = require('./routes/userRoutes')
const adminRouter = require('./routes/adminRoutes');

app.use(express.json());
app.use(express.urlencoded({extended: true}))
app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized:false,
        cookie:{
            secure:false,
            httpOnly:true,
            maxAge:72*60*60*1000
        }
    }))

app.use(passport.initialize())
app.use(passport.session());

app.use((req,res,next) => {
    res.set('Cache-Control','no-store')
    next();
})

const noCache = (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
};

app.set('view engine', 'ejs')
app.set('views', [path.join(__dirname, 'views/user'), path.join(__dirname, 'views/admin')]);
app.use(express.static(path.join(__dirname,'public')))


app.use(noCache);
app.use((req, res, next) => {
  console.log(new Date().toISOString(), req.method, req.originalUrl);
  next();
});

app.use('/', userRouter)
app.use('/admin', adminRouter);

const port = process.env.PORT
app.listen(port, () => {
    console.log(`server running on port http://localhost:${port}`)
})

module.exports = app;
