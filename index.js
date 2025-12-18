require('dotenv').config(); // Must be first
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
    console.log("Connected to MongoDB successfully!");

    const db = client.db('ticketKati');
    const usersCollection = db.collection('users');
    const vendorsCollection = db.collection('vendors');
    const adminCollection = db.collection('admin');
    const ticketsCollection = db.collection('Alltickets');
    const bookingsCollection = db.collection('bookings');
    const transactionsCollection = db.collection('transactions');

    // -------------------------------
    // Get all tickets
    app.get('/all-tickets', async (req, res) => {
      const result = await ticketsCollection.find().toArray();
      res.send(result);
    });

    // Get single ticket
    app.get('/ticket/:id', async (req, res) => {
      const { id } = req.params;
      const ticket = await ticketsCollection.findOne({ _id: new ObjectId(id) });
      res.send({ success: true, result: ticket });
    });

    // -------------------------------
    // All bookings
    app.get('/bookings', async (req, res) => {
      try {
        const bookings = await bookingsCollection.find().toArray();
        const detailedBookings = await Promise.all(
          bookings.map(async (b) => {
            const ticket = await ticketsCollection.findOne({ _id: new ObjectId(b.ticketId) });
            return { ...b, ticket };
          })
        );
        res.json(detailedBookings);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    // -------------------------------
    // Create booking
    app.post('/bookings', async (req, res) => {
      try {
        const { ticketId, userEmail, quantity, status, bookingDate } = req.body;

        if (!ticketId || !userEmail || !quantity) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        const ticket = await ticketsCollection.findOne({ _id: new ObjectId(ticketId) });
        if (!ticket) return res.status(404).json({ message: "Ticket not found" });

        if (quantity > ticket.quantity) {
          return res.status(400).json({ message: "Not enough seats available" });
        }

        await ticketsCollection.updateOne(
          { _id: new ObjectId(ticketId) },
          { $inc: { quantity: -quantity } }
        );

        const newBooking = {
          ticketId,
          userEmail,
          quantity,
          status: status || "pending",
          bookingDate: bookingDate || new Date(),
        };

        await bookingsCollection.insertOne(newBooking);

        res.status(201).json({ success: true, booking: newBooking });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    // -------------------------------
    // Vendor: requested bookings (pending)
    app.get('/vendor-bookings/:vendorEmail', async (req, res) => {
      try {
        const vendorEmail = req.params.vendorEmail;

        const vendorTickets = await ticketsCollection.find({ vendorEmail }).toArray();
        const ticketIds = vendorTickets.map(t => t._id.toString());

        const bookings = await bookingsCollection.find({
          ticketId: { $in: ticketIds },
          status: "pending"
        }).toArray();

        const detailedBookings = bookings.map(b => {
          const ticket = vendorTickets.find(t => t._id.toString() === b.ticketId);
          return { ...b, ticket };
        });

        res.json(detailedBookings);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    // -------------------------------
    // Accept booking
    app.patch('/bookings/accept/:id', async (req, res) => {
      const { id } = req.params;
      try {
        await bookingsCollection.updateOne(
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
    app.patch('/bookings/reject/:id', async (req, res) => {
      const { id } = req.params;
      try {
        await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "rejected" } }
        );
        res.json({ success: true, message: "Booking rejected" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    // -------------------------------
    // Stripe payment - create checkout session
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { cost, bookingName, senderEmail, bookingId } = req.body;

    if (!cost || !bookingId || !senderEmail) {
      return res.status(400).json({ message: "Missing payment info" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(cost * 100), // cents
            product_data: {
              name: bookingName || "Ticket Booking",
            },
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      customer_email: senderEmail,
      metadata: {
        bookingId: bookingId,
      },
      success_url: `${process.env.SITE_DOMAIN}/dashboard/user/booked-tickets-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_DOMAIN}/dashboard/user/booked-tickets-cancelled`,
    });

    res.send({
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("Stripe error:", error);
    res.status(500).json({ message: "Stripe payment failed" });
  }
});



// Payment success verify & update booking
app.patch('/payment-success', async (req, res) => {
  try {
    const sessionId = req.query.session_id;

    if (!sessionId) {
      return res.status(400).send({ message: "Session ID missing" });
    }

    // 1️⃣ Get Stripe session
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const bookingId = session.metadata.bookingId;

    // 2️⃣ Get booking
    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(bookingId),
    });

    if (!booking) {
      return res.status(404).send({ message: "Booking not found" });
    }

    // Already paid? stop
    if (booking.status === "paid") {
      return res.send({ success: true, message: "Already paid" });
    }

    // 3️⃣ Update booking status → PAID
    await bookingsCollection.updateOne(
      { _id: new ObjectId(bookingId) },
      { $set: { status: "paid" } }
    );

    // 4️⃣ Reduce ticket quantity (IMPORTANT)
    await ticketsCollection.updateOne(
      { _id: new ObjectId(booking.ticketId) },
      { $inc: { quantity: -booking.quantity } }
    );

    // 5️⃣ Save transaction (optional but recommended)
    await transactionsCollection.insertOne({
      bookingId: bookingId,
      sessionId: sessionId,
      amount: session.amount_total / 100,
      email: session.customer_email,
      paymentStatus: session.payment_status,
      createdAt: new Date(),
    });

    res.send({ success: true });
  } catch (error) {
    console.error("Payment success error:", error);
    res.status(500).send({ message: "Payment verification failed" });
  }
});

// Get transaction history for a user
app.get('/transactions/:email', async (req, res) => {
  try {
    const email = req.params.email;

    const transactions = await transactionsCollection
      .find({ userEmail: email })
      .sort({ paymentDate: -1 })
      .toArray();

    res.send(transactions);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load transactions" });
  }
});


// -------------------------------
// Vendor adds a ticket
app.post('/tickets', async (req, res) => {
  try {
    const ticketData = req.body;

    // Validate required fields
    const requiredFields = ['title', 'from', 'to', 'transportType', 'price', 'quantity', 'departureDate', 'departureTime', 'vendorName', 'vendorEmail'];
    for (const field of requiredFields) {
      if (!ticketData[field]) {
        return res.status(400).json({ error: `${field} is required` });
      }
    }

    // Prevent negative quantity
    if (ticketData.quantity < 0) ticketData.quantity = 0;

    // Set verification status
    ticketData.verificationStatus = "pending";
    ticketData.createdAt = new Date();

    const result = await ticketsCollection.insertOne(ticketData);
    res.status(201).json({ success: true, ticket: ticketData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to add ticket" });
  }
});


// -------------------------------
// Get tickets added by a vendor
app.get('/tickets/vendor/:email', async (req, res) => {
  try {
    const vendorEmail = req.params.email;
    const tickets = await ticketsCollection.find({ vendorEmail }).toArray();
    res.json(tickets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch vendor tickets" });
  }
});
 

// -------------------------------
// Admin approves a ticket
app.patch('/tickets/approve/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await ticketsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { verificationStatus: "approved" } }
    );
    res.json({ success: true, message: "Ticket approved" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to approve ticket" });
  }
});

// Admin rejects a ticket
app.patch('/tickets/reject/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await ticketsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { verificationStatus: "rejected" } }
    );
    res.json({ success: true, message: "Ticket rejected" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to reject ticket" });
  }
});


// -------------------------------
// Get all approved tickets
app.get('/tickets/approved', async (req, res) => {
  try {
    const tickets = await ticketsCollection.find({ verificationStatus: "approved" }).toArray();
    res.json(tickets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch tickets" });
  }
});


    // -------------------------------
    // Register user/vendor
    app.post('/register', async (req, res) => {
      try {
        const { name, email, photo, role } = req.body;
        if (!name || !email || !role) return res.status(400).send({ error: 'Name, email, role required' });

        const existsInUsers = await usersCollection.findOne({ email });
        const existsInVendors = await vendorsCollection.findOne({ email });

        if (existsInUsers || existsInVendors) return res.status(400).send({ error: 'Email already exists' });

        const newUser = { name, email, photo, role, createdAt: new Date() };
        if (role === "user") await usersCollection.insertOne(newUser);
        else if (role === "vendor") await vendorsCollection.insertOne(newUser);
        else return res.status(400).send({ error: 'Invalid role' });

        res.status(201).send({ success: true, data: newUser });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // -------------------------------
    // Get user role
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
    // optional: client.close();
  }
}

run().catch(console.dir);

// Test route
app.get('/', (req, res) => res.send('Server is running'));

// Start server
app.listen(port, () => console.log(`Server listening on port ${port}`));
