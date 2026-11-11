import axios from "axios";

const api = axios.create({
    // Vite proxies /api to Express during local development.
    // Set VITE_BASE_URL to your deployed backend URL in production.
    baseURL: import.meta.env.VITE_BASE_URL || "",
    withCredentials: true,
});

export default api;
