import {login} from './authService';
import api from '../request';

jest.mock('../request', () => ({
    __esModule: true,
    default: {post: jest.fn()},
}));

describe('authService.login device id handling', () => {
    beforeEach(() => {
        localStorage.clear();
        api.post.mockReset();
    });

    it('omits device_id when none is stored', async () => {
        api.post.mockResolvedValue({success: true, data: {}});
        await login('u', 'p');
        expect(api.post).toHaveBeenCalledWith(
            expect.any(String), {username: 'u', password: 'p'});
    });

    it('sends the stored device_id', async () => {
        localStorage.setItem('device_id', 'dev-1');
        api.post.mockResolvedValue({success: true, data: {}});
        await login('u', 'p');
        expect(api.post).toHaveBeenCalledWith(
            expect.any(String),
            {username: 'u', password: 'p', device_id: 'dev-1'});
    });

    it('stores the device_id returned on success', async () => {
        api.post.mockResolvedValue(
            {success: true, data: {device_id: 'issued-1'}});
        await login('u', 'p');
        expect(localStorage.getItem('device_id')).toBe('issued-1');
    });

    it('stores nothing on failure', async () => {
        api.post.mockResolvedValue(
            {success: false, code: 'DEVICE_NOT_ALLOWED'});
        await login('u', 'p');
        expect(localStorage.getItem('device_id')).toBeNull();
    });
});
