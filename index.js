const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.dqh3ts3.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db('ticketKati');
    const usersCollection = db.collection('users');
    const vendorsCollection = db.collection('vendors');
    const adminCollection = db.collection('admin');

    console.log("Connected to MongoDB successfully!");

    // POST register user/vendor
    app.post('/register', async (req, res) => {
      const { name, email, photo, role } = req.body;

      if (!name || !email || !role) {
        return res.status(400).send({ error: 'Name, email, and role are required' });
      }

      // Check duplicate
      const existsInUsers = await usersCollection.findOne({ email });
      const existsInVendors = await vendorsCollection.findOne({ email });

      if (existsInUsers || existsInVendors) {
        return res.status(400).send({ error: 'Email already exists' });
      }

      const newUser = { name, email, photo, role, createdAt: new Date() };

      let result;
      if (role === "user") result = await usersCollection.insertOne(newUser);
      else if (role === "vendor") result = await vendorsCollection.insertOne(newUser);
      else return res.status(400).send({ error: 'Invalid role' });

      res.status(201).send({ success: true, data: newUser });
    });

    // Get role by email (used in login)
    app.get('/user-role/:email', async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      if (user) return res.send({ role: 'user', id: user._id });

      const vendor = await vendorsCollection.findOne({ email });
      if (vendor) return res.send({ role: 'vendor', id: vendor._id });

      const admin = await adminCollection.findOne({ email });
      if (admin) return res.send({ role: 'admin', id: admin._id });

      return res.status(404).send({ error: 'User not found' });
    });

  } finally {
    // client.close(); optional
  }
}

run().catch(console.dir);

app.get('/', (req, res) => res.send('Server is running'));
app.listen(port, () => console.log(`Server listening on port ${port}`));
