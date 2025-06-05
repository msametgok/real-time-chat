import React from 'react';
import { Outlet } from 'react-router-dom';

function AuthLayout() {
  return (
    <div className="bg-gradient-to-br from-slate-900 to-slate-800 min-h-screen flex items-center justify-center p-4 font-['Inter',_sans-serif]">
      <Outlet />
    </div>
  );
}
export default AuthLayout;