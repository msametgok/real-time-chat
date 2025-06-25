import React, { useEffect, useState } from "react";

export default function MessageStatusTicks({ message }) {
  const [status, setStatus] = useState("sent");

  useEffect(() => {
    const timer = setTimeout(() => {
      if (message.isReadByAll) {
        setStatus("read");
      } else if (message.deliveredToAll) {
        setStatus("delivered");
      } else {
        setStatus("sent");
      }
    }, 100); // 100ms buffer to let socket events catch up

    return () => clearTimeout(timer);
  }, [message._id, message.deliveredToAll, message.isReadByAll]);

  if (status === "read") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-5 h-5 text-red-500"
        aria-label="Read by all"
      >
        <path
          fillRule="evenodd"
          d="M16.28 7.22a.75.75 0 010 1.06l-7.5 7.5a.75.75 
             0 01-1.06 0l-3.5-3.5a.75.75 
             0 111.06-1.06l2.97 2.97 6.97-6.97a.75.75 
             0 011.06 0zm-2.25 
             1.5a.75.75 0 010 1.06l-7.5 7.5a.75.75 
             0 01-1.06 0l-3.5-3.5a.75.75 
             0 111.06-1.06l2.97 2.97 6.97-6.97a.75.75 
             0 011.06 0z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  if (status === "delivered") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-5 h-5 text-slate-500"
        aria-label="Delivered"
      >
        <path
          fillRule="evenodd"
          d="M16.28 7.22a.75.75 0 010 1.06l-7.5 7.5a.75.75 
             0 01-1.06 0l-3.5-3.5a.75.75 
             0 111.06-1.06l2.97 2.97 6.97-6.97a.75.75 
             0 011.06 0zm-2.25 
             1.5a.75.75 0 010 1.06l-7.5 7.5a.75.75 
             0 01-1.06 0l-3.5-3.5a.75.75 
             0 111.06-1.06l2.97 2.97 6.97-6.97a.75.75 
             0 011.06 0z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  if (status === "sent") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-5 h-5 text-slate-500"
        aria-label="Sent"
      >
        <path
          fillRule="evenodd"
          d="M16.28 7.22a.75.75 0 010 1.06l-7.5 7.5a.75.75 
             0 01-1.06 0l-3.5-3.5a.75.75 
             0 111.06-1.06l2.97 2.97 6.97-6.97a.75.75 
             0 011.06 0z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  return null;
}
