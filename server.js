import express from "express";
import cors from "cors";
import metaforgeRouter from "./routes.js";

const app = express();
const PORT = 443;

// allow frontend to call your backend
app.use(cors({
  origin: '*', // or specify your frontend domain
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// parse json request bodies
app.use(express.json());

// mount your router
app.use("/api", metaforgeRouter);

// start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
