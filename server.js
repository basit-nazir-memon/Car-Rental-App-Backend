const express = require('express')
const mongoose = require('mongoose')

const authRoute = require('./routes/auth');
const carsRoute = require('./routes/cars');

const cors = require('cors');
require('dotenv').config()

const app = express()

mongoose.connect(`mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@cluster0.t1ompdc.mongodb.net/${process.env.DATABASE_NAME}`, { useNewUrlParser: true })

const db = mongoose.connection;

db.on('error', console.error.bind(console, 'connection error: '));
db.once('open', ()=>{
    console.log("MongoDB Connection Successfull");
});

app.use(express.json());

app.use(cors());

app.use('/', authRoute);

app.use('/cars', carsRoute);

app.get('/status', (req, res)=> {
    res.status(200).json({
        status: 'Up',
        frontend: process.env.FRONT_END_URL
    })
})

app.listen(process.env.PORT, () => console.log(`App listening on port ${process.env.PORT}!`))