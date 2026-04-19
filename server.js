const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());

// MongoDB connect
mongoose.connect(process.env.MONGO_URL)
.then(() => console.log("MongoDB Connected"))
.catch(err => console.log(err));

// Models
const User = mongoose.model("User", {
  uid: String,
  phone: String
});

const Contact = mongoose.model("Contact", {
  userId: String,
  name: String,
  phone: String
});

const Message = mongoose.model("Message", {
  from: String,
  to: String,
  text: String,
  timestamp: Number
});

// TEST
app.get("/", (req, res) => {
  res.send("Server Running 🚀");
});

// USER SAVE
app.post("/api/user", async (req, res) => {
  const { uid, phone } = req.body;

  let user = await User.findOne({ uid });
  if (!user) {
    user = await User.create({ uid, phone });
  }

  res.json({ success: true });
});

// SAVE CONTACT
app.post("/api/save-contact", async (req, res) => {
  const { userId, name, phone } = req.body;

  await Contact.create({ userId, name, phone });

  res.json({ success: true });
});

// SEND MESSAGE
app.post("/api/send-message", async (req, res) => {
  const { from, to, text } = req.body;

  const msg = await Message.create({
    from,
    to,
    text,
    timestamp: Date.now()
  });

  io.to(to).emit("new-message", msg);

  res.json({ success: true });
});

// SOCKET
io.on("connection", (socket) => {
  socket.on("join", (uid) => {
    socket.join(uid);
  });
});

server.listen(3000, () => {
  console.log("Server running...");
});