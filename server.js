import express from "express";
import cors from "cors";
import metaforgeRouter from "./routes.js";
import path from "path";
import { fileURLToPath } from "url";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 8080;

// allow frontend to call your backend
app.use(cors({
  origin: ['https://raiderdle.com', 'https://www.raiderdle.com', 'https://host-3yl.pages.dev'],
  credentials: true, // Erlaubt Cookies/Auth-Header, falls du sie später brauchst
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204
}));

// parse json request bodies
app.use(express.json());

// VERY IMPORTANT for preflight
app.options('*', cors());


app.use(
  "/api/icons/image",
  (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  },
  express.static(path.join(__dirname, "icons"))
);

// mount your router
app.use("/api", metaforgeRouter);

// start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
