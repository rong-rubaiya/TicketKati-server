const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
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
    const allticketsCol = db.collection('Alltickets');
    const bookingsCol = db.collection('bookings');

    console.log("Connected to MongoDB successfully!");



    // all tickets 

    app.get('/all-tickets',async(req,res)=>{
          const result = await allticketsCol.find().toArray();
      res.send(result);
    })

    // single ticket

    app.get('/ticket/:id',async (req, res) => {
      const { id } = req.params;
      const result = await allticketsCol.findOne({ _id: new ObjectId(id) });
      res.send({ success: true, result });
    });

    // bookings

    app.post("/bookings", async (req, res) => {
  try {
    const { ticketId, userEmail, quantity } = req.body;

    // 1️⃣ Validate input
    if (!ticketId || !userEmail || !quantity) {
      return res.status(400).json({ message: "Missing fields" });
    }

    // 2️⃣ Check ticket availability
    const ticket = await allticketsCol.findOne({ _id: new ObjectId(ticketId) });
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    if (ticket.quantity < quantity) {
      return res.status(400).json({ message: "Not enough seats available" });
    }

    // 3️⃣ Save booking
    const booking = {
      ticketId,
      userEmail,
      quantity,
      status: "Pending",
      bookingDate: new Date()
    };
    const result = await bookingsCol.insertOne(booking);

    // 4️⃣ Update ticket quantity
    await allticketsCol.updateOne(
      { _id: new ObjectId(ticketId) },
      { $inc: { quantity: -quantity } }
    );

    res.status(201).json({ success: true, bookingId: result.insertedId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// bookings

app.get("/bookings/:email", async (req, res) => {
  try {
    const userEmail = req.params.email;
    const bookings = await bookingsCol.find({ userEmail }).toArray();



    app.get("/bookings/:email", async (req, res) => {
  try {
    const userEmail = req.params.email;
    const bookings = await bookingsCol.find({ userEmail }).toArray();

    // Populate ticket info
    const detailedBookings = await Promise.all(
      bookings.map(async (b) => {
        const ticket = await allticketsCol.findOne({ _id: new ObjectId(b.ticketId) });
        return { ...b, ticket };
      })
    );

    res.json(detailedBookings);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});



// Accept booking
app.patch("/bookings/accept/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const booking = await bookingsCol.findOne({ _id: new ObjectId(id) });
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    await bookingsCol.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "accepted" } }
    );

    res.json({ success: true, message: "Booking accepted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Reject booking
app.patch("/bookings/reject/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const booking = await bookingsCol.findOne({ _id: new ObjectId(id) });
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    await bookingsCol.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "rejected" } }
    );

    res.json({ success: true, message: "Booking rejected" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});










    // Optionally populate ticket info
    const detailedBookings = await Promise.all(
      bookings.map(async (b) => {
        const ticket = await allticketsCol.findOne({ _id: new ObjectId(b.ticketId) });
        return { ...b, ticket };
      })
    );

    res.json(detailedBookings);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});
    

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
