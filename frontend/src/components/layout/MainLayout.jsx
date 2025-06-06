import React from 'react';
function MainLayout({ children }) {
  return (
    <div>
      <header className="bg-blue-600 text-white p-4">Main App Header</header>
      <main className="p-4">{children}</main> {/* ChatPage will render here */}
    </div>
  );
}
export default MainLayout;