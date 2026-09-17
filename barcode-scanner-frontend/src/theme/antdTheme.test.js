import {theme} from 'antd';
import {antdTheme} from './antdTheme';
import {TOKENS} from './palette';

describe.each([
    [false, 'light'],
    [true, 'dark'],
])('antdTheme(isDark=%s)', (isDark, mode) => {
    const config = antdTheme(isDark);
    const t = TOKENS[mode];

    test('uses the matching antd algorithm as the first step', () => {
        expect(config.algorithm[0]).toBe(isDark ? theme.darkAlgorithm : theme.defaultAlgorithm);
    });

    test('restores the palette values antd\'s algorithm would otherwise replace', () => {
        const rendered = theme.getDesignToken(config);
        const expected = {
            colorPrimary: t['--if-tint'],
            colorInfo: t['--if-tint'],
            colorLink: t['--if-tint-text'],
            colorSuccess: t['--if-green-text'],
            colorWarning: t['--if-orange-text'],
            colorError: t['--if-red-text'],
            colorSuccessText: t['--if-green-text'],
            colorWarningText: t['--if-orange-text'],
            colorErrorText: t['--if-red-text'],
            colorPrimaryHover: t['--if-tint-hover'],
            colorBorder: t['--if-border'],
        };
        for (const [key, value] of Object.entries(expected)) {
            expect(String(rendered[key]).toLowerCase()).toBe(String(value).toLowerCase());
        }
    });

    test('takes accent, text and surfaces from the palette', () => {
        expect(config.token).toMatchObject({
            colorPrimary: t['--if-tint'],
            colorInfo: t['--if-tint'],
            colorLink: t['--if-tint-text'],
            colorSuccess: t['--if-green-text'],
            colorWarning: t['--if-orange-text'],
            colorError: t['--if-red-text'],
            colorText: t['--if-label'],
            colorTextSecondary: t['--if-label-2'],
            colorTextTertiary: t['--if-label-3'],
            colorBgLayout: t['--if-bg-grouped'],
            colorBgContainer: t['--if-bg'],
            colorBgElevated: t['--if-bg-elevated'],
            colorBorderSecondary: t['--if-sep'],
        });
    });

    test('fills the selected segment with the accent', () => {
        expect(config.components.Segmented).toMatchObject({
            itemSelectedBg: t['--if-tint'],
            itemSelectedColor: '#ffffff',
        });
    });

    test('keeps no antd-blue primary shadow', () => {
        expect(config.components.Button.primaryShadow).toBe('0 2px 0 rgba(58, 152, 102, 0.1)');
    });
});
