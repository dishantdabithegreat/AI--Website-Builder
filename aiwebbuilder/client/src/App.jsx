import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// Layouts
import { GuestLayout, AuthLayout } from './pages/Layout';

// Pages
import HomePage from './pages/HomePage';
import BuilderPage from './pages/BuilderPage';
import PreviewPage from './pages/PreviewPage';
import PublishPage from './pages/PublishPage';
import AuthPage from './pages/AuthPage';

const App = () => {
  return (
    <>
      <Toaster />
      <Routes>
        {/* Guest / Login Routes */}
        <Route element={<GuestLayout />}>
          <Route path='/login' element={<AuthPage mode="login" />} />
          <Route path='/register' element={<AuthPage mode="register" />} />
        </Route>

        {/* Protected / Authenticated Routes */}
        <Route element={<AuthLayout />}>
          <Route path='/' element={<HomePage />} />
          <Route path='/builder/:id' element={<BuilderPage />} />
          <Route path='/preview/:id' element={<PreviewPage />} />
        </Route>

        {/* Public Routes */}
        <Route path='/publish/:id' element={<PublishPage />} />
        
        {/* Catch-all / Redirect to Home */}
        <Route path='*' element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
};

export default App;