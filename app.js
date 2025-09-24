const express = require('express')
const app = express();
const path = require('path')
const env = require('dotenv').config()
const db = require('./config/db');
db()

const userRouter = require('./routes/userRouter')

app.use(express.json());
app.use(express.urlencoded({extended: true}))

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))
app.use(express.static(path.join(__dirname,'public')))


app.use('/', userRouter)

const port = process.env.PORT
app.listen(port, () => {
    console.log(`server running on port http://localhost:${port}`)
})

module.exports = app;