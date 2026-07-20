import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const auth = {
    user: {
        _id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
        avatar: '',
        token: 'tok'
    },
    fetchUserProfile: vi.fn()
};
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => auth }));

vi.mock('../../../services/api', () => ({
    default: { updateMyProfile: vi.fn() }
}));

import api from '../../../services/api';
import ProfileModal from '../ProfileModal';

let user, onClose;

beforeEach(() => {
    vi.clearAllMocks();
    user = userEvent.setup();
    onClose = vi.fn();
    auth.user = {
        _id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
        avatar: '',
        token: 'tok'
    };
    api.updateMyProfile.mockResolvedValue({ message: 'Profile updated successfully', user: {} });
});

const open = () => render(<ProfileModal isOpen onClose={onClose} />);

describe('ProfileModal', () => {
    it('renders nothing when closed', () => {
        const { container } = render(<ProfileModal isOpen={false} onClose={onClose} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('seeds the fields from the signed-in user', () => {
        open();

        expect(screen.getByLabelText(/username/i)).toHaveValue('alice');
        expect(screen.getByLabelText(/email/i)).toHaveValue('alice@example.com');
    });

    // The server checks username/email uniqueness. Posting unchanged values
    // would risk a spurious "already taken" against your own account.
    it('sends only the fields that actually changed', async () => {
        open();

        await user.clear(screen.getByLabelText(/username/i));
        await user.type(screen.getByLabelText(/username/i), 'alice2');
        await user.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalled());
        expect(api.updateMyProfile).toHaveBeenCalledWith({ username: 'alice2' }, 'tok');
    });

    it('does not call the server when nothing changed', async () => {
        open();

        await user.click(screen.getByRole('button', { name: /save changes/i }));

        expect(api.updateMyProfile).not.toHaveBeenCalled();
        expect(await screen.findByText(/nothing to save/i)).toBeInTheDocument();
    });

    // Clearing an existing avatar is a real change and must be sent as ''.
    it('sends an empty avatar when clearing an existing one', async () => {
        auth.user = { ...auth.user, avatar: 'https://example.com/a.png' };
        open();

        await user.clear(screen.getByLabelText(/avatar url/i));
        await user.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith({ avatar: '' }, 'tok'));
    });

    it('sends the current password alongside a new one', async () => {
        open();

        await user.click(screen.getByRole('button', { name: /change password/i }));
        await user.type(screen.getByLabelText(/current password/i), 'oldpass');
        await user.type(screen.getByLabelText(/new password/i), 'newpass1');
        await user.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalledWith(
            { password: 'newpass1', currentPassword: 'oldpass' },
            'tok'
        ));
    });

    // The sidebar reads the username from AuthContext, so a save that does not
    // refresh it leaves the old name on screen.
    it('refreshes the cached profile after saving', async () => {
        open();

        await user.clear(screen.getByLabelText(/username/i));
        await user.type(screen.getByLabelText(/username/i), 'alice2');
        await user.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(auth.fetchUserProfile).toHaveBeenCalledWith('tok'));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('shows a server rejection and stays open', async () => {
        api.updateMyProfile.mockRejectedValue(new Error('Username is already taken'));
        open();

        await user.clear(screen.getByLabelText(/username/i));
        await user.type(screen.getByLabelText(/username/i), 'bob');
        await user.click(screen.getByRole('button', { name: /save changes/i }));

        expect(await screen.findByText(/username is already taken/i)).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        expect(auth.fetchUserProfile).not.toHaveBeenCalled();
    });

    it('closes on Escape', async () => {
        open();

        await user.keyboard('{Escape}');

        expect(onClose).toHaveBeenCalled();
    });
});
