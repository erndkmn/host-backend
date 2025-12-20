import express from "express";
import cors from "cors";
import metaforgeRouter from "./routes.js";

const app = express();
const PORT = 3001;

// allow frontend to call your backend
app.use(cors());

// parse json request bodies
app.use(express.json());

// mount your router
app.use("/api", metaforgeRouter);

// start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
