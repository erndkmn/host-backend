import express from "express";
import cors from "cors";
import metaforgeRouter from "./routes.js";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from 'express-rate-limit';

const bugLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
});




const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 8080;

// Apply CORS globally
app.use(cors({
  origin: ['https://raiderdle.com', 'https://www.raiderdle.com', 'https://host-3yl.pages.dev', 'https://erndkmn.github.io'],
  credentials: true,
}));

// Static route for images
app.use("/api/icons/image", express.static(path.join(__dirname, "icons")));

// Preflight handler (already optional if cors() is used globally)
app.options('*', cors());

// Your router
app.use("/api", metaforgeRouter);

// Bug report with rate limiter
app.post('/api/bug-report', bugLimiter, handler);


// start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
