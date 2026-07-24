// Human-readable byte count for attachment cards and the preview modal.
export const formatFileSize = (bytes) => {
    if (typeof bytes !== 'number' || bytes < 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
