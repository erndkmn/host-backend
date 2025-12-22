import express from "express";
import cors from "cors";
import metaforgeRouter from "./routes.js";

const app = express();
const PORT = 8080;

// allow frontend to call your backend
app.use(cors({
  origin: ['https://raiderdle.com', 'https://www.raiderdle.com', 'https://host-3yl.pages.dev', 'https://erndkmn.github.io/host/'],
  credentials: true, // Erlaubt Cookies/Auth-Header, falls du sie später brauchst
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204
}));

// parse json request bodies
app.use(express.json());

// VERY IMPORTANT for preflight
app.options('*', cors());

// mount your router
app.use("/api", metaforgeRouter);

// start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
