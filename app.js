const express = require('express')
const app = express();
const env = require('dotenv').config()
const db = require('./config/db');
db()



const port = process.env.PORT
app.listen(port, () => {
    console.log(`server running on port http://localhost:${port}`)
})

module.exports = app;