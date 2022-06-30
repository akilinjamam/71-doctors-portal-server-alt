// server for doctors portal
const express = require('express')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const cors = require('cors');
// const res = require('express/lib/response');
const app = express()
require('dotenv').config();
const port = process.env.PORT || 5000

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

// middle ware

app.use(cors())
app.use(express.json())

app.get('/', (req, res) => {
    res.send('Hellow frm doctors portal')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})





const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ncob7.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;

console.log(uri)


const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

// this section is for jwt
//--------------------------------------------------------------------------
function verifyJWT(req, res, next) {
    // console.log('abc')
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'Un-Authorized Access' })
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {

        if (err) {
            return res.status(403).send({ message: 'Forbidden Access' });
        }
        req.decoded = decoded
        next()
    });
}

//--------------------------------------------------------------------------

// operatin CRUD operation.

async function run() {

    try {
        await client.connect()
        console.log('data base connected')
        const serviceCollection = client.db('doctors_portal').collection('service')
        const bookingCollection = client.db('doctors_portal').collection('bookings')
        const userCollection = client.db('doctors_portal').collection('users')
        const doctorCollection = client.db('doctors_portal').collection('doctors')
        const paymentCollection = client.db('doctors_portal').collection('payment')
        const completeCollection = client.db('doctors_portal').collection('complete')
        const doneCollection = client.db('doctors_portal').collection('done')

        console.log('all route is working');

        // verify wether users are admins or normal users. 
        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });

            if (requesterAccount.role === 'admin') {
                next()
            } else {

                res.status(403).send({ message: 'forbidden' })
            }

        }
        //--------------------------------------------------------------



        app.get('/service', async (req, res) => {

            const query = {};
            const cursor = serviceCollection.find(query).project({ name: 1 });
            const services = await cursor.toArray();
            res.send(services);
        })

        //--------------------------------------------------------------

        // for payment method
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const service = req.body;
            const price = service.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
            res.send({ clientSecret: paymentIntent.client_secret })
        })

        //-----------------------------------------------------------------

        app.get('/available', async (req, res) => {
            const date = req.query.date || 'May 15, 2022'

            // step: 1 get all services

            const services = await serviceCollection.find().toArray();

            // step: 2 get the booking of that day
            const query = { date: date }
            const bookingss = await bookingCollection.find(query).toArray();

            // step: 3, forEach service, find bookings for that service
            services.forEach(service => {
                // step: 4, find bookings for that service. output: [{}, {}, {}, {}]
                const servicesBookings = bookingss.filter(book => book.treatment === service.name);
                // step: 5, select slots for the service bookings: ['', ''. '', '', '',]
                const booked = servicesBookings.map(s => s.slots)
                // step: 6, select those slots that are not in bookedSlots
                const available = service.time.filter(s => !booked.includes(s))
                // step: 7, set available to the service to make it easier.
                service.time = available
            })

            res.send(services)
        })

        //--------------------------------------------------------------------------------

        app.get('/user', verifyJWT, async (req, res) => {

            const query = {}
            const cursor = userCollection.find(query);
            const users = await cursor.toArray();
            res.send(users)
        })

        //-----------------------------------------------------------------------------------


        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin });
        })
        //-------------------------------------------------------------------------------------

        // to make an user admin and checking the user who is giving permission to make an admin, is admin or normal user. if he is a normal user, he is not allowed to create admin and if he is an admin he can do so.

        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' }
            }
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);

        })

        //--------------------------------------------------------------------------------------

        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user
            }

            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ result, token });

        })

        //-----------------------------------------------------------------------------------

        app.get('/bookings', verifyJWT, async (req, res) => {
            const patient = req.query.patient;

            //taking token from UI
            //--------------------------------------------
            const decodedEmail = req.decoded.email;
            if (patient === decodedEmail) {

                const query = { patient: patient }
                const cursor = bookingCollection.find(query);
                const booking = await cursor.toArray();
                return res.send(booking);

            }

            else {
                return res.status(403).send({ message: 'Forbidden Access' })
            }

        })

        //----------------------------------------------------------------------------------

        app.get('/bookings/:id', verifyJWT, async (req, res) => {

            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingCollection.findOne(query);
            res.send(booking);
        })

        //------------------------------------------------------------------------------

        app.patch('/bookings/:id', async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId,
                }
            }

            const updateBooking = await bookingCollection.updateOne(filter, updatedDoc);
            const result = await paymentCollection.insertOne(payment)
            res.send(updatedDoc);
        })

        //--------------------------------------------------------------------------------------


        app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {

            const doctors = await doctorCollection.find().toArray();
            res.send(doctors);
        })


        //---------------------------------------------------------------------------------------
        app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {

            const doctors = req.body;
            const result = await doctorCollection.insertOne(doctors);
            res.send(result)
        })

        //----------------------------------------------------------------------------------------

        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {

            const email = req.params.email;
            const filter = { email: email };
            const result = await doctorCollection.deleteOne(filter);
            res.send(result);

        })

        //----------------------------------------------------------------------------------------


        app.post('/bookings', async (req, res) => {

            const bookings = req.body;
            const query = { treatment: bookings.treatment, date: bookings.date, patient: bookings.patient }
            const exist = await bookingCollection.findOne(query);
            if (exist) {
                return res.send({ success: false, bookings: exist })
            }

            const result = await bookingCollection.insertOne(bookings);
            return res.send({ success: true, result });
        })

        // -------------------------------------------------------------------------

        // this part is for task management website.

        app.get('/complete', async (req, res) => {

            const query = {}
            const cursor = completeCollection.find(query);
            const complete = await cursor.toArray();
            res.send(complete)
        })

        app.post('/complete', async (req, res) => {

            const theTask = req.body;
            const result = await completeCollection.insertOne(theTask);
            res.send(result)
        })

        app.post('/done', async (req, res) => {

            const theDeed = req.body;
            const result = await doneCollection.insertOne(theDeed);
            res.send(result)
        })

        app.get('/done', async (req, res) => {

            const query = {}
            const cursor = doneCollection.find(query);
            const done = await cursor.toArray();
            res.send(done)
        })


        app.put('/complete/:id', async (req, res) => {
            const id = req.params.id;
            const updateTaskData = req.body
            const filter = { _id: ObjectId(id) }
            const options = { upsert: true }
            const updateDoc = {
                $set: {

                    task: updateTaskData.task,

                }
            };

            const result = await completeCollection.updateOne(filter, updateDoc, options);
            res.send(result)
        })






        //--------------------------------------------------------------------------
    }
    finally {

    }


}

run().catch(console.dir)
