import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AttachmentPreview from '../AttachmentPreview';

const imageFile = () => new File(['data'], 'cat.png', { type: 'image/png' });
const pdfFile = () => new File(['data'], 'notes.pdf', { type: 'application/pdf' });

describe('AttachmentPreview', () => {
    let onSend, onCancel, user;

    beforeEach(() => {
        onSend = vi.fn();
        onCancel = vi.fn();
        user = userEvent.setup();
        // jsdom implements neither.
        URL.createObjectURL = vi.fn(() => 'blob:preview');
        URL.revokeObjectURL = vi.fn();
    });

    const renderPreview = (file) =>
        render(<AttachmentPreview file={file} onSend={onSend} onCancel={onCancel} />);

    it('previews an image file as an image', () => {
        renderPreview(imageFile());
        expect(screen.getByRole('img', { name: 'cat.png' })).toHaveAttribute('src', 'blob:preview');
    });

    it('previews a non-image file as name and size', () => {
        renderPreview(pdfFile());
        expect(screen.getByText('notes.pdf')).toBeInTheDocument();
        expect(screen.getByText('4 B')).toBeInTheDocument();
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('sends the trimmed caption on submit', async () => {
        renderPreview(pdfFile());

        await user.type(screen.getByLabelText('Caption'), '  a caption  ');
        await user.click(screen.getByRole('button', { name: 'Send' }));

        expect(onSend).toHaveBeenCalledWith('a caption');
    });

    it('sends an empty caption when none was typed', async () => {
        renderPreview(pdfFile());

        await user.click(screen.getByRole('button', { name: 'Send' }));

        expect(onSend).toHaveBeenCalledWith('');
    });

    it('submits from the caption input on Enter', async () => {
        renderPreview(pdfFile());

        await user.type(screen.getByLabelText('Caption'), 'quick one{Enter}');

        expect(onSend).toHaveBeenCalledWith('quick one');
    });

    it('cancels on Escape', async () => {
        renderPreview(pdfFile());

        await user.keyboard('{Escape}');

        expect(onCancel).toHaveBeenCalled();
        expect(onSend).not.toHaveBeenCalled();
    });

    // StrictMode remounts every component in dev: cleanup revoked the blob
    // URL, but the memoized value was not recomputed - so the img pointed at
    // a dead URL and every image preview rendered broken. The URL must be
    // created per mount, never memoized across one.
    it('still shows a live preview URL after a StrictMode double-mount', () => {
        let counter = 0;
        const revoked = [];
        URL.createObjectURL = vi.fn(() => `blob:preview-${++counter}`);
        URL.revokeObjectURL = vi.fn(url => revoked.push(url));

        render(
            <React.StrictMode>
                <AttachmentPreview file={imageFile()} onSend={onSend} onCancel={onCancel} />
            </React.StrictMode>
        );

        const src = screen.getByRole('img', { name: 'cat.png' }).getAttribute('src');
        expect(revoked).not.toContain(src);
    });

    it('falls back to "No preview available" when the image cannot render', () => {
        renderPreview(imageFile());

        fireEvent.error(screen.getByRole('img', { name: 'cat.png' }));

        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(screen.getByText('No preview available')).toBeInTheDocument();
        // The name and size card still identifies what is being sent.
        expect(screen.getByText('cat.png')).toBeInTheDocument();
    });

    // The blob URL pins the whole file in memory until revoked.
    it('revokes the image preview URL on unmount', () => {
        const { unmount } = renderPreview(imageFile());

        unmount();

        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    });
});
