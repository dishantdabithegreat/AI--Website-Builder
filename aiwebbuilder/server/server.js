import express from "express";
import "dotenv/config";
import cors from "cors";
import cookieParser from "cookie-parser";
import { connectToDatabase } from "./config/db.js";
import authRouter from "./routes/authRoutes.js";
import projectRouter from "./routes/projectRoutes.js";

const app = express();

await connectToDatabase()

const allowedOrigins = (process.env.ORIGINS || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(cookieParser())
app.use(express.json())

app.get("/", (req, res)=> res.send("Server is Live!"))
app.use('/api/auth', authRouter)
app.use('/api/projects', projectRouter)

app.use((err, _req,res,_next)=>{
    console.error(`[Error] ${err.message}`);
    res.status(500).json({ error: err.message || "Internal server error" })
})

const port = process.env.PORT || 3000;

app.listen(port, () =>{
    console.log(`server is running at http://localhost:${port}`)
})