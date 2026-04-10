export default function SidebarHistory({
  chats,
  currentChatId,
  onSelectChat,
}) {
  return (
    <div className="history-stack">
      {chats.length === 0 ? (
        <div className="history-empty">No saved chats yet.</div>
      ) : (
        chats.map((chat) => (
          <button
            key={chat.id}
            className={`history-item ${chat.id === currentChatId ? "active" : ""}`}
            onClick={() => onSelectChat(chat)}
            title={chat.title}
          >
            <div className="history-item-topline">
              <strong>{chat.title}</strong>
              <span className="history-item-badge">{chat.messages?.length || 0}</span>
            </div>
            <span>{new Date(chat.updated_at || Date.now()).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}</span>
          </button>
        ))
      )}
    </div>
  );
}
