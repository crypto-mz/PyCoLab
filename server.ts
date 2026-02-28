import express from "express";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import cors from "cors";
import Database from "better-sqlite3";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-for-dev";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Initialize SQLite DB
const db = new Database("app.db");

// Setup tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    nickname TEXT,
    avatar_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS admitted_users (
    email TEXT PRIMARY KEY,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    description TEXT,
    code TEXT,
    tags TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add initial admitted user if empty
const admittedCount = db.prepare("SELECT COUNT(*) as count FROM admitted_users").get() as { count: number };
if (admittedCount.count === 0) {
  // Add the user who created the applet
  db.prepare("INSERT INTO admitted_users (email) VALUES (?)").run("config.shu@gmail.com");
}

// Add some sample templates if empty
const templatesCount = db.prepare("SELECT COUNT(*) as count FROM templates").get() as { count: number };
if (templatesCount.count === 0) {
  const insertTemplate = db.prepare("INSERT INTO templates (title, description, code, tags) VALUES (?, ?, ?, ?)");
  insertTemplate.run(
    "Hello World",
    "A simple hello world script.",
    "print('Hello, World!')",
    "basic,intro"
  );
  insertTemplate.run(
    "Fibonacci",
    "Calculate Fibonacci sequence.",
    "def fib(n):\n    if n <= 1:\n        return n\n    return fib(n-1) + fib(n-2)\n\nprint(fib(10))",
    "math,algorithm"
  );
}

app.use(cors());
app.use(express.json());
app.use(cookieParser());

// --- Auth Middleware ---
const authenticate = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    (req as any).user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
};

// --- API Routes ---

// 1. Auth Routes
app.get("/api/auth/github/url", (req, res) => {
  const redirectUri = `${process.env.APP_URL}/api/auth/github/callback`;
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: "GitHub Client ID not configured" });
  }
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=user:email`;
  res.json({ url });
});

app.get("/api/auth/github/callback", async (req, res) => {
  const { code } = req.query;
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!code || !clientId || !clientSecret) {
    return res.status(400).send("Missing code or credentials");
  }

  try {
    // Exchange code for token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      throw new Error("Failed to get access token");
    }

    // Get user info
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userData = await userRes.json();

    // Get user emails (primary email might be hidden)
    const emailRes = await fetch("https://api.github.com/user/emails", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const emails = await emailRes.json();
    const primaryEmailObj = emails.find((e: any) => e.primary) || emails[0];
    const email = primaryEmailObj?.email;

    if (!email) {
      throw new Error("No email found for GitHub user");
    }

    // Check if admitted
    const isAdmitted = db.prepare("SELECT * FROM admitted_users WHERE email = ?").get(email);
    if (!isAdmitted) {
      return res.status(403).send(`
        <html><body>
          <h2>Access Denied</h2>
          <p>Your email (${email}) is not on the admitted list.</p>
          <script>
            setTimeout(() => window.close(), 3000);
          </script>
        </body></html>
      `);
    }

    // Upsert user
    const existingUser = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
    let userId = existingUser?.id;
    let nickname = existingUser?.nickname || userData.login;

    if (!existingUser) {
      userId = userData.id.toString();
      db.prepare("INSERT INTO users (id, email, nickname, avatar_url) VALUES (?, ?, ?, ?)").run(
        userId,
        email,
        nickname,
        userData.avatar_url
      );
    }

    // Create JWT
    const token = jwt.sign({ id: userId, email, nickname, avatar_url: userData.avatar_url }, JWT_SECRET, {
      expiresIn: "7d",
    });

    // Set cookie
    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Close popup and notify parent
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error("OAuth Error:", err);
    res.status(500).send("Authentication failed: " + err.message);
  }
});

app.get("/api/auth/me", authenticate, (req, res) => {
  const user = (req as any).user;
  const dbUser = db.prepare("SELECT id, email, nickname, avatar_url FROM users WHERE id = ?").get(user.id);
  res.json(dbUser || user);
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("auth_token", {
    httpOnly: true,
    secure: true,
    sameSite: "none",
  });
  res.json({ success: true });
});

// 2. User Settings
app.put("/api/users/me/nickname", authenticate, (req, res) => {
  const { nickname } = req.body;
  if (!nickname || nickname.trim() === "") {
    return res.status(400).json({ error: "Nickname cannot be empty" });
  }
  const user = (req as any).user;
  db.prepare("UPDATE users SET nickname = ? WHERE id = ?").run(nickname, user.id);
  res.json({ success: true, nickname });
});

// 3. Admin: Admitted Users
app.get("/api/admin/admitted", authenticate, (req, res) => {
  // In a real app, check if user is admin. For now, anyone admitted can view/edit.
  const users = db.prepare("SELECT email, added_at FROM admitted_users ORDER BY added_at DESC").all();
  res.json(users);
});

app.post("/api/admin/admitted", authenticate, (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  try {
    db.prepare("INSERT INTO admitted_users (email) VALUES (?)").run(email);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: "Email already admitted or error occurred" });
  }
});

app.delete("/api/admin/admitted/:email", authenticate, (req, res) => {
  const { email } = req.params;
  db.prepare("DELETE FROM admitted_users WHERE email = ?").run(email);
  res.json({ success: true });
});

// 4. Templates
app.get("/api/templates", authenticate, (req, res) => {
  const templates = db.prepare("SELECT * FROM templates ORDER BY created_at DESC").all();
  res.json(templates);
});

// 5. Co-pilot Chat
app.post("/api/copilot/chat", authenticate, async (req, res) => {
  const { message, code } = req.body;
  if (!message) return res.status(400).json({ error: "Message required" });

  try {
    const prompt = `
You are an expert Python Co-pilot. The user is asking a question or requesting an edit.
Here is the current code in their editor:
\`\`\`python
${code}
\`\`\`

User's message: ${message}

Provide a helpful, concise response. If you suggest code changes, provide them clearly.
`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    
    res.json({ reply: response.text });
  } catch (err: any) {
    console.error("Gemini Error:", err);
    res.status(500).json({ error: "Failed to get response from Co-pilot" });
  }
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
