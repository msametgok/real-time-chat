// src/components/UserProfileCard.jsx
import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { LogOut, Settings } from 'lucide-react';

export default function UserProfileCard() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div
        className="flex items-center space-x-2 cursor-pointer px-4 py-3 hover:bg-slate-700"
        onClick={() => setOpen(o => !o)}
      >
        <div className="h-8 w-8 rounded-full bg-indigo-500 flex items-center justify-center text-white">
          {user.username.charAt(0).toUpperCase()}
        </div>
        <div className="text-sm text-white truncate">{user.username}</div>
      </div>

      {open && (
        <div className="absolute left-0 mt-1 w-48 bg-slate-800 text-white rounded shadow-lg z-10">
          <button
            className="w-full flex items-center px-4 py-2 hover:bg-slate-700"
            onClick={() => {
              // placeholder for settings action
              console.log('Go to settings');
            }}
          >
            <Settings size={16} className="mr-2" /> Settings
          </button>
          <button
            className="w-full flex items-center px-4 py-2 hover:bg-slate-700"
            onClick={logout}
          >
            <LogOut size={16} className="mr-2" /> Logout
          </button>
        </div>
      )}
    </div>
  );
}
