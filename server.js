const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ==================== MONGODB CONNECTION ====================
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL || "mongodb://localhost:27017/whatsapp", {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log("✅ MongoDB Connected Successfully");
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err.message);
    process.exit(1);
  }
};

connectDB();

// ==================== SCHEMAS ====================
const UserSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  name: { type: String, default: "" },
  dp: { type: String, default: "" },
  online: { type: Boolean, default: false },
  lastSeen: { type: Number, default: Date.now },
  createdAt: { type: Number, default: Date.now }
});

const ContactSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  savedAt: { type: Number, default: Date.now }
});

const ChatSchema = new mongoose.Schema({
  participants: [{ type: String }],
  createdAt: { type: Number, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
  chatId: { type: String, required: true },
  sender: { type: String, required: true },
  text: { type: String, required: true },
  timestamp: { type: Number, default: Date.now },
  read: { type: Boolean, default: false },
  readAt: { type: Number, default: null }
});

const UserChatSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  chatId: { type: String, required: true },
  otherUid: { type: String, required: true },
  lastMessage: { type: String, default: "" },
  lastMessageTime: { type: Number, default: Date.now },
  unreadCount: { type: Number, default: 0 }
});

const User = mongoose.model("User", UserSchema);
const Contact = mongoose.model("Contact", ContactSchema);
const Chat = mongoose.model("Chat", ChatSchema);
const Message = mongoose.model("Message", MessageSchema);
const UserChat = mongoose.model("UserChat", UserChatSchema);

// ==================== MIDDLEWARE ====================
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ==================== ROUTES ====================

// Health Check
app.get("/", (req, res) => {
  res.json({ 
    status: "🚀 Server Running", 
    time: new Date().toISOString(),
    connections: io.engine.clientsCount 
  });
});

// SAVE/UPDATE USER
app.post("/api/user", asyncHandler(async (req, res) => {
  const { uid, phone, name, dp } = req.body;
  if (!uid || !phone) return res.status(400).json({ error: "UID and phone required" });

  let user = await User.findOne({ uid });
  if (user) {
    if (name) user.name = name;
    if (dp) user.dp = dp;
    user.lastSeen = Date.now();
    await user.save();
  } else {
    user = await User.create({ uid, phone, name: name || "", dp: dp || "", online: true, lastSeen: Date.now() });
  }
  res.json({ success: true, user });
}));

// GET USER BY PHONE
app.get("/api/user/phone/:phone", asyncHandler(async (req, res) => {
  const user = await User.findOne({ phone: req.params.phone });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ uid: user.uid, name: user.name, phone: user.phone, dp: user.dp, online: user.online, lastSeen: user.lastSeen });
}));

// UPDATE PROFILE
app.put("/api/user/profile", asyncHandler(async (req, res) => {
  const { uid, name, dp } = req.body;
  if (!uid) return res.status(400).json({ error: "UID required" });
  const user = await User.findOneAndUpdate({ uid }, { name, dp, lastSeen: Date.now() }, { new: true });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ success: true, user });
}));

// SAVE CONTACT
app.post("/api/contacts", asyncHandler(async (req, res) => {
  const { userId, name, phone } = req.body;
  if (!userId || !name || !phone) return res.status(400).json({ error: "userId, name, phone required" });
  const contact = await Contact.create({ userId, name, phone });
  res.json({ success: true, contact });
}));

// GET CONTACTS
app.get("/api/contacts/:userId", asyncHandler(async (req, res) => {
  const contacts = await Contact.find({ userId: req.params.userId }).sort({ savedAt: -1 });
  res.json({ success: true, contacts });
}));

// DELETE CONTACT
app.delete("/api/contacts/:contactId", asyncHandler(async (req, res) => {
  await Contact.findByIdAndDelete(req.params.contactId);
  res.json({ success: true });
}));

// START CHAT
app.post("/api/chats/start", asyncHandler(async (req, res) => {
  const { uid1, uid2 } = req.body;
  if (!uid1 || !uid2) return res.status(400).json({ error: "Both UIDs required" });

  const chatId = [uid1, uid2].sort().join("_");
  let chat = await Chat.findOne({ participants: { $all: [uid1, uid2] } });
  
  if (!chat) {
    chat = await Chat.create({ _id: chatId, participants: [uid1, uid2] });
    await UserChat.create({ userId: uid1, chatId, otherUid: uid2 });
    await UserChat.create({ userId: uid2, chatId, otherUid: uid1 });
  }
  res.json({ success: true, chatId });
}));

// GET USER CHATS
app.get("/api/chats/:userId", asyncHandler(async (req, res) => {
  const userChats = await UserChat.find({ userId: req.params.userId }).sort({ lastMessageTime: -1 });
  const chatsWithUsers = await Promise.all(userChats.map(async (uc) => {
    const otherUser = await User.findOne({ uid: uc.otherUid });
    return {
      chatId: uc.chatId, otherUid: uc.otherUid, otherName: otherUser?.name || "Unknown",
      otherPhone: otherUser?.phone || "", otherDp: otherUser?.dp || "",
      otherOnline: otherUser?.online || false, otherLastSeen: otherUser?.lastSeen || Date.now(),
      lastMessage: uc.lastMessage, lastMessageTime: uc.lastMessageTime, unreadCount: uc.unreadCount
    };
  }));
  res.json({ success: true, chats: chatsWithUsers });
}));

// SEND MESSAGE
app.post("/api/messages", asyncHandler(async (req, res) => {
  const { chatId, sender, text } = req.body;
  if (!chatId || !sender || !text) return res.status(400).json({ error: "chatId, sender, text required" });

  const chat = await Chat.findById(chatId);
  if (!chat) return res.status(404).json({ error: "Chat not found" });

  const otherUid = chat.participants.find(p => p !== sender);
  const message = await Message.create({ chatId, sender, text, timestamp: Date.now(), read: false });

  await UserChat.updateOne({ userId: sender, chatId }, { lastMessage: text, lastMessageTime: Date.now() });
  await UserChat.updateOne({ userId: otherUid, chatId }, { lastMessage: text, lastMessageTime: Date.now(), $inc: { unreadCount: 1 } });

  io.to(otherUid).emit("new-message", { ...message.toObject(), chatId });
  res.json({ success: true, message });
}));

// GET MESSAGES
app.get("/api/messages/:chatId", asyncHandler(async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  const messages = await Message.find({ chatId: req.params.chatId }).sort({ timestamp: 1 }).skip(parseInt(offset)).limit(parseInt(limit));
  res.json({ success: true, messages });
}));

// MARK MESSAGES AS READ
app.put("/api/messages/read", asyncHandler(async (req, res) => {
  const { chatId, userId } = req.body;
  await Message.updateMany({ chatId, sender: { $ne: userId }, read: false }, { read: true, readAt: Date.now() });
  await UserChat.updateOne({ userId, chatId }, { unreadCount: 0 });
  
  const chat = await Chat.findById(chatId);
  const sender = chat.participants.find(p => p !== userId);
  io.to(sender).emit("messages-read", { chatId });
  res.json({ success: true });
}));

// DELETE MESSAGE
app.delete("/api/messages/:messageId", asyncHandler(async (req, res) => {
  await Message.findByIdAndDelete(req.params.messageId);
  res.json({ success: true });
}));

// ==================== SOCKET.IO ====================
const onlineUsers = new Map();

io.on("connection", (socket) => {
  console.log("🔌 New connection:", socket.id);

  socket.on("join", async (uid) => {
    socket.userId = uid;
    socket.join(uid);
    onlineUsers.set(uid, socket.id);
    await User.findOneAndUpdate({ uid }, { online: true, lastSeen: Date.now() });
    socket.broadcast.emit("user-online", { uid });
    console.log(`✅ User ${uid} joined`);
  });

  socket.on("typing", async ({ chatId, uid, isTyping }) => {
    const chat = await Chat.findById(chatId);
    if (chat) {
      const otherUid = chat.participants.find(p => p !== uid);
      io.to(otherUid).emit("typing", { chatId, uid, isTyping });
    }
  });

  socket.on("disconnect", async () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      await User.findOneAndUpdate({ uid: socket.userId }, { online: false, lastSeen: Date.now() });
      socket.broadcast.emit("user-offline", { uid: socket.userId, lastSeen: Date.now() });
      console.log(`❌ User ${socket.userId} disconnected`);
    }
  });
});

// ==================== ERROR HANDLING ====================
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  res.status(500).json({ error: "Internal server error", message: err.message });
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
