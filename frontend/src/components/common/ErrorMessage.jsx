function ErrorMessage({ message }) {
    if (!message) return null;
    
    return (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-4 rounded">
            <p>{message}</p>
        </div>
    );
}

export default ErrorMessage;
