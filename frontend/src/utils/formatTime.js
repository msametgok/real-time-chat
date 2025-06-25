export function formatLastSeen(dateString) {
  if (!dateString) return "";

  const date = new Date(dateString);
  const now = new Date();

  const isToday = date.toDateString() === now.toDateString();
  const options = {
    hour: '2-digit',
    minute: '2-digit'
  };

  if (isToday) {
    return `Last seen today at ${date.toLocaleTimeString([], options)}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === yesterday.toDateString()) {
    return `Last seen yesterday at ${date.toLocaleTimeString([], options)}`;
  }

  return `Last seen on ${date.toLocaleDateString()} at ${date.toLocaleTimeString([], options)}`;
}
