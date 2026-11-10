# AI Web Builder

An AI-powered web application builder that generates websites from natural language prompts.

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- MongoDB (local installation or MongoDB Atlas connection string)

## Installation

1. Install server dependencies:
```bash
cd server
npm install
```

2. Install client dependencies:
```bash
cd ../client
npm install
```

## Environment Setup

Create a `.env` file in the `server` directory with the following variables:

```env
MONGODB_URI=mongodb://localhost:27017/aiwebbuilder
PORT=3000
ORIGINS=http://localhost:5173
```

Replace `MONGODB_URI` with your MongoDB connection string if using MongoDB Atlas.

## Running the Project

### Terminal 1 - Start the Server:
```bash
cd server
npm run dev
```
The server will run at `http://localhost:3000`

### Terminal 2 - Start the Client:
```bash
cd client
npm run dev
```
The application will be available at `http://localhost:5173` (or the next available port if 5173 is in use)

## Building for Production

### Server Production:
```bash
cd server
npm start
```

### Client Production:
```bash
cd client
npm run build
npm run preview
```

## Current Features

### Backend Features:
- User authentication (Register, Login, Logout)
- JWT-based session management
- Protected routes with middleware
- MongoDB database integration
- CORS-enabled API

### Frontend Features:
- AI-powered website generation from text prompts
- Real-time code preview
- File explorer and code editor
- Project management dashboard
- Export projects as ZIP files
- Published website preview
- Responsive design with Tailwind CSS

## Project Structure

```
aiwebbuilder/
├── client/          # React frontend application
│   ├── src/
│   │   ├── components/  # Reusable components
│   │   ├── pages/       # Page components
│   │   ├── context/     # React context providers
│   │   ├── api/         # API configuration
│   │   └── utils/       # Utility functions
│   └── public/          # Static assets
└── server/          # Express backend
    ├── config/         # Database configuration
    ├── controllers/    # Route controllers
    ├── middleware/     # Authentication middleware
    ├── models/         # MongoDB models
    ├── routes/         # API routes
    └── services/       # Business logic
```

## Tech Stack

### Frontend:
- React 19, Vite
- Tailwind CSS v4
- Sandpack (CodeSandbox)
- React Router v7
- Axios
- Lucide React
- React Hot Toast

### Backend:
- Node.js, Express
- MongoDB, Mongoose
- JWT Authentication
- bcrypt for password hashing
- CORS, cookie-parser
