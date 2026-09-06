import React, {useState} from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';
import AuthContext from '../Auth/AuthContext';
import EditUser from './EditUser';

jest.mock('../../api', () => ({
    userService: {getClientIp: jest.fn(), resetDevice: jest.fn()},
    organizationService: {getOrganizations: jest.fn(), getUsedIps: jest.fn()},
    warehouseService: {getWarehouses: jest.fn()},
}));

const {userService, organizationService, warehouseService} = require('../../api');

// antd's Select and Modal reach for these; jsdom ships neither.
beforeAll(() => {
    window.matchMedia = window.matchMedia || (query => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }));
    global.ResizeObserver = global.ResizeObserver || class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    // rc-field-form schedules its watch notifications on a MessageChannel.
    global.MessageChannel = global.MessageChannel || class {
        constructor() {
            this.port1 = {onmessage: null, close() {}};
            this.port2 = {
                postMessage: data => setTimeout(
                    () => this.port1.onmessage && this.port1.onmessage({data}), 0,
                ),
                close() {},
            };
        }
    };
});

const USER = {
    id: 7,
    username: 'ipuser',
    email: 'ip@example.com',
    role: 'company_user',
    first_name: '',
    last_name: '',
    is_active: true,
    organization: 1,
    allowed_ips: [{ip_or_network: '1.2.3.4'}],
    warehouse_ids_read: [],
    can_apply_discount: false,
    max_discount_percent: 0,
    device_lock_enabled: true,
    has_bound_device: true,
};

const authData = {role: 'company_admin', organization_id: 1, user: {id: 1}};

/** EditUser under a parent that re-renders without changing `object`. */
const Harness = ({onFinish}) => {
    const [, setTick] = useState(0);
    return (
        <LanguageProvider>
            <AuthContext.Provider value={{authData}}>
                <button type="button" onClick={() => setTick(n => n + 1)}>rerender-parent</button>
                <EditUser
                    visible
                    setVisible={() => {}}
                    object={USER}
                    onFinish={onFinish}
                    onDeviceReset={() => {}}
                />
            </AuthContext.Provider>
        </LanguageProvider>
    );
};

const restrictByIpSwitch = () => screen
    .getByText(translations.en.restrictByIp)
    .closest('.ant-flex')
    .querySelector('button[role="switch"]');

describe('EditUser — the form seed survives a parent re-render', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
        userService.getClientIp.mockResolvedValue({success: true, data: {ip: '9.9.9.9'}});
        userService.resetDevice.mockResolvedValue({success: true, data: {...USER, has_bound_device: false}});
        organizationService.getOrganizations.mockResolvedValue({success: true, data: []});
        organizationService.getUsedIps.mockResolvedValue({success: true, data: []});
        warehouseService.getWarehouses.mockResolvedValue({success: true, data: []});
    });

    it('keeps Restrict-by-IP off when the parent re-renders before save', async () => {
        // Turning the switch off clears the hidden ip_address field. ModalForm
        // re-seeds the form whenever the object it is handed changes identity,
        // so an un-memoized seed literal restores ['1.2.3.4'] on the next parent
        // render — Reset device inside this modal triggers exactly that — and the
        // admin's change is silently undone behind a success toast.
        const onFinish = jest.fn().mockResolvedValue(true);
        render(<Harness onFinish={onFinish}/>);

        fireEvent.click(await waitFor(restrictByIpSwitch));
        fireEvent.click(screen.getByText('rerender-parent'));
        fireEvent.submit(document.querySelector('form'));

        await waitFor(() => expect(onFinish).toHaveBeenCalled());
        expect(onFinish.mock.calls[0][0].ip_address).toEqual([]);
    }, 30000);

    it('still submits the existing list when the switch is left on', async () => {
        const onFinish = jest.fn().mockResolvedValue(true);
        render(<Harness onFinish={onFinish}/>);

        await waitFor(restrictByIpSwitch);
        fireEvent.click(screen.getByText('rerender-parent'));
        fireEvent.submit(document.querySelector('form'));

        await waitFor(() => expect(onFinish).toHaveBeenCalled());
        expect(onFinish.mock.calls[0][0].ip_address).toEqual(['1.2.3.4']);
    }, 30000);
});
