import React, { useState, useEffect } from 'react';
import { formatFileSize } from '../../utils/formatFileSize';

// WhatsApp-style confirmation screen between picking a file and sending it:
// shows what was picked, takes an optional caption, and can be dismissed to
// cancel the send entirely. Nothing is uploaded until Send is pressed.
function AttachmentPreview({ file, onSend, onCancel }) {
    const [caption, setCaption] = useState('');
    const [previewUrl, setPreviewUrl] = useState(null);
    const [previewFailed, setPreviewFailed] = useState(false);

    // Mirrors the server's classification closely enough for a preview: SVG
    // is excluded because the bubble will render it as a file, so previewing
    // it as an image would misrepresent what gets sent.
    const isImage = !!file.type?.startsWith('image/') && file.type !== 'image/svg+xml';

    // The blob URL is created AND revoked inside one effect, never useMemo:
    // StrictMode remounts run cleanup and then re-run the effect, but a memo
    // is not recomputed - so a memoized URL came back revoked and every image
    // preview rendered broken in dev.
    useEffect(() => {
        setPreviewFailed(false);
        if (!isImage) {
            setPreviewUrl(null);
            return;
        }
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
        // The blob URL also holds the whole file in memory until revoked.
        return () => URL.revokeObjectURL(url);
    }, [file, isImage]);

    // Close on Escape, the shortcut people reach for before the button.
    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape') onCancel(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onCancel]);

    const handleSubmit = (e) => {
        e.preventDefault();
        onSend(caption.trim());
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={onCancel}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Send attachment"
                className="w-full max-w-md rounded-lg bg-slate-800 shadow-xl flex flex-col max-h-[80vh]"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-4 border-b border-slate-700">
                    <h2 className="text-lg font-semibold text-slate-100">Send attachment</h2>
                    <button
                        onClick={onCancel}
                        aria-label="Close"
                        className="text-slate-400 hover:text-slate-200 text-xl leading-none"
                    >
                        &times;
                    </button>
                </div>

                <div className="p-4 flex-1 overflow-y-auto custom-scrollbar">
                    {previewUrl && !previewFailed ? (
                        <img
                            src={previewUrl}
                            alt={file.name}
                            onError={() => setPreviewFailed(true)}
                            className="mx-auto rounded-lg max-h-64 max-w-full object-contain"
                        />
                    ) : (
                        <div className="flex items-center gap-3 text-slate-200">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="h-10 w-10 flex-shrink-0 opacity-75">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                            </svg>
                            <div className="min-w-0">
                                <div className="truncate font-medium">{file.name}</div>
                                <div className="text-sm text-slate-400">{formatFileSize(file.size)}</div>
                                {previewFailed && (
                                    <div className="text-sm text-slate-500 italic">No preview available</div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <form onSubmit={handleSubmit} className="flex items-center gap-2 p-4 border-t border-slate-700">
                    <input
                        type="text"
                        autoFocus
                        value={caption}
                        onChange={e => setCaption(e.target.value)}
                        placeholder="Add a caption (optional)"
                        aria-label="Caption"
                        className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2
                                   text-slate-100 placeholder-slate-500 focus:outline-none
                                   focus:border-indigo-500"
                    />
                    <button
                        type="submit"
                        aria-label="Send"
                        className="inline-flex items-center justify-center rounded-full h-10 w-10 flex-shrink-0
                                   text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6 transform rotate-90">
                            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"></path>
                        </svg>
                    </button>
                </form>
            </div>
        </div>
    );
}

export default AttachmentPreview;
