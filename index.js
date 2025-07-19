const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// ===== Firebase Admin SDK Initialization =====
const serviceAccount = require('./assignment11-b015f-firebase-adminsdk-fbsvc-c82e843442.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

// ===== Middleware to verify Firebase ID Token =====
const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).send({ error: 'Unauthorized access - No token provided' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = await admin.auth().verifyIdToken(token);
        console.log('Decoded token:', decoded);
        if (!decoded.email) {
            return res.status(403).send({ error: 'No email found in token' });
        }
        req.decoded = decoded;
        next();
    } catch (error) {
        console.error('Token verification failed:', error);
        return res.status(403).send({ error: 'Forbidden - Invalid token' });
    }
};

// ===== General Middleware =====
app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true,
}));
app.use(express.json());

// ===== MongoDB Setup =====
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
        tls: true,
    },
});

async function run() {
    try {
        await client.connect();
        console.log('Connected to MongoDB!');

        const db = client.db('foodshare');
        const usersCollection = db.collection('users');
        const foodCollection = db.collection('food');
        const foodRequestCollection = db.collection('requestedfoods');

        // ===== User Routes =====
        app.post('/users', async (req, res) => {
            const { email, name, photourl } = req.body;

            try {
                const existingUser = await usersCollection.findOne({ email });
                if (existingUser) {
                    return res.status(200).send({ message: 'User already exists' });
                }
                const result = await usersCollection.insertOne({ email, name, photourl });
                res.status(201).send({ insertedId: result.insertedId });
            } catch (err) {
                console.error('Error inserting user:', err);
                res.status(500).send({ error: 'Failed to save user' });
            }
        });

        app.get('/users', async (req, res) => {
            try {
                const users = await usersCollection.find().toArray();
                res.json(users);
            } catch (err) {
                console.error('Error fetching users:', err);
                res.status(500).send({ error: 'Failed to fetch users' });
            }
        });

        // ===== Food Routes =====
        app.post('/food', async (req, res) => {
            const foodData = req.body;
            try {
                const result = await foodCollection.insertOne(foodData);
                res.status(201).send({ insertedId: result.insertedId });
            } catch (err) {
                console.error('Error inserting food:', err);
                res.status(500).send({ error: 'Failed to add food' });
            }
        });

        // Search and list available foods
        app.get('/food', async (req, res) => {
            try {
                const search = req.query.search || '';
                const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

                const filter = {
                    foodStatus: 'available',
                    foodName: { $regex: search, $options: 'i' }
                };

                const foods = await foodCollection
                    .find(filter)
                    .sort({ expiredDateTime: sortOrder })
                    .toArray();

                res.json(foods);
            } catch (err) {
                console.error('Error fetching foods:', err);
                res.status(500).send({ error: 'Failed to fetch foods' });
            }
        });



        // Featured foods route: top 6 available foods sorted by quantity (desc)
        app.get('/featured-foods', async (req, res) => {
            try {
                const filter = { foodStatus: 'available' };
                const foods = await foodCollection
                    .find(filter)
                    .sort({ foodQuantity: -1 }) // highest quantity first
                    .limit(6)
                    .toArray();

                res.json(foods);
            } catch (err) {
                console.error('Error fetching featured foods:', err);
                res.status(500).send({ error: 'Failed to fetch featured foods' });
            }
        });


        app.get('/food/:id', async (req, res) => {
            try {
                const food = await foodCollection.findOne({ _id: new ObjectId(req.params.id) });
                if (!food) {
                    return res.status(404).send({ error: 'Food not found' });
                }
                res.json(food);
            } catch (err) {
                console.error('Error fetching food by ID:', err);
                res.status(500).send({ error: 'Failed to fetch food' });
            }
        });

        app.put('/food/:id', async (req, res) => {
            const updatedFood = req.body;
            try {
                const result = await foodCollection.updateOne(
                    { _id: new ObjectId(req.params.id) },
                    { $set: updatedFood }
                );
                if (result.modifiedCount > 0) {
                    res.send({ message: 'Food updated' });
                } else {
                    res.status(404).send({ message: 'Food not updated or not found' });
                }
            } catch (err) {
                console.error('Error updating food:', err);
                res.status(500).send({ error: 'Failed to update food' });
            }
        });

        app.patch('/food/:id', async (req, res) => {
            const { foodStatus } = req.body;
            try {
                const result = await foodCollection.updateOne(
                    { _id: new ObjectId(req.params.id) },
                    { $set: { foodStatus: foodStatus || 'requested' } }
                );
                res.send(result);
            } catch (err) {
                console.error('Error updating food status:', err);
                res.status(500).send({ error: 'Failed to update food status' });
            }
        });

        app.delete('/food/:id', async (req, res) => {
            try {
                const result = await foodCollection.deleteOne({ _id: new ObjectId(req.params.id) });
                if (result.deletedCount === 1) {
                    res.json({ message: 'Food deleted successfully' });
                } else {
                    res.status(404).json({ error: 'Food not found' });
                }
            } catch (err) {
                console.error('Error deleting food:', err);
                res.status(500).json({ error: 'Failed to delete food' });
            }
        });

        app.get('/manage-food', verifyToken, async (req, res) => {
            const donorEmail = req.query.email;
            const decodedEmail = req.decoded.email;

            if (donorEmail !== decodedEmail) {
                return res.status(403).json({ error: 'Forbidden access' });
            }

            try {
                const foods = await foodCollection.find({ donorEmail }).toArray();
                res.json(foods);
            } catch (error) {
                console.error('Failed to fetch user foods:', error);
                res.status(500).json({ error: 'Failed to fetch foods' });
            }
        });

        // ===== Food Requests Routes =====
        app.post('/requestedfoods', async (req, res) => {
            const data = req.body;
            try {
                const result = await foodRequestCollection.insertOne(data);
                res.status(201).send({ insertedId: result.insertedId });
            } catch (err) {
                console.error('Error inserting food request:', err);
                res.status(500).send({ error: 'Failed to save request' });
            }
        });

        // Protected route: get requests of logged in user
        app.get('/myfoodrequest', verifyToken, async (req, res) => {
            const userEmail = req.query.email;
            const decodedEmail = req.decoded.email;

            if (userEmail !== decodedEmail) {
                return res.status(403).send({ message: 'Forbidden access' });
            }

            try {
                const result = await foodRequestCollection.find({ userEmail }).toArray();
                res.send(result);
            } catch (err) {
                console.error('Error fetching food requests:', err);
                res.status(500).send({ error: 'Failed to fetch requests' });
            }
        });

        // ===== Root Route =====
        app.get('/', (req, res) => {
            res.send('Server is up and running!');
        });

        // ===== Start Server =====
        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });
    } catch (err) {
        console.error('Connection error:', err);
    }
}

run().catch(console.dir);
