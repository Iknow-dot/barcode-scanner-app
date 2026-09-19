import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';
import ExternalServiceSettings from './ExternalServiceSettings';

jest.mock('../../api', () => ({
    organizationService: {
        getExternalService: jest.fn(),
        rotateExternalServiceToken: jest.fn(),
        updateExternalService: jest.fn(),
    },
}));

const {organizationService} = require('../../api');
const t = translations.ka;

// antd's Popconfirm, Select and Form reach for these; jsdom ships none.
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

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.setItem('language', 'ka');
    organizationService.getExternalService.mockResolvedValue({
        success: true,
        data: {
            web_service_url: 'https://1c.example',
            web_service_username: 'svc',
            has_password: true,
            push_allowed_ips: [],
            // An older backend still sent this; the screen must never show it.
            webhook_token: 'token-from-an-old-backend',
        },
    });
});

const renderSettings = () => render(
    <LanguageProvider><ExternalServiceSettings/></LanguageProvider>,
);

describe('ExternalServiceSettings push token', () => {
    it('never shows a token from the settings response', async () => {
        renderSettings();
        await screen.findByText(t.pushTokenHidden);
        expect(screen.queryByDisplayValue('token-from-an-old-backend')).toBeNull();
    });

    it('shows a newly generated token once, with a warning', async () => {
        organizationService.rotateExternalServiceToken.mockResolvedValue({
            success: true, data: {webhook_token: 'fresh-token-shown-once'},
        });
        renderSettings();
        await screen.findByText(t.pushTokenHidden);

        fireEvent.click(screen.getByRole('button', {name: new RegExp(t.pushTokenRotate)}));
        const popover = await waitFor(() => {
            const el = document.querySelector('.ant-popconfirm, .ant-popover');
            expect(el).not.toBeNull();
            return el;
        });
        fireEvent.click(within(popover).getByRole('button', {name: new RegExp(t.pushTokenRotate)}));

        expect(await screen.findByDisplayValue('fresh-token-shown-once')).toBeTruthy();
        expect(screen.getByText(t.pushTokenShownOnce)).toBeTruthy();
        expect(screen.queryByText(t.pushTokenHidden)).toBeNull();
    });
});
