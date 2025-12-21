import express from "express";
import cors from "cors";
import metaforgeRouter from "./routes.js";

const app = express();
const PORT = 8080;

// allow frontend to call your backend
app.use(cors({
  origin: ['https://raiderdle.com/', 'https://www.raiderdle.com/'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true, // Erlaubt Cookies/Auth-Header, falls du sie später brauchst
  optionsSuccessStatus: 204
}));

// parse json request bodies
app.use(express.json());

// mount your router
app.use("/api", metaforgeRouter);

// start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
